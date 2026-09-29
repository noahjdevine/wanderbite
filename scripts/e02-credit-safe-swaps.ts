import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const USER = 'e2010000-0000-4000-8000-000000000001';
const MARKET = 'e2010000-0000-4000-8000-000000000010';
const R1 = 'e2010000-0000-4000-8000-000000000021';
const R2 = 'e2010000-0000-4000-8000-000000000022';
const R3 = 'e2010000-0000-4000-8000-000000000023';
const V1 = 'e2010000-0000-4000-8000-000000000031';
const V2 = 'e2010000-0000-4000-8000-000000000032';
const V3 = 'e2010000-0000-4000-8000-000000000033';
const CYCLE = 'e2010000-0000-4000-8000-000000000040';
const ITEM1 = 'e2010000-0000-4000-8000-000000000041';
const ITEM2 = 'e2010000-0000-4000-8000-000000000042';
const CREDIT1 = 'e2010000-0000-4000-8000-000000000051';
const CREDIT2 = 'e2010000-0000-4000-8000-000000000052';
const SENTINEL = 'E02SWAP_DONE';
const SESSION_LOCK_TIMEOUT = '5s';
const SESSION_STATEMENT_TIMEOUT = '12s';

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

  async send(sqlText: string, timeoutMs = 20000): Promise<string> {
    const before = this.buffer.length;
    this.child.stdin.write(`${sqlText}\n\\echo ${SENTINEL}\n`);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const slice = this.buffer.slice(before);
      if (slice.includes(SENTINEL)) return slice.replace(SENTINEL, '').trim();
      await delay(25);
    }
    throw new Error(`E02 swap psql wait timed out: ${this.buffer.slice(-800)}`);
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
  throw new Error(`E02 swap session did not wait on a lock for ${needle}`);
}

function assertFinished(output: string, outcome: string, label: string) {
  assert.doesNotMatch(output, /deadlock detected|lock timeout|canceling statement due to statement timeout|ERROR/i, label);
  assert.match(output, new RegExp(outcome), `${label}: ${output}`);
}

export async function runE02CreditSafeSwaps(opts: {
  docker: string;
  host: string;
  containerId: string;
  sql: (query: string) => string;
}): Promise<void> {
  const { docker, host, containerId, sql } = opts;
  const open = () => new PsqlSession(docker, host, containerId);
  const month = sql(`select public.chicago_month_start(now())`).trim();
  assert.match(month, /^\d{4}-\d{2}-01$/);

  const cleanup = () => {
    sql(`
      delete from public.capacity_reservations
      where restaurant_id in ('${R1}', '${R2}', '${R3}');
      delete from public.credit_swap_allowances where user_id = '${USER}';
      delete from public.redemptions where user_id = '${USER}';
      update public.challenge_items set credit_id = null
      where cycle_id = '${CYCLE}';
      delete from public.entitlement_credits where user_id = '${USER}';
      delete from public.challenge_items where cycle_id = '${CYCLE}';
      delete from public.challenge_cycles where id = '${CYCLE}';
      update public.restaurants set current_offer_version_id = null where market_id = '${MARKET}';
      delete from public.offer_versions where id in ('${V1}', '${V2}', '${V3}');
      delete from public.restaurants where market_id = '${MARKET}';
      delete from public.markets where id = '${MARKET}';
      delete from public.user_profiles where id = '${USER}';
      delete from auth.users where id = '${USER}';
    `);
  };

  sql(`
    insert into auth.users (id) values ('${USER}');
    insert into public.user_profiles (id, subscription_status, role, workflow_version)
      values ('${USER}', 'active', 'subscriber', 'credits');
    insert into public.markets (id, name, slug)
      values ('${MARKET}', 'E02 Swap Overlap', 'e02-swap-overlap');
    insert into public.restaurants (id, name, status, market_id) values
      ('${R1}', 'E02OL 1', 'active', '${MARKET}'),
      ('${R2}', 'E02OL 2', 'active', '${MARKET}'),
      ('${R3}', 'E02OL 3', 'active', '${MARKET}');
    insert into public.offer_versions (
      id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
      capacity_timezone, capacity_window_kind, capacity_max_redemptions
    ) values
      ('${V1}', '${R1}', 'America/Chicago', now() - interval '1 day', now() + interval '400 days',
        '[{"threshold_cents":4000,"discount_cents":2000}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
        'America/Chicago', 'calendar_month', 20),
      ('${V2}', '${R2}', 'America/Chicago', now() - interval '1 day', now() + interval '400 days',
        '[{"threshold_cents":4000,"discount_cents":2000}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
        'America/Chicago', 'calendar_month', 20),
      ('${V3}', '${R3}', 'America/Chicago', now() - interval '1 day', now() + interval '400 days',
        '[{"threshold_cents":4000,"discount_cents":2000}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
        'America/Chicago', 'calendar_month', 20);
    update public.restaurants set current_offer_version_id = '${V1}' where id = '${R1}';
    update public.restaurants set current_offer_version_id = '${V2}' where id = '${R2}';
    update public.restaurants set current_offer_version_id = '${V3}' where id = '${R3}';
    insert into public.challenge_cycles (id, user_id, cycle_month, status, swap_count_used)
      values ('${CYCLE}', '${USER}', '${month}', 'active', 0);
    insert into public.challenge_items (
      id, cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
    ) values
      ('${ITEM1}', '${CYCLE}', '${R1}', 1, 'assigned', '${V1}', now(), now() + interval '20 days'),
      ('${ITEM2}', '${CYCLE}', '${R2}', 2, 'assigned', '${V2}', now(), now() + interval '20 days');
    insert into public.entitlement_credits (
      id, user_id, issue_period, slot_number, status, challenge_item_id, expires_at
    ) values
      ('${CREDIT1}', '${USER}', '${month}', 1, 'linked', '${ITEM1}', now() + interval '60 days'),
      ('${CREDIT2}', '${USER}', '${month}', 2, 'linked', '${ITEM2}', now() + interval '60 days');
    update public.challenge_items set credit_id = '${CREDIT1}' where id = '${ITEM1}';
    update public.challenge_items set credit_id = '${CREDIT2}' where id = '${ITEM2}';
  `);

  try {
    {
      const issue = open();
      const swap = open();
      try {
        const issued = await issue.send(`BEGIN;
          set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
          set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
          select outcome from public.issue_challenge_redemption(
            '${USER}'::uuid, '${ITEM1}'::uuid,
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            'ciph', 'iviviviviviv', now() + interval '1 day');`);
        assertFinished(issued, 'created', 'issue held');
        const pending = swap.send(`set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
          set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
          select outcome from public.swap_linked_credit_item(
            '${USER}'::uuid, '${ITEM1}'::uuid, '${R3}'::uuid);`);
        await waitForLock(sql, 'swap_linked_credit_item');
        await issue.send('COMMIT;');
        const swapOutcome = await pending;
        assertFinished(swapOutcome, 'not_found', 'issue-then-swap');
        assert.equal(
          sql(`select status from public.challenge_items where id = '${ITEM1}'`).trim(),
          'redeemed',
        );
      } finally {
        issue.close();
        swap.close();
      }
    }

    {
      const swap = open();
      const issue = open();
      try {
        const swapHeld = await swap.send(`BEGIN;
          set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
          set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
          select outcome from public.swap_linked_credit_item(
            '${USER}'::uuid, '${ITEM2}'::uuid, '${R3}'::uuid);`);
        const pending = issue.send(`set lock_timeout = '${SESSION_LOCK_TIMEOUT}';
          set statement_timeout = '${SESSION_STATEMENT_TIMEOUT}';
          select outcome from public.issue_challenge_redemption(
            '${USER}'::uuid, '${ITEM2}'::uuid,
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            'ciph2', 'iviviviviviv', now() + interval '1 day');`);
        await waitForLock(sql, 'issue_challenge_redemption');
        await swap.send('COMMIT;');
        const issueOutcome = await pending;
        assertFinished(swapHeld, 'created', 'swap-then-issue swap');
        assertFinished(issueOutcome, 'not_assigned', 'swap-then-issue issue');
      } finally {
        swap.close();
        issue.close();
      }
    }
  } finally {
    cleanup();
  }
}
