import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const ADMIN = 'e2ae0000-0000-4000-8000-000000000003';
const LEGACY = 'e2ae0000-0000-4000-8000-000000000001';
const CREDIT = 'e2ae0000-0000-4000-8000-000000000002';
const LINK_USER = 'e2ae0000-0000-4000-8000-000000000004';
const CARRY_LINK = 'e2ae0000-0000-4000-8000-000000000005';
const SAME = 'e2ae0000-0000-4000-8000-000000000006';
const SIB = 'e2ae0000-0000-4000-8000-000000000007';
const MARKET = 'e2ae0000-0000-4000-8000-000000000010';
const SHARED_GEN = 'e2ae0000-0000-4000-8000-000000000021';
const PRIVATE_GEN = 'e2ae0000-0000-4000-8000-000000000022';
const SHARED_LINK = 'e2ae0000-0000-4000-8000-000000000023';
const PRIVATE_LINK = 'e2ae0000-0000-4000-8000-000000000024';
const SAME_REST = 'e2ae0000-0000-4000-8000-000000000025';
const SAME_ALT = 'e2ae0000-0000-4000-8000-000000000026';
const SIB_A = 'e2ae0000-0000-4000-8000-000000000027';
const SIB_B = 'e2ae0000-0000-4000-8000-000000000028';
const CREDIT_ROW = 'e2ae0000-0000-4000-8000-000000000031';
const CARRY_LINK_ROW = 'e2ae0000-0000-4000-8000-000000000032';
const SAME_ROW = 'e2ae0000-0000-4000-8000-000000000033';
const SIB_ROW_1 = 'e2ae0000-0000-4000-8000-000000000034';
const SIB_ROW_2 = 'e2ae0000-0000-4000-8000-000000000035';
const USERS = [LEGACY, CREDIT, ADMIN, LINK_USER, CARRY_LINK, SAME, SIB];
const RESTAURANTS = [SHARED_GEN, PRIVATE_GEN, SHARED_LINK, PRIVATE_LINK, SAME_REST, SAME_ALT, SIB_A, SIB_B];
const SENTINEL = 'E02AC_DONE';

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

  async send(sqlText: string, timeoutMs = 25000): Promise<string> {
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
    throw new Error(`E02 carried psql wait timed out: ${this.buffer.slice(-800)}`);
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
  throw new Error(`E02 carried session did not wait on a lock for ${needle}`);
}

function versionRow(id: string, restaurantId: string, cap: number): string {
  return `(
    '${id}', '${restaurantId}', 'America/Chicago', now() - interval '1 day', now() + interval '400 days',
    '[{"threshold_cents":4000,"discount_cents":2000}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    'America/Chicago', 'calendar_month', ${cap}, '${ADMIN}'
  )`;
}

function includesOutcome(text: string, outcome: string): boolean {
  return text.split('|')[0]?.trim() === outcome || text.trim() === outcome;
}

function carriedCredit(id: string, userId: string, slot: number): string {
  return `insert into public.entitlement_credits (id, user_id, issue_period, slot_number, status, expires_at)
    select '${id}', '${userId}',
      (public.chicago_month_start(now()) - interval '1 month')::date,
      ${slot}, 'pending',
      (((public.chicago_month_start(now()) - interval '1 month')::date + interval '2 months')::timestamp
        at time zone 'America/Chicago');`;
}

export async function runE02AssignCarried(opts: {
  docker: string;
  host: string;
  containerId: string;
  sql: (query: string) => string;
}): Promise<void> {
  const { docker, host, containerId, sql } = opts;
  const month = sql(`select public.chicago_month_start(now())`).trim();
  assert.match(month, /^\d{4}-\d{2}-01$/);
  assert.ok(SHARED_GEN < PRIVATE_GEN && SHARED_LINK < PRIVATE_LINK, 'shared restaurant must lock first');
  const open = () => new PsqlSession(docker, host, containerId);
  const userList = USERS.map((id) => `'${id}'`).join(', ');
  const restaurantList = RESTAURANTS.map((id) => `'${id}'`).join(', ');

  const cleanup = () => {
    sql(`
      delete from public.capacity_reservations where restaurant_id in (${restaurantList});
      delete from public.redemptions where user_id in (${userList});
      update public.challenge_items set credit_id = null
      where cycle_id in (select id from public.challenge_cycles where user_id in (${userList}));
      delete from public.entitlement_credits where user_id in (${userList});
      delete from public.challenge_items
      where cycle_id in (select id from public.challenge_cycles where user_id in (${userList}));
      delete from public.challenge_cycles where user_id in (${userList});
      update public.restaurants set current_offer_version_id = null where market_id = '${MARKET}';
      delete from public.offer_versions where published_by = '${ADMIN}';
      delete from public.restaurants where market_id = '${MARKET}';
      delete from public.markets where id = '${MARKET}';
      delete from public.user_profiles where id in (${userList});
      delete from auth.users where id in (${userList});
    `);
  };

  try {
    sql(`
      insert into auth.users (id) values
        ('${LEGACY}'), ('${CREDIT}'), ('${ADMIN}'), ('${LINK_USER}'),
        ('${CARRY_LINK}'), ('${SAME}'), ('${SIB}');
      insert into public.user_profiles (id, subscription_status, role, workflow_version) values
        ('${LEGACY}', 'active', 'subscriber', 'legacy'),
        ('${CREDIT}', 'active', 'subscriber', 'credits'),
        ('${ADMIN}', 'active', 'admin', 'legacy'),
        ('${LINK_USER}', 'active', 'subscriber', 'credits'),
        ('${CARRY_LINK}', 'active', 'subscriber', 'credits'),
        ('${SAME}', 'active', 'subscriber', 'credits'),
        ('${SIB}', 'active', 'subscriber', 'credits');
      insert into public.markets (id, name, slug)
        values ('${MARKET}', 'E02 Carried Overlap', 'e02-carried-overlap');
      insert into public.restaurants (id, name, status, market_id) values
        ('${SHARED_GEN}', 'E02AC Shared Gen', 'active', '${MARKET}'),
        ('${PRIVATE_GEN}', 'E02AC Private Gen', 'active', '${MARKET}'),
        ('${SHARED_LINK}', 'E02AC Shared Link', 'active', '${MARKET}'),
        ('${PRIVATE_LINK}', 'E02AC Private Link', 'active', '${MARKET}'),
        ('${SAME_REST}', 'E02AC Same', 'active', '${MARKET}'),
        ('${SAME_ALT}', 'E02AC Same Alt', 'active', '${MARKET}'),
        ('${SIB_A}', 'E02AC Sib A', 'active', '${MARKET}'),
        ('${SIB_B}', 'E02AC Sib B', 'active', '${MARKET}');
      insert into public.offer_versions (
        id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
        capacity_timezone, capacity_window_kind, capacity_max_redemptions, published_by
      ) values
        ${versionRow('e2ae0000-0000-4000-8000-0000000000a1', SHARED_GEN, 1)},
        ${versionRow('e2ae0000-0000-4000-8000-0000000000a2', PRIVATE_GEN, 5)},
        ${versionRow('e2ae0000-0000-4000-8000-0000000000a3', SHARED_LINK, 1)},
        ${versionRow('e2ae0000-0000-4000-8000-0000000000a4', PRIVATE_LINK, 5)},
        ${versionRow('e2ae0000-0000-4000-8000-0000000000a5', SAME_REST, 5)},
        ${versionRow('e2ae0000-0000-4000-8000-0000000000a6', SAME_ALT, 5)},
        ${versionRow('e2ae0000-0000-4000-8000-0000000000a7', SIB_A, 5)},
        ${versionRow('e2ae0000-0000-4000-8000-0000000000a8', SIB_B, 5)};
      update public.restaurants set current_offer_version_id = 'e2ae0000-0000-4000-8000-0000000000a1' where id = '${SHARED_GEN}';
      update public.restaurants set current_offer_version_id = 'e2ae0000-0000-4000-8000-0000000000a2' where id = '${PRIVATE_GEN}';
      update public.restaurants set current_offer_version_id = 'e2ae0000-0000-4000-8000-0000000000a3' where id = '${SHARED_LINK}';
      update public.restaurants set current_offer_version_id = 'e2ae0000-0000-4000-8000-0000000000a4' where id = '${PRIVATE_LINK}';
      update public.restaurants set current_offer_version_id = 'e2ae0000-0000-4000-8000-0000000000a5' where id = '${SAME_REST}';
      update public.restaurants set current_offer_version_id = 'e2ae0000-0000-4000-8000-0000000000a6' where id = '${SAME_ALT}';
      update public.restaurants set current_offer_version_id = 'e2ae0000-0000-4000-8000-0000000000a7' where id = '${SIB_A}';
      update public.restaurants set current_offer_version_id = 'e2ae0000-0000-4000-8000-0000000000a8' where id = '${SIB_B}';
      ${carriedCredit(CREDIT_ROW, CREDIT, 1)}
      ${carriedCredit(CARRY_LINK_ROW, CARRY_LINK, 1)}
      ${carriedCredit(SAME_ROW, SAME, 1)}
      ${carriedCredit(SIB_ROW_1, SIB, 1)}
      ${carriedCredit(SIB_ROW_2, SIB, 2)}
      select public.issue_period_credits('${LINK_USER}'::uuid, '${month}'::date);
    `);

    {
      const held = open();
      const waiting = open();
      try {
        const first = await held.send(`begin;
          set lock_timeout = '12s';
          set statement_timeout = '20s';
          select outcome from public.assign_carried_credit(
            '${SAME}'::uuid, '${SAME_ROW}'::uuid, '${MARKET}'::uuid, '${SAME_REST}'::uuid);`);
        assert.equal(includesOutcome(first, 'linked'), true, `same-credit holder ${first}`);
        const pending = waiting.send(`set lock_timeout = '12s';
          set statement_timeout = '20s';
          select outcome from public.assign_carried_credit(
            '${SAME}'::uuid, '${SAME_ROW}'::uuid, '${MARKET}'::uuid, '${SAME_ALT}'::uuid);`);
        await waitForLock(sql, 'assign_carried_credit');
        await held.send('commit;');
        const second = await pending;
        assert.equal(includesOutcome(second, 'existing'), true, `same-credit waiter ${second}`);
        assert.equal(sql(`select count(*) from public.challenge_cycles where user_id = '${SAME}'`).trim(), '1');
        assert.equal(sql(`select count(*) from public.challenge_items ci
          join public.challenge_cycles cc on cc.id = ci.cycle_id
          where cc.user_id = '${SAME}'`).trim(), '1');
        assert.equal(sql(`select restaurant_id::text from public.challenge_items ci
          join public.challenge_cycles cc on cc.id = ci.cycle_id
          where cc.user_id = '${SAME}'`).trim(), SAME_REST);
      } finally {
        held.close();
        waiting.close();
      }
    }

    {
      const held = open();
      const waiting = open();
      try {
        const first = await held.send(`begin;
          set lock_timeout = '12s';
          set statement_timeout = '20s';
          select outcome from public.assign_carried_credit(
            '${SIB}'::uuid, '${SIB_ROW_1}'::uuid, '${MARKET}'::uuid, '${SIB_A}'::uuid);`);
        assert.equal(includesOutcome(first, 'linked'), true, `sibling holder ${first}`);
        const pending = waiting.send(`set lock_timeout = '12s';
          set statement_timeout = '20s';
          select outcome from public.assign_carried_credit(
            '${SIB}'::uuid, '${SIB_ROW_2}'::uuid, '${MARKET}'::uuid, '${SIB_B}'::uuid);`);
        await waitForLock(sql, 'assign_carried_credit');
        await held.send('commit;');
        const second = await pending;
        assert.equal(includesOutcome(second, 'linked'), true, `sibling waiter ${second}`);
        assert.equal(sql(`select count(*) from public.challenge_cycles where user_id = '${SIB}'`).trim(), '1');
        assert.equal(sql(`select count(*) from public.challenge_items ci
          join public.challenge_cycles cc on cc.id = ci.cycle_id
          where cc.user_id = '${SIB}' and ci.slot_number in (1, 2)`).trim(), '2');
        assert.equal(sql(`select count(*) from public.entitlement_credits
          where user_id = '${SIB}' and status = 'linked'`).trim(), '2');
      } finally {
        held.close();
        waiting.close();
      }
    }

    {
      const legacySession = open();
      const creditSession = open();
      try {
        const legacyCall = legacySession.send(`set lock_timeout = '12s';
          set statement_timeout = '20s';
          select outcome from public.generate_challenge_cycle(
            '${LEGACY}'::uuid, '${month}'::date, '${MARKET}'::uuid,
            array['${SHARED_GEN}'::uuid, '${PRIVATE_GEN}'::uuid]);`);
        const creditCall = creditSession.send(`set lock_timeout = '12s';
          set statement_timeout = '20s';
          select outcome from public.assign_carried_credit(
            '${CREDIT}'::uuid, '${CREDIT_ROW}'::uuid, '${MARKET}'::uuid, '${SHARED_GEN}'::uuid);`);
        const [legacyOutcome, creditOutcome] = await Promise.all([legacyCall, creditCall]);
        const legacyWon = includesOutcome(legacyOutcome, 'created');
        const creditWon = includesOutcome(creditOutcome, 'linked');
        assert.equal(Number(legacyWon) + Number(creditWon), 1, `generate seat ${legacyOutcome} | ${creditOutcome}`);
        assert.equal(
          includesOutcome(legacyOutcome, 'capacity_full') || includesOutcome(creditOutcome, 'capacity_full'),
          true,
          `generate seat ${legacyOutcome} | ${creditOutcome}`,
        );
        assert.equal(sql(`select count(distinct challenge_item_id) from public.capacity_reservations
          where restaurant_id = '${SHARED_GEN}' and status = 'reserved'`).trim(), '1');
        if (creditWon) {
          assert.equal(sql(`select status from public.entitlement_credits where id = '${CREDIT_ROW}'`).trim(), 'linked');
          assert.equal(sql(`select count(*) from public.challenge_cycles where user_id = '${LEGACY}'`).trim(), '0');
        } else {
          assert.equal(sql(`select status || coalesce(challenge_item_id::text, '') from public.entitlement_credits
            where id = '${CREDIT_ROW}'`).trim(), 'pending');
          assert.equal(sql(`select count(*) from public.challenge_cycles where user_id = '${CREDIT}'`).trim(), '0');
          assert.equal(sql(`select count(*) from public.challenge_cycles where user_id = '${LEGACY}'`).trim(), '1');
        }
      } finally {
        legacySession.close();
        creditSession.close();
      }
    }

    {
      const linkSession = open();
      const creditSession = open();
      try {
        const linkCall = linkSession.send(`set lock_timeout = '12s';
          set statement_timeout = '20s';
          select outcome from public.link_pending_credits(
            '${LINK_USER}'::uuid, '${month}'::date, '${MARKET}'::uuid,
            '${SHARED_LINK}'::uuid, '${PRIVATE_LINK}'::uuid);`);
        const creditCall = creditSession.send(`set lock_timeout = '12s';
          set statement_timeout = '20s';
          select outcome from public.assign_carried_credit(
            '${CARRY_LINK}'::uuid, '${CARRY_LINK_ROW}'::uuid, '${MARKET}'::uuid, '${SHARED_LINK}'::uuid);`);
        const [linkOutcome, creditOutcome] = await Promise.all([linkCall, creditCall]);
        const linkWon = includesOutcome(linkOutcome, 'linked');
        const creditWon = includesOutcome(creditOutcome, 'linked');
        assert.equal(Number(linkWon) + Number(creditWon), 1, `link seat ${linkOutcome} | ${creditOutcome}`);
        assert.equal(
          includesOutcome(linkOutcome, 'capacity_full') || includesOutcome(creditOutcome, 'capacity_full'),
          true,
          `link seat ${linkOutcome} | ${creditOutcome}`,
        );
        assert.equal(sql(`select count(distinct challenge_item_id) from public.capacity_reservations
          where restaurant_id = '${SHARED_LINK}' and status = 'reserved'`).trim(), '1');
        if (creditWon) {
          assert.equal(sql(`select status from public.entitlement_credits where id = '${CARRY_LINK_ROW}'`).trim(), 'linked');
          assert.equal(sql(`select count(*) from public.entitlement_credits
            where user_id = '${LINK_USER}' and status = 'pending'`).trim(), '2');
          assert.equal(sql(`select count(*) from public.challenge_cycles where user_id = '${LINK_USER}'`).trim(), '0');
        } else {
          assert.equal(sql(`select status || coalesce(challenge_item_id::text, '') from public.entitlement_credits
            where id = '${CARRY_LINK_ROW}'`).trim(), 'pending');
          assert.equal(sql(`select count(*) from public.challenge_cycles where user_id = '${CARRY_LINK}'`).trim(), '0');
          assert.equal(sql(`select count(*) from public.entitlement_credits
            where user_id = '${LINK_USER}' and status = 'linked'`).trim(), '2');
          assert.equal(sql(`select count(*) from public.challenge_cycles where user_id = '${LINK_USER}'`).trim(), '1');
        }
      } finally {
        linkSession.close();
        creditSession.close();
      }
    }
  } finally {
    cleanup();
  }
}
