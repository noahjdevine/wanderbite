import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const ADMIN = 'e2bc0000-0000-4000-8000-000000000003';
const ISSUE_USER = 'e2bc0000-0000-4000-8000-000000000001';
const LINK_USER = 'e2bc0000-0000-4000-8000-000000000004';
const SEAT_A = 'e2bc0000-0000-4000-8000-000000000011';
const SEAT_B = 'e2bc0000-0000-4000-8000-000000000012';
const MARKET = 'e2bc0000-0000-4000-8000-000000000010';
const SHARED = 'e2bc0000-0000-4000-8000-000000000021';
const PRIVATE_A = 'e2bc0000-0000-4000-8000-000000000022';
const PRIVATE_B = 'e2bc0000-0000-4000-8000-000000000023';
const PAIR_A = 'e2bc0000-0000-4000-8000-000000000024';
const PAIR_B = 'e2bc0000-0000-4000-8000-000000000025';
const SENTINEL = 'E02B_DONE';

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

  async send(sqlText: string, timeoutMs = 15000): Promise<string> {
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
    throw new Error(`E02-B psql wait timed out: ${this.buffer.slice(-800)}`);
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
  throw new Error(`E02-B session did not wait on a lock for ${needle}`);
}

function versionRow(id: string, restaurantId: string, cap: number): string {
  return `(
    '${id}', '${restaurantId}', 'America/Chicago', now() - interval '1 day', now() + interval '400 days',
    '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    'America/Chicago', 'calendar_month', ${cap}, '${ADMIN}'
  )`;
}

export async function runE02BConcurrency(opts: {
  docker: string;
  host: string;
  containerId: string;
  sql: (query: string) => string;
}): Promise<void> {
  const { docker, host, containerId, sql } = opts;
  const open = () => new PsqlSession(docker, host, containerId);
  const month = sql(`select public.chicago_month_start(now())`);
  assert.match(month, /^\d{4}-\d{2}-01$/);

  sql(`
    insert into auth.users (id) values
      ('${ISSUE_USER}'), ('${LINK_USER}'), ('${ADMIN}'), ('${SEAT_A}'), ('${SEAT_B}');
    insert into public.user_profiles (id, subscription_status, role, workflow_version) values
      ('${ISSUE_USER}', 'active', 'subscriber', 'credits'),
      ('${LINK_USER}', 'active', 'subscriber', 'credits'),
      ('${ADMIN}', 'active', 'admin', 'legacy'),
      ('${SEAT_A}', 'active', 'subscriber', 'credits'),
      ('${SEAT_B}', 'active', 'subscriber', 'credits');
    insert into public.markets (id, name, slug)
      values ('${MARKET}', 'E02B Conc', 'e02b-conc');
    insert into public.restaurants (id, name, status, market_id) values
      ('${SHARED}', 'E02B Shared', 'active', '${MARKET}'),
      ('${PRIVATE_A}', 'E02B Private A', 'active', '${MARKET}'),
      ('${PRIVATE_B}', 'E02B Private B', 'active', '${MARKET}'),
      ('${PAIR_A}', 'E02B Pair A', 'active', '${MARKET}'),
      ('${PAIR_B}', 'E02B Pair B', 'active', '${MARKET}');
    insert into public.offer_versions (
      id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
      capacity_timezone, capacity_window_kind, capacity_max_redemptions, published_by
    ) values
      ${versionRow('e2bc0000-0000-4000-8000-0000000000a1', SHARED, 1)},
      ${versionRow('e2bc0000-0000-4000-8000-0000000000a2', PRIVATE_A, 5)},
      ${versionRow('e2bc0000-0000-4000-8000-0000000000a3', PRIVATE_B, 5)},
      ${versionRow('e2bc0000-0000-4000-8000-0000000000a4', PAIR_A, 5)},
      ${versionRow('e2bc0000-0000-4000-8000-0000000000a5', PAIR_B, 5)};
    update public.restaurants set current_offer_version_id = 'e2bc0000-0000-4000-8000-0000000000a1' where id = '${SHARED}';
    update public.restaurants set current_offer_version_id = 'e2bc0000-0000-4000-8000-0000000000a2' where id = '${PRIVATE_A}';
    update public.restaurants set current_offer_version_id = 'e2bc0000-0000-4000-8000-0000000000a3' where id = '${PRIVATE_B}';
    update public.restaurants set current_offer_version_id = 'e2bc0000-0000-4000-8000-0000000000a4' where id = '${PAIR_A}';
    update public.restaurants set current_offer_version_id = 'e2bc0000-0000-4000-8000-0000000000a5' where id = '${PAIR_B}';
    select public.issue_period_credits('${LINK_USER}'::uuid, '${month}'::date);
    select public.issue_period_credits('${SEAT_A}'::uuid, '${month}'::date);
    select public.issue_period_credits('${SEAT_B}'::uuid, '${month}'::date);
  `);

  {
    const a = open();
    const b = open();
    try {
      await a.send(`BEGIN;
        set lock_timeout = '3s';
        set statement_timeout = '10s';
        select public.issue_period_credits('${ISSUE_USER}'::uuid, '${month}'::date);`);
      const pending = b.send(`set lock_timeout = '3s';
        set statement_timeout = '10s';
        select public.issue_period_credits('${ISSUE_USER}'::uuid, '${month}'::date);`);
      await waitForLock(sql, 'issue_period_credits');
      await a.send('COMMIT;');
      const outcome = await pending;
      assert.match(outcome, /^existing$/, `concurrent issue expected existing, got ${outcome}`);
      assert.equal(sql(`select count(*) from public.entitlement_credits where user_id = '${ISSUE_USER}'`), '2');
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
        set lock_timeout = '3s';
        set statement_timeout = '10s';
        select outcome from public.link_pending_credits(
          '${LINK_USER}'::uuid, '${month}'::date, '${MARKET}'::uuid,
          '${PAIR_A}'::uuid, '${PAIR_B}'::uuid);`);
      const pending = b.send(`set lock_timeout = '3s';
        set statement_timeout = '10s';
        select outcome from public.link_pending_credits(
          '${LINK_USER}'::uuid, '${month}'::date, '${MARKET}'::uuid,
          '${PAIR_A}'::uuid, '${PAIR_B}'::uuid);`);
      await waitForLock(sql, 'link_pending_credits');
      await a.send('COMMIT;');
      const outcome = await pending;
      assert.match(outcome, /existing/, `concurrent link expected existing, got ${outcome}`);
      assert.equal(sql(`select count(*) from public.challenge_cycles where user_id = '${LINK_USER}'`), '1');
      assert.equal(sql(`select count(*) from public.challenge_items ci
        join public.challenge_cycles cc on cc.id = ci.cycle_id
        where cc.user_id = '${LINK_USER}' and ci.slot_number in (1, 2)`), '2');
      assert.equal(sql(`select count(*) from public.entitlement_credits
        where user_id = '${LINK_USER}' and status = 'linked'`), '2');
    } finally {
      a.close();
      b.close();
    }
  }

  {
    const a = open();
    const b = open();
    try {
      const first = a.send(`select outcome from public.link_pending_credits(
        '${SEAT_A}'::uuid, '${month}'::date, '${MARKET}'::uuid,
        '${SHARED}'::uuid, '${PRIVATE_A}'::uuid);`);
      const second = b.send(`select outcome from public.link_pending_credits(
        '${SEAT_B}'::uuid, '${month}'::date, '${MARKET}'::uuid,
        '${SHARED}'::uuid, '${PRIVATE_B}'::uuid);`);
      const [left, right] = await Promise.all([first, second]);
      const outcomes = [left, right];
      assert.equal(outcomes.filter((row) => row.includes('linked')).length, 1, `last seat outcomes ${outcomes.join(' | ')}`);
      assert.equal(outcomes.filter((row) => row.includes('capacity_full')).length, 1, `last seat outcomes ${outcomes.join(' | ')}`);
      assert.equal(sql(`select count(distinct challenge_item_id) from public.capacity_reservations
        where restaurant_id = '${SHARED}' and status = 'reserved'`), '1');
      const losers = sql(`select count(*) from public.entitlement_credits
        where user_id in ('${SEAT_A}', '${SEAT_B}') and status = 'pending'`);
      assert.equal(losers, '2');
      assert.equal(sql(`select count(*) from public.challenge_cycles
        where user_id in ('${SEAT_A}', '${SEAT_B}')`), '1');
    } finally {
      a.close();
      b.close();
    }
  }

  sql(`
    delete from public.capacity_reservations
    where restaurant_id in ('${SHARED}', '${PRIVATE_A}', '${PRIVATE_B}', '${PAIR_A}', '${PAIR_B}');
    update public.challenge_items set credit_id = null
    where cycle_id in (select id from public.challenge_cycles where user_id in
      ('${ISSUE_USER}', '${LINK_USER}', '${SEAT_A}', '${SEAT_B}'));
    delete from public.entitlement_credits
    where user_id in ('${ISSUE_USER}', '${LINK_USER}', '${SEAT_A}', '${SEAT_B}');
    delete from public.challenge_items
    where cycle_id in (select id from public.challenge_cycles where user_id in
      ('${ISSUE_USER}', '${LINK_USER}', '${SEAT_A}', '${SEAT_B}'));
    delete from public.challenge_cycles
    where user_id in ('${ISSUE_USER}', '${LINK_USER}', '${SEAT_A}', '${SEAT_B}');
    update public.restaurants set current_offer_version_id = null where market_id = '${MARKET}';
    delete from public.offer_versions where published_by = '${ADMIN}';
    delete from public.restaurants where market_id = '${MARKET}';
    delete from public.markets where id = '${MARKET}';
    delete from public.user_profiles where id in
      ('${ISSUE_USER}', '${LINK_USER}', '${ADMIN}', '${SEAT_A}', '${SEAT_B}');
    delete from auth.users where id in
      ('${ISSUE_USER}', '${LINK_USER}', '${ADMIN}', '${SEAT_A}', '${SEAT_B}');
  `);
}
