import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const USER = 'd1000000-0000-4000-8000-000000000001';
const PRICE = 'a1000000-0000-4000-8000-00000000ae01';
const CONFIG = 'a1000000-0000-4000-8000-00000000ae02';
const MODEL = 'claude-haiku-4-5-20251001';
const AS_OF = '2026-09-19 17:00:00+00';
const SENTINEL = 'G13A1_DONE';
const SESSION_LOCK_TIMEOUT = '3s';
const SESSION_STATEMENT_TIMEOUT = '10s';

class PsqlSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = '';

  constructor(docker: string, host: string, containerId: string) {
    this.child = spawn(docker, [
      '--host', host, 'exec', '-i', containerId,
      'psql', '-X', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-Atq',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => { this.buffer += chunk; });
    this.child.stderr.on('data', (chunk: string) => { this.buffer += chunk; });
  }

  async send(sqlText: string, timeoutMs = 12000): Promise<string> {
    const before = this.buffer.length;
    this.child.stdin.write(`${sqlText}\n\\echo ${SENTINEL}\n`);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const slice = this.buffer.slice(before);
      if (slice.includes(SENTINEL)) {
        return slice.replace(SENTINEL, '').trim();
      }
      await delay(25);
    }
    throw new Error(`G13-A1 psql wait timed out: ${this.buffer.slice(-800)}`);
  }

  close() {
    this.child.stdin.end();
  }
}

async function waitForLock(sql: (query: string) => string, needle: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    const count = sql(`select count(*) from pg_stat_activity
      where wait_event_type = 'Lock'
        and query ilike '%${needle}%'`);
    if (count !== '0') return;
    await delay(50);
  }
  throw new Error(`G13-A1 session B did not wait on a lock for ${needle}`);
}

function reserveSql(key: string): string {
  return `select status from public.ai_reserve(
      p_account_tier => 'paid',
      p_config_version_id => '${CONFIG}'::uuid,
      p_feature_class => 'optional',
      p_idempotency_key => '${key}',
      p_model_id => '${MODEL}',
      p_price_version_id => '${PRICE}'::uuid,
      p_provider => 'anthropic',
      p_usage_units => '{"input":600000}'::jsonb,
      p_as_of => '${AS_OF}'::timestamptz,
      p_user_id => '${USER}'::uuid);`;
}

export async function runG13A1Concurrency(opts: {
  docker: string;
  host: string;
  containerId: string;
  sql: (query: string) => string;
}): Promise<void> {
  const { docker, host, containerId, sql } = opts;
  const open = () => new PsqlSession(docker, host, containerId);

  sql(`
    insert into auth.users (id) values ('${USER}');
    insert into public.user_profiles (id, subscription_status, is_admin)
      values ('${USER}', 'active', false);
  `);

  {
    const a = open();
    const b = open();
    try {
      await a.send(`BEGIN;
        set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
        set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
        ${reserveSql('g13-race-a')}`);
      const pending = b.send(`set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
        set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
        ${reserveSql('g13-race-b')}`);
      await waitForLock(sql, 'ai_reserve');
      await a.send('COMMIT;');
      const outcome = await pending;
      assert.match(outcome, /denied/, `concurrent last-cent expected denied, got ${outcome}`);
      assert.equal(
        sql(`select count(*) from public.ai_requests
          where user_id = '${USER}' and status = 'reserved' and idempotency_key like 'g13-race-%'`),
        '1',
      );
      assert.equal(
        sql(`select count(*) from public.ai_requests
          where user_id = '${USER}' and status = 'denied' and idempotency_key like 'g13-race-%'`),
        '1',
      );
    } finally {
      a.close();
      b.close();
    }
  }

  const requestId = sql(`select id from public.ai_requests
    where idempotency_key = 'g13-race-a'`);
  assert.match(requestId, /^[0-9a-f-]{36}$/i);

  {
    const a = open();
    const b = open();
    try {
      await a.send(`BEGIN;
        set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
        set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
        select acquired from public.ai_dispatch('${requestId}'::uuid);`);
      const pending = b.send(`set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
        set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
        select acquired from public.ai_dispatch('${requestId}'::uuid);`);
      await waitForLock(sql, 'ai_dispatch');
      await a.send('COMMIT;');
      const outcome = await pending;
      assert.match(outcome, /f/, `second dispatch must not acquire, got ${outcome}`);
      assert.equal(
        sql(`select count(*) from public.ai_requests
          where id = '${requestId}' and status = 'dispatched'`),
        '1',
      );
    } finally {
      a.close();
      b.close();
    }
  }

  sql(`
    delete from public.ai_requests where user_id = '${USER}';
    delete from public.ai_bucket_balances
      where bucket_key in ('${USER}', 'platform') and period_key = '2026-09';
    delete from public.user_profiles where id = '${USER}';
    delete from auth.users where id = '${USER}';
  `);
}
