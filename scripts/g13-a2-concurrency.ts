import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const USER = 'd2000000-0000-4000-8000-000000000001';
const PRICE = 'a1000000-0000-4000-8000-00000000ae01';
const CONFIG = 'a1000000-0000-4000-8000-00000000ae02';
const MODEL = 'claude-haiku-4-5-20251001';
const AS_OF = '2026-09-19 17:00:00+00';
const GUEST = 'guest-a2-lock';
const SENTINEL = 'G13A2_DONE';
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
    throw new Error(`G13-A2 psql wait timed out: ${this.buffer.slice(-800)}`);
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
  throw new Error(`G13-A2 session B did not wait on a lock for ${needle}`);
}

export async function runG13A2Concurrency(opts: {
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

  const requestId = sql(`select request_id from public.ai_reserve(
      p_account_tier => 'guest',
      p_config_version_id => '${CONFIG}'::uuid,
      p_feature_class => 'guest',
      p_idempotency_key => 'g13a2-lock-guest',
      p_model_id => '${MODEL}',
      p_price_version_id => '${PRICE}'::uuid,
      p_provider => 'anthropic',
      p_usage_units => '{"input":50}'::jsonb,
      p_as_of => '${AS_OF}'::timestamptz,
      p_guest_id => '${GUEST}');`);
  assert.match(requestId, /^[0-9a-f-]{36}$/i);

  {
    const a = open();
    const b = open();
    try {
      await a.send(`BEGIN;
        set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
        set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
        select status from public.ai_requests where id = '${requestId}'::uuid for update;`);
      const pending = b.send(`set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
        set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
        select already_claimed from public.ai_transfer_guest_to_account('${GUEST}', '${USER}'::uuid);`);
      await waitForLock(sql, 'ai_transfer_guest_to_account');
      await a.send('COMMIT;');
      const outcome = await pending;
      assert.match(outcome, /f/, `transfer should claim after request lock, got ${outcome}`);
      assert.equal(
        sql(`select (bucket_targets::text like '%guest_session%')::text
          from public.ai_requests where id = '${requestId}'`),
        'false',
      );
    } finally {
      a.close();
      b.close();
    }
  }

  sql(`
    delete from public.ai_requests where guest_id = '${GUEST}' or user_id = '${USER}';
    delete from public.ai_guest_transfers where guest_id = '${GUEST}';
    delete from public.ai_bucket_balances
      where bucket_key in ('${USER}', '${GUEST}', 'platform', 'guest_pool')
        and period_key in ('2026-09', 'open', '2026-09-19');
    delete from public.user_profiles where id = '${USER}';
    delete from auth.users where id = '${USER}';
  `);
}
