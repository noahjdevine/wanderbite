import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const ADMIN = 'e2rs0000-0000-4000-8000-000000000003';
const LEGACY = 'e2rs0000-0000-4000-8000-000000000001';
const CREDIT = 'e2rs0000-0000-4000-8000-000000000002';
const MARKET = 'e2rs0000-0000-4000-8000-000000000010';
const SHARED = 'e2rs0000-0000-4000-8000-000000000021';
const PRIVATE_CREDIT = 'e2rs0000-0000-4000-8000-000000000022';
const PRIVATE_LEGACY = 'e2rs0000-0000-4000-8000-000000000023';
const SENTINEL = 'E02RS_DONE';

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
    throw new Error(`E02 shared-seat psql wait timed out: ${this.buffer.slice(-800)}`);
  }

  close() {
    this.child.stdin.end();
  }
}

function versionRow(id: string, restaurantId: string, cap: number): string {
  return `(
    '${id}', '${restaurantId}', 'America/Chicago', now() - interval '1 day', now() + interval '400 days',
    '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    'America/Chicago', 'calendar_month', ${cap}, '${ADMIN}'
  )`;
}

function includesOutcome(text: string, outcome: string): boolean {
  return text.split('|')[0]?.trim() === outcome || text.trim() === outcome;
}

export async function runE02RemainderSharedSeat(opts: {
  docker: string;
  host: string;
  containerId: string;
  sql: (query: string) => string;
}): Promise<void> {
  const { docker, host, containerId, sql } = opts;
  const month = sql(`select public.chicago_month_start(now())`).trim();
  assert.match(month, /^\d{4}-\d{2}-01$/);
  assert.ok(SHARED < PRIVATE_CREDIT && SHARED < PRIVATE_LEGACY, 'shared restaurant must lock first');

  const legacySession = new PsqlSession(docker, host, containerId);
  const creditSession = new PsqlSession(docker, host, containerId);
  try {
    sql(`
    insert into auth.users (id) values ('${LEGACY}'), ('${CREDIT}'), ('${ADMIN}');
    insert into public.user_profiles (id, subscription_status, role, workflow_version) values
      ('${LEGACY}', 'active', 'subscriber', 'legacy'),
      ('${CREDIT}', 'active', 'subscriber', 'credits'),
      ('${ADMIN}', 'active', 'admin', 'legacy');
    insert into public.markets (id, name, slug)
      values ('${MARKET}', 'E02 Shared Seat', 'e02-shared-seat');
    insert into public.restaurants (id, name, status, market_id) values
      ('${SHARED}', 'E02RS Shared', 'active', '${MARKET}'),
      ('${PRIVATE_CREDIT}', 'E02RS Credit Private', 'active', '${MARKET}'),
      ('${PRIVATE_LEGACY}', 'E02RS Legacy Private', 'active', '${MARKET}');
    insert into public.offer_versions (
      id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
      capacity_timezone, capacity_window_kind, capacity_max_redemptions, published_by
    ) values
      ${versionRow('e2rs0000-0000-4000-8000-0000000000a1', SHARED, 1)},
      ${versionRow('e2rs0000-0000-4000-8000-0000000000a2', PRIVATE_CREDIT, 5)},
      ${versionRow('e2rs0000-0000-4000-8000-0000000000a3', PRIVATE_LEGACY, 5)};
    update public.restaurants set current_offer_version_id = 'e2rs0000-0000-4000-8000-0000000000a1' where id = '${SHARED}';
    update public.restaurants set current_offer_version_id = 'e2rs0000-0000-4000-8000-0000000000a2' where id = '${PRIVATE_CREDIT}';
    update public.restaurants set current_offer_version_id = 'e2rs0000-0000-4000-8000-0000000000a3' where id = '${PRIVATE_LEGACY}';
    select public.issue_period_credits('${CREDIT}'::uuid, '${month}'::date);
  `);

    const legacyCall = legacySession.send(`set lock_timeout = '3s';
      set statement_timeout = '10s';
      select outcome from public.generate_challenge_cycle(
        '${LEGACY}'::uuid, '${month}'::date, '${MARKET}'::uuid,
        array['${SHARED}'::uuid, '${PRIVATE_LEGACY}'::uuid]);`);
    const creditCall = creditSession.send(`set lock_timeout = '3s';
      set statement_timeout = '10s';
      select outcome from public.link_pending_credits(
        '${CREDIT}'::uuid, '${month}'::date, '${MARKET}'::uuid,
        '${SHARED}'::uuid, '${PRIVATE_CREDIT}'::uuid);`);
    const [legacyOutcome, creditOutcome] = await Promise.all([legacyCall, creditCall]);
    const legacyWon = includesOutcome(legacyOutcome, 'created');
    const creditWon = includesOutcome(creditOutcome, 'linked');
    assert.equal(Number(legacyWon) + Number(creditWon), 1, `shared seat outcomes ${legacyOutcome} | ${creditOutcome}`);
    assert.equal(
      includesOutcome(legacyOutcome, 'capacity_full') || includesOutcome(creditOutcome, 'capacity_full'),
      true,
      `shared seat outcomes ${legacyOutcome} | ${creditOutcome}`,
    );
    assert.equal(sql(`select count(distinct challenge_item_id) from public.capacity_reservations
      where restaurant_id = '${SHARED}' and status = 'reserved'`).trim(), '1');

    if (includesOutcome(creditOutcome, 'capacity_full')) {
      assert.equal(sql(`select count(*) from public.entitlement_credits
        where user_id = '${CREDIT}' and status = 'pending'`).trim(), '2');
      assert.equal(sql(`select count(*) from public.challenge_cycles where user_id = '${CREDIT}'`).trim(), '0');
    } else {
      assert.equal(sql(`select count(*) from public.entitlement_credits
        where user_id = '${CREDIT}' and status = 'linked'`).trim(), '2');
      assert.equal(sql(`select count(*) from public.challenge_cycles where user_id = '${CREDIT}'`).trim(), '1');
    }

    if (includesOutcome(legacyOutcome, 'capacity_full')) {
      assert.equal(sql(`select count(*) from public.challenge_cycles where user_id = '${LEGACY}'`).trim(), '0');
      assert.equal(sql(`select count(*) from public.challenge_items ci
        join public.challenge_cycles cc on cc.id = ci.cycle_id
        where cc.user_id = '${LEGACY}'`).trim(), '0');
      assert.equal(sql(`select count(*) from public.capacity_reservations cr
        join public.challenge_items ci on ci.id = cr.challenge_item_id
        join public.challenge_cycles cc on cc.id = ci.cycle_id
        where cc.user_id = '${LEGACY}'`).trim(), '0');
    } else {
      assert.equal(sql(`select count(*) from public.challenge_cycles where user_id = '${LEGACY}'`).trim(), '1');
      assert.equal(sql(`select count(*) from public.challenge_items ci
        join public.challenge_cycles cc on cc.id = ci.cycle_id
        where cc.user_id = '${LEGACY}'`).trim(), '2');
    }
  } finally {
    legacySession.close();
    creditSession.close();
    sql(`
      delete from public.capacity_reservations
      where restaurant_id in ('${SHARED}', '${PRIVATE_CREDIT}', '${PRIVATE_LEGACY}');
      update public.challenge_items set credit_id = null
      where cycle_id in (select id from public.challenge_cycles where user_id in ('${LEGACY}', '${CREDIT}'));
      delete from public.entitlement_credits where user_id in ('${LEGACY}', '${CREDIT}');
      delete from public.challenge_items
      where cycle_id in (select id from public.challenge_cycles where user_id in ('${LEGACY}', '${CREDIT}'));
      delete from public.challenge_cycles where user_id in ('${LEGACY}', '${CREDIT}');
      update public.restaurants set current_offer_version_id = null where market_id = '${MARKET}';
      delete from public.offer_versions where published_by = '${ADMIN}';
      delete from public.restaurants where market_id = '${MARKET}';
      delete from public.markets where id = '${MARKET}';
      delete from public.user_profiles where id in ('${LEGACY}', '${CREDIT}', '${ADMIN}');
      delete from auth.users where id in ('${LEGACY}', '${CREDIT}', '${ADMIN}');
    `);
  }
}
