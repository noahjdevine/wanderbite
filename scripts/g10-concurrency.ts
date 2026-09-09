import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const USER = 'b1000000-0000-4000-8000-000000000001';
const MARKET = 'b1000000-0000-4000-8000-000000000010';
const R1 = 'b1000000-0000-4000-8000-000000000021';
const R2 = 'b1000000-0000-4000-8000-000000000022';
const R3 = 'b1000000-0000-4000-8000-000000000023';
const MONTH = '2026-09-01';
const SENTINEL = 'G10_DONE';
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
    throw new Error(`G10 psql wait timed out: ${this.buffer.slice(-800)}`);
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
  throw new Error(`G10 session B did not wait on a lock for ${needle}`);
}

export async function runG10Concurrency(opts: {
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
    insert into public.markets (id, name, slug)
      values ('${MARKET}', 'G10 Conc', 'g10-conc');
    insert into public.restaurants (id, name, status, market_id) values
      ('${R1}', 'G10 C1', 'active', '${MARKET}'),
      ('${R2}', 'G10 C2', 'active', '${MARKET}'),
      ('${R3}', 'G10 C3', 'active', '${MARKET}');
    insert into public.restaurant_offers (restaurant_id, active) values
      ('${R1}', true), ('${R2}', true), ('${R3}', true);
  `);

  {
    const a = open();
    const b = open();
    try {
      await a.send(`BEGIN;
        set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
        set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
        select outcome from public.generate_challenge_cycle(
          '${USER}'::uuid, '${MONTH}'::date, '${MARKET}'::uuid,
          array['${R1}'::uuid, '${R2}'::uuid]);`);
      const pending = b.send(`set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
        set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
        select outcome from public.generate_challenge_cycle(
          '${USER}'::uuid, '${MONTH}'::date, '${MARKET}'::uuid,
          array['${R1}'::uuid, '${R3}'::uuid]);`);
      await waitForLock(sql, 'generate_challenge_cycle');
      await a.send('COMMIT;');
      const outcome = await pending;
      assert.match(outcome, /existing/, `concurrent generate expected existing, got ${outcome}`);
      assert.equal(sql(`select count(*) from public.challenge_cycles where user_id = '${USER}'`), '1');
      assert.equal(sql(`select count(*) from public.challenge_items ci
        join public.challenge_cycles cc on cc.id = ci.cycle_id
        where cc.user_id = '${USER}' and ci.status in ('assigned','redeemed')`), '2');
    } finally {
      a.close();
      b.close();
    }
  }

  const item1 = sql(`select ci.id from public.challenge_items ci
    join public.challenge_cycles cc on cc.id = ci.cycle_id
    where cc.user_id = '${USER}' and ci.slot_number = 1 and ci.status = 'assigned'`);
  const item2 = sql(`select ci.id from public.challenge_items ci
    join public.challenge_cycles cc on cc.id = ci.cycle_id
    where cc.user_id = '${USER}' and ci.slot_number = 2 and ci.status = 'assigned'`);
  assert.match(item1, /^[0-9a-f-]{36}$/i);
  assert.match(item2, /^[0-9a-f-]{36}$/i);

  {
    const a = open();
    const b = open();
    try {
      await a.send(`BEGIN;
        set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
        set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
        select outcome from public.swap_challenge_item(
          '${USER}'::uuid, '${item1}'::uuid, '${R3}'::uuid);`);
      const pending = b.send(`set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
        set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
        select outcome from public.swap_challenge_item(
          '${USER}'::uuid, '${item2}'::uuid, '${R3}'::uuid);`);
      await waitForLock(sql, 'swap_challenge_item');
      await a.send('COMMIT;');
      const outcome = await pending;
      assert.match(outcome, /swap_exhausted/, `other-slot swap expected swap_exhausted, got ${outcome}`);
    } finally {
      a.close();
      b.close();
    }
  }

  {
    const a = open();
    const b = open();
    try {
      await a.send(`BEGIN;
        set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
        set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
        select outcome from public.swap_challenge_item(
          '${USER}'::uuid, '${item1}'::uuid, '${R3}'::uuid);`);
      const pending = b.send(`set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
        set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
        select outcome from public.swap_challenge_item(
          '${USER}'::uuid, '${item1}'::uuid, '${R3}'::uuid);`);
      await waitForLock(sql, 'swap_challenge_item');
      await a.send('COMMIT;');
      const outcome = await pending;
      assert.match(outcome, /existing/, `same-source swap expected existing, got ${outcome}`);
    } finally {
      a.close();
      b.close();
    }
  }

  const assignedItem = sql(`select ci.id from public.challenge_items ci
    join public.challenge_cycles cc on cc.id = ci.cycle_id
    where cc.user_id = '${USER}' and ci.status = 'assigned'
    order by ci.slot_number
    limit 1`);
  assert.match(assignedItem, /^[0-9a-f-]{36}$/i);

  {
    const a = open();
    const b = open();
    try {
      await a.send(`BEGIN;
        set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
        set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
        select outcome from public.issue_challenge_redemption(
          '${USER}'::uuid, '${assignedItem}'::uuid,
          'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          'ciph', 'iviviviviviv', now() + interval '1 day');`);
      const pending = b.send(`set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
        set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
        select outcome from public.issue_challenge_redemption(
          '${USER}'::uuid, '${assignedItem}'::uuid,
          'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          'ciph2', 'iviviviviviv', now() + interval '1 day');`);
      await waitForLock(sql, 'issue_challenge_redemption');
      await a.send('COMMIT;');
      const outcome = await pending;
      assert.match(outcome, /existing/, `concurrent issue expected existing, got ${outcome}`);
      assert.equal(
        sql(`select count(*) from public.redemptions where challenge_item_id = '${assignedItem}'`),
        '1',
      );
    } finally {
      a.close();
      b.close();
    }
  }

  sql(`
    delete from public.redemptions where user_id = '${USER}';
    delete from public.challenge_items where cycle_id in (
      select id from public.challenge_cycles where user_id = '${USER}');
    delete from public.challenge_cycles where user_id = '${USER}';
    delete from public.restaurant_offers where restaurant_id in ('${R1}','${R2}','${R3}');
    delete from public.restaurants where id in ('${R1}','${R2}','${R3}');
    delete from public.markets where id = '${MARKET}';
    delete from public.user_profiles where id = '${USER}';
    delete from auth.users where id = '${USER}';
  `);
}
