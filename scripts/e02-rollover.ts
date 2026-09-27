import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chicagoMonthStart, dailyRunKey } from '@/lib/cron-period';
import {
  ROLLOVER_JOB,
  rolloverCredits,
  type RolloverLease,
  type RolloverNotice,
  type RolloverProfileQuery,
  type RolloverResult,
} from '@/lib/challenges/rollover-credits';
import type { Json } from '@/types/database.types';

const CARRY = 'e2e00000-0000-4000-8000-000000000001';
const LINKED_NOW = 'e2e00000-0000-4000-8000-000000000002';
const CROSS = 'e2e00000-0000-4000-8000-000000000003';
const ONE = 'e2e00000-0000-4000-8000-000000000004';
const FUTURE = 'e2e00000-0000-4000-8000-000000000005';
const OVERFLOW = 'e2e00000-0000-4000-8000-000000000006';
const PAST = 'e2e00000-0000-4000-8000-000000000007';
const LEGACY = 'e2e00000-0000-4000-8000-000000000008';
const INACTIVE = 'e2e00000-0000-4000-8000-000000000009';
const EXPIRY_PAST = 'e2e00000-0000-4000-8000-00000000000a';
const OVERLAP = 'e2e00000-0000-4000-8000-00000000000b';
const ADMIN = 'e2e00000-0000-4000-8000-00000000000c';
const MARKET = 'e2e00000-0000-4000-8000-000000000010';
const REST_A = 'e2e00000-0000-4000-8000-000000000021';
const REST_B = 'e2e00000-0000-4000-8000-000000000022';
const REST_ONE = 'e2e00000-0000-4000-8000-000000000031';
const REST_FUTURE = 'e2e00000-0000-4000-8000-000000000032';
const REST_OV1 = 'e2e00000-0000-4000-8000-000000000033';
const REST_OV2 = 'e2e00000-0000-4000-8000-000000000034';
const REST_OV3 = 'e2e00000-0000-4000-8000-000000000035';
const VER_A = 'e2e00000-0000-4000-8000-0000000000a1';
const VER_B = 'e2e00000-0000-4000-8000-0000000000a2';
const VER_ONE = 'e2e00000-0000-4000-8000-0000000000b1';
const VER_FUTURE = 'e2e00000-0000-4000-8000-0000000000b2';
const VER_OV1 = 'e2e00000-0000-4000-8000-0000000000b3';
const VER_OV2 = 'e2e00000-0000-4000-8000-0000000000b4';
const VER_OV3 = 'e2e00000-0000-4000-8000-0000000000b5';
const CARRY_1 = 'e2e00000-0000-4000-8000-000000000101';
const CARRY_2 = 'e2e00000-0000-4000-8000-000000000102';
const LINKED_PREV_1 = 'e2e00000-0000-4000-8000-000000000111';
const LINKED_PREV_2 = 'e2e00000-0000-4000-8000-000000000112';
const CROSS_OLD_1 = 'e2e00000-0000-4000-8000-000000000201';
const CROSS_OLD_2 = 'e2e00000-0000-4000-8000-000000000202';
const CROSS_PREV_1 = 'e2e00000-0000-4000-8000-000000000203';
const CROSS_PREV_2 = 'e2e00000-0000-4000-8000-000000000204';
const ONE_LINKED = 'e2e00000-0000-4000-8000-000000000301';
const ONE_NEWER = 'e2e00000-0000-4000-8000-000000000302';
const ONE_OLDER = 'e2e00000-0000-4000-8000-000000000303';
const FUTURE_T2 = 'e2e00000-0000-4000-8000-000000000401';
const FUTURE_T1 = 'e2e00000-0000-4000-8000-000000000402';
const FUTURE_LINKED = 'e2e00000-0000-4000-8000-000000000403';
const OV_L1 = 'e2e00000-0000-4000-8000-000000000501';
const OV_L2 = 'e2e00000-0000-4000-8000-000000000502';
const OV_L3 = 'e2e00000-0000-4000-8000-000000000503';
const OV_T1 = 'e2e00000-0000-4000-8000-000000000504';
const PAST_CREDIT = 'e2e00000-0000-4000-8000-000000000601';
const EXPIRY_CREDIT = 'e2e00000-0000-4000-8000-000000000701';
const INACTIVE_CREDIT = 'e2e00000-0000-4000-8000-000000000801';
const OVERLAP_1 = 'e2e00000-0000-4000-8000-000000000901';
const OVERLAP_2 = 'e2e00000-0000-4000-8000-000000000902';
const ONE_CYCLE = 'e2e00000-0000-4000-8000-000000000c01';
const FUTURE_CYCLE = 'e2e00000-0000-4000-8000-000000000c02';
const OV_CYCLE_2 = 'e2e00000-0000-4000-8000-000000000c03';
const OV_CYCLE_3 = 'e2e00000-0000-4000-8000-000000000c04';
const ONE_ITEM = 'e2e00000-0000-4000-8000-000000000d01';
const FUTURE_ITEM = 'e2e00000-0000-4000-8000-000000000d02';
const OV_ITEM_1 = 'e2e00000-0000-4000-8000-000000000d03';
const OV_ITEM_2 = 'e2e00000-0000-4000-8000-000000000d04';
const OV_ITEM_3 = 'e2e00000-0000-4000-8000-000000000d05';

const USERS = [
  CARRY, LINKED_NOW, CROSS, ONE, FUTURE, OVERFLOW, PAST, LEGACY, INACTIVE, EXPIRY_PAST, OVERLAP, ADMIN,
];
const SENTINEL = 'E02RO_DONE';

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
      if (slice.includes(SENTINEL)) return slice.replace(SENTINEL, '').trim();
      await delay(25);
    }
    throw new Error(`E02 rollover psql wait timed out: ${this.buffer.slice(-800)}`);
  }

  close() {
    this.child.stdin.end();
  }
}

function memoryLease(): RolloverLease & {
  items: Map<string, { status: string; error: string | null; detail: Json | null }>;
  failed: string | null;
  finished: boolean;
  finishedExtra: Json | null;
} {
  const items = new Map<string, { status: string; error: string | null; detail: Json | null }>();
  const lease = {
    checkpoint: null as Json | null,
    items,
    failed: null as string | null,
    finished: false,
    finishedExtra: null as Json | null,
    async guardPeriod() {
      return true;
    },
    async renew(next?: Json | null) {
      if (next !== undefined && next !== null) lease.checkpoint = next;
      return true;
    },
    async record(
      itemKey: string,
      status: 'pending' | 'succeeded' | 'skipped' | 'failed',
      error?: string | null,
      detail?: Json | null,
    ) {
      items.set(itemKey, { status, error: error ?? null, detail: detail ?? null });
      return true;
    },
    async listPending(limit: number) {
      return [...items.entries()]
        .filter(([, row]) => row.status === 'pending')
        .map(([itemKey]) => itemKey)
        .sort((left, right) => left.localeCompare(right))
        .slice(0, limit)
        .map((itemKey) => ({ itemKey }));
    },
    async fail(error: string) {
      lease.failed = error;
    },
    async finishClear(extra?: Json | null) {
      lease.finished = true;
      lease.finishedExtra = extra ?? null;
    },
  };
  return lease;
}

function assertUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`refusing non-uuid snapshot value ${value}`);
  }
  return value;
}

function daysInDbMonth(dbMonth: string): { first: Date; second: Date } {
  const match = /^(\d{4})-(\d{2})-01$/.exec(dbMonth);
  if (!match) throw new Error(`unexpected chicago month ${dbMonth}`);
  return {
    first: new Date(`${match[1]}-${match[2]}-15T12:00:00.000Z`),
    second: new Date(`${match[1]}-${match[2]}-16T12:00:00.000Z`),
  };
}

function detailOf(detail: Json | null): { outcome: string; exceptionInserted: boolean } {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
    return { outcome: '', exceptionInserted: false };
  }
  return {
    outcome: typeof detail.outcome === 'string' ? detail.outcome : '',
    exceptionInserted: detail.exceptionInserted === true,
  };
}

function exceptionCount(extra: Json | null): number {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return -1;
  return typeof extra.newExceptionCount === 'number' ? extra.newExceptionCount : -1;
}

function quotedUsers(): string {
  return USERS.map((id) => `'${id}'`).join(', ');
}

function period(monthsAgo: number): string {
  return `(public.chicago_month_start(now()) - interval '${monthsAgo} month')::date`;
}

function deadline(monthsAgo: number, monthsAhead: number): string {
  return `((${period(monthsAgo)} + interval '${monthsAhead} month')::timestamp at time zone 'America/Chicago')`;
}

function pendingCredit(
  id: string,
  userId: string,
  monthsAgo: number,
  slot: number,
  monthsAhead: number,
  issuedAt: string,
): string {
  return `
    insert into public.entitlement_credits (
      id, user_id, issue_period, slot_number, status, issued_at, expires_at
    ) values (
      '${id}', '${userId}', ${period(monthsAgo)}, ${slot}, 'pending', ${issuedAt}, ${deadline(monthsAgo, monthsAhead)}
    );`;
}

function versionRow(id: string, restaurantId: string): string {
  return `(
    '${id}', '${restaurantId}', 'America/Chicago', now() - interval '1 day', now() + interval '400 days',
    '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    'America/Chicago', 'calendar_month', 5, '${ADMIN}'
  )`;
}

function cycleRow(id: string, userId: string, monthsAgo: number): string {
  return `
    insert into public.challenge_cycles (id, user_id, cycle_month, status, swap_count_used)
    values ('${id}', '${userId}', ${period(monthsAgo)}, 'active', 0);`;
}

function linkedCredit(input: {
  creditId: string;
  itemId: string;
  cycleId: string;
  userId: string;
  restaurantId: string;
  versionId: string;
  monthsAgo: number;
  slot: number;
}): string {
  return `
    insert into public.challenge_items (
      id, cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
    ) values (
      '${input.itemId}', '${input.cycleId}', '${input.restaurantId}', ${input.slot}, 'assigned',
      '${input.versionId}', now(), now() + interval '840 hours'
    );
    insert into public.entitlement_credits (
      id, user_id, issue_period, slot_number, status, challenge_item_id, issued_at, expires_at
    ) values (
      '${input.creditId}', '${input.userId}', ${period(input.monthsAgo)}, ${input.slot}, 'linked',
      '${input.itemId}', timestamptz '2000-01-01+00', ${deadline(input.monthsAgo, 1)}
    );
    update public.challenge_items set credit_id = '${input.creditId}' where id = '${input.itemId}';
    insert into public.capacity_reservations (
      challenge_item_id, offer_version_id, restaurant_id, capacity_timezone, bucket_start, status
    ) values (
      '${input.itemId}', '${input.versionId}', '${input.restaurantId}', 'America/Chicago',
      public.chicago_month_start(now()), 'reserved'
    );
    insert into public.redemptions (
      user_id, restaurant_id, challenge_item_id, token_hash, encrypted_code, code_iv, status, expires_at
    ) values (
      '${input.userId}', '${input.restaurantId}', '${input.itemId}',
      repeat(replace('${input.creditId}', '-', ''), 2),
      'fixture-code', 'fixture-iv', 'issued', now() + interval '35 days'
    );`;
}

export async function runE02Rollover(opts: {
  docker: string;
  host: string;
  containerId: string;
  sql: (query: string) => string;
}): Promise<void> {
  const { docker, host, containerId, sql } = opts;
  const scalar = (query: string) => sql(query).trim();
  const month = scalar(`select public.chicago_month_start(now())`);
  assert.match(month, /^\d{4}-\d{2}-01$/);
  const { first, second } = daysInDbMonth(month);
  assert.equal(chicagoMonthStart(first), month);
  assert.equal(chicagoMonthStart(second), month);
  const firstKey = dailyRunKey(ROLLOVER_JOB, first);
  const secondKey = dailyRunKey(ROLLOVER_JOB, second);
  assert.notEqual(firstKey, secondKey);

  const queries: RolloverProfileQuery[] = [];
  const calls: { userId: string; outcome: string; exceptionInserted: boolean }[] = [];

  async function listProfiles(query: RolloverProfileQuery): Promise<{ id: string }[]> {
    queries.push({ ...query });
    if (!/^[a-z_]+$/.test(query.subscriptionStatus) || !/^[a-z_]+$/.test(query.workflowVersion)) {
      throw new Error('refusing unsafe snapshot filter');
    }
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 1000) {
      throw new Error('refusing unsafe snapshot limit');
    }
    const after = query.afterId ? `and id > '${assertUuid(query.afterId)}'` : '';
    const raw = sql(`select id from public.user_profiles
      where subscription_status = '${query.subscriptionStatus}'
        and workflow_version = '${query.workflowVersion}'
        ${after}
      order by id
      limit ${query.limit}`);
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((id) => ({ id: assertUuid(id) }));
  }

  async function rolloverUser(userId: string): Promise<RolloverResult> {
    const raw = scalar(
      `select outcome, exception_inserted from public.rollover_credits('${assertUuid(userId)}'::uuid)`,
    );
    const [outcome, inserted] = raw.split('|');
    const result = { outcome: outcome ?? '', exceptionInserted: inserted === 't' };
    calls.push({ userId, ...result });
    return result;
  }

  function creditMark(id: string): string {
    return scalar(`select slot_number::text || ':' || status || ':' ||
      (expires_at is not distinct from ((issue_period + interval '1 month')::timestamp at time zone 'America/Chicago'))::text || ':' ||
      (expires_at is not distinct from ((issue_period + interval '2 months')::timestamp at time zone 'America/Chicago'))::text
      from public.entitlement_credits where id = '${id}'`);
  }

  function promiseMark(userId: string, monthsAgo: number): string {
    return scalar(`select coalesce(string_agg(
      ec.slot_number::text || ':' || ec.status || ':' || ec.challenge_item_id::text || ':' ||
      ci.redemption_deadline::text || ':' || ci.offer_version_id::text || ':' || cr.status || ':' || cr.id::text,
      ',' order by ec.slot_number, cr.bucket_start
    ), '')
    from public.entitlement_credits ec
    join public.challenge_items ci on ci.id = ec.challenge_item_id
    join public.capacity_reservations cr on cr.challenge_item_id = ci.id
    where ec.user_id = '${userId}' and ec.issue_period = ${period(monthsAgo)}`);
  }

  let left: PsqlSession | null = null;
  let right: PsqlSession | null = null;
  try {
    sql(`
      insert into auth.users (id) values
        ${USERS.filter((id) => id !== OVERLAP).map((id) => `('${id}')`).join(', ')};
      insert into public.user_profiles (id, subscription_status, role, workflow_version) values
        ('${CARRY}', 'active', 'subscriber', 'credits'),
        ('${LINKED_NOW}', 'active', 'subscriber', 'credits'),
        ('${CROSS}', 'active', 'subscriber', 'credits'),
        ('${ONE}', 'active', 'subscriber', 'credits'),
        ('${FUTURE}', 'active', 'subscriber', 'credits'),
        ('${OVERFLOW}', 'active', 'subscriber', 'credits'),
        ('${PAST}', 'active', 'subscriber', 'credits'),
        ('${LEGACY}', 'active', 'subscriber', 'legacy'),
        ('${INACTIVE}', 'inactive', 'subscriber', 'credits'),
        ('${EXPIRY_PAST}', 'active', 'subscriber', 'credits'),
        ('${ADMIN}', 'active', 'admin', 'legacy');
      insert into public.markets (id, name, slug) values ('${MARKET}', 'E02 Rollover', 'e02-rollover');
      insert into public.restaurants (id, name, status, market_id) values
        ('${REST_A}', 'E02RO A', 'active', '${MARKET}'),
        ('${REST_B}', 'E02RO B', 'active', '${MARKET}'),
        ('${REST_ONE}', 'E02RO One', 'active', '${MARKET}'),
        ('${REST_FUTURE}', 'E02RO Future', 'active', '${MARKET}'),
        ('${REST_OV1}', 'E02RO Ov1', 'active', '${MARKET}'),
        ('${REST_OV2}', 'E02RO Ov2', 'active', '${MARKET}'),
        ('${REST_OV3}', 'E02RO Ov3', 'active', '${MARKET}');
      insert into public.offer_versions (
        id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
        capacity_timezone, capacity_window_kind, capacity_max_redemptions, published_by
      ) values
        ${versionRow(VER_A, REST_A)},
        ${versionRow(VER_B, REST_B)},
        ${versionRow(VER_ONE, REST_ONE)},
        ${versionRow(VER_FUTURE, REST_FUTURE)},
        ${versionRow(VER_OV1, REST_OV1)},
        ${versionRow(VER_OV2, REST_OV2)},
        ${versionRow(VER_OV3, REST_OV3)};
      update public.restaurants set current_offer_version_id = '${VER_A}' where id = '${REST_A}';
      update public.restaurants set current_offer_version_id = '${VER_B}' where id = '${REST_B}';
      update public.restaurants set current_offer_version_id = '${VER_ONE}' where id = '${REST_ONE}';
      update public.restaurants set current_offer_version_id = '${VER_FUTURE}' where id = '${REST_FUTURE}';
      update public.restaurants set current_offer_version_id = '${VER_OV1}' where id = '${REST_OV1}';
      update public.restaurants set current_offer_version_id = '${VER_OV2}' where id = '${REST_OV2}';
      update public.restaurants set current_offer_version_id = '${VER_OV3}' where id = '${REST_OV3}';
      ${pendingCredit(CARRY_1, CARRY, 1, 1, 1, `timestamptz '2000-01-01+00'`)}
      ${pendingCredit(CARRY_2, CARRY, 1, 2, 1, `timestamptz '2000-01-02+00'`)}
      ${pendingCredit(LINKED_PREV_1, LINKED_NOW, 1, 1, 1, `timestamptz '2000-01-01+00'`)}
      ${pendingCredit(LINKED_PREV_2, LINKED_NOW, 1, 2, 1, `timestamptz '2000-01-02+00'`)}
      ${pendingCredit(CROSS_OLD_1, CROSS, 2, 1, 1, `timestamptz '2000-01-01+00'`)}
      ${pendingCredit(CROSS_OLD_2, CROSS, 2, 2, 1, `timestamptz '2000-01-02+00'`)}
      ${pendingCredit(CROSS_PREV_1, CROSS, 1, 1, 1, `timestamptz '2000-02-01+00'`)}
      ${pendingCredit(CROSS_PREV_2, CROSS, 1, 2, 1, `timestamptz '2000-02-02+00'`)}
      ${pendingCredit(ONE_NEWER, ONE, 1, 1, 1, `timestamptz '2000-06-01+00'`)}
      ${pendingCredit(ONE_OLDER, ONE, 1, 2, 1, `timestamptz '2000-01-01+00'`)}
      ${pendingCredit(FUTURE_T2, FUTURE, 1, 1, 2, `timestamptz '2000-01-01+00'`)}
      ${pendingCredit(FUTURE_T1, FUTURE, 1, 2, 1, `timestamptz '2000-01-02+00'`)}
      ${pendingCredit(OV_T1, OVERFLOW, 1, 1, 1, `timestamptz '2000-01-01+00'`)}
      ${pendingCredit(EXPIRY_CREDIT, EXPIRY_PAST, 2, 1, 2, `timestamptz '2000-01-01+00'`)}
      ${pendingCredit(INACTIVE_CREDIT, INACTIVE, 1, 1, 1, `timestamptz '2000-01-01+00'`)}
      ${cycleRow(ONE_CYCLE, ONE, 2)}
      ${cycleRow(FUTURE_CYCLE, FUTURE, 2)}
      ${cycleRow(OV_CYCLE_2, OVERFLOW, 2)}
      ${cycleRow(OV_CYCLE_3, OVERFLOW, 3)}
      ${linkedCredit({
        creditId: ONE_LINKED, itemId: ONE_ITEM, cycleId: ONE_CYCLE, userId: ONE,
        restaurantId: REST_ONE, versionId: VER_ONE, monthsAgo: 2, slot: 1,
      })}
      ${linkedCredit({
        creditId: FUTURE_LINKED, itemId: FUTURE_ITEM, cycleId: FUTURE_CYCLE, userId: FUTURE,
        restaurantId: REST_FUTURE, versionId: VER_FUTURE, monthsAgo: 2, slot: 1,
      })}
      ${linkedCredit({
        creditId: OV_L1, itemId: OV_ITEM_1, cycleId: OV_CYCLE_2, userId: OVERFLOW,
        restaurantId: REST_OV1, versionId: VER_OV1, monthsAgo: 2, slot: 1,
      })}
      ${linkedCredit({
        creditId: OV_L2, itemId: OV_ITEM_2, cycleId: OV_CYCLE_2, userId: OVERFLOW,
        restaurantId: REST_OV2, versionId: VER_OV2, monthsAgo: 2, slot: 2,
      })}
      ${linkedCredit({
        creditId: OV_L3, itemId: OV_ITEM_3, cycleId: OV_CYCLE_3, userId: OVERFLOW,
        restaurantId: REST_OV3, versionId: VER_OV3, monthsAgo: 3, slot: 1,
      })}
    `);

    assert.equal(scalar(`select public.issue_period_credits('${CARRY}'::uuid, public.chicago_month_start(now()))`), 'created');
    assert.equal(scalar(`select public.issue_period_credits('${LINKED_NOW}'::uuid, public.chicago_month_start(now()))`), 'created');
    assert.equal(scalar(`select outcome from public.link_pending_credits(
      '${LINKED_NOW}'::uuid, public.chicago_month_start(now()), '${MARKET}'::uuid,
      '${REST_A}'::uuid, '${REST_B}'::uuid)`), 'linked');

    scalar(`select public.expire_due_pending_credits()`);
    assert.equal(creditMark(CARRY_1), '1:pending:true:false');
    assert.equal(creditMark(INACTIVE_CREDIT), '1:expired:true:false');
    assert.equal(creditMark(EXPIRY_CREDIT), '1:expired:false:true');
    process.stdout.write(
      'Expiry function, not a worker snapshot hit: inactive credits due T1 expired.\n',
    );
    process.stdout.write(
      'Expiry function expired an active credits past-T2 row before the worker.\n',
    );

    sql(pendingCredit(PAST_CREDIT, PAST, 2, 1, 2, `timestamptz '2000-01-01+00'`));
    const linkedNowBefore = promiseMark(LINKED_NOW, 0);
    const oneBefore = promiseMark(ONE, 2);
    const futureBefore = promiseMark(FUTURE, 2);
    const overflowBefore = scalar(`select coalesce(string_agg(
      ec.id::text || ':' || ec.status || ':' || ci.redemption_deadline::text || ':' || cr.status,
      ',' order by ec.id
    ), '')
    from public.entitlement_credits ec
    join public.challenge_items ci on ci.id = ec.challenge_item_id
    join public.capacity_reservations cr on cr.challenge_item_id = ci.id
    where ec.user_id = '${OVERFLOW}' and ec.status = 'linked'`);
    assert.notEqual(linkedNowBefore, '');
    assert.notEqual(oneBefore, '');
    assert.notEqual(futureBefore, '');
    assert.notEqual(overflowBefore, '');

    const firstNotices: RolloverNotice[] = [];
    const firstLease = memoryLease();
    const callsBeforeSecond = () => calls.length;
    await rolloverCredits({
      now: first,
      runKey: firstKey,
      listProfiles,
      rolloverUser,
      notifyOperator: async (notice) => {
        firstNotices.push(notice);
      },
      lease: firstLease,
    });
    assert.equal(firstLease.failed, null);
    assert.equal(firstLease.finished, true);
    assert.equal(queries[0]?.subscriptionStatus, 'active');
    assert.equal(queries[0]?.workflowVersion, 'credits');
    assert.equal(firstLease.items.has(LEGACY), false);
    assert.equal(firstLease.items.has(INACTIVE), false);
    assert.equal(calls.some((row) => row.userId === LEGACY || row.userId === INACTIVE), false);
    assert.equal(scalar(`select count(*) from public.entitlement_credits where user_id = '${LEGACY}'`), '0');

    assert.equal(detailOf(firstLease.items.get(CARRY)?.detail ?? null).outcome, 'rolled');
    assert.equal(firstLease.items.get(CARRY)?.status, 'succeeded');
    assert.equal(creditMark(CARRY_1), '1:pending:false:true');
    assert.equal(creditMark(CARRY_2), '2:pending:false:true');
    assert.equal(scalar(`select count(*) from public.entitlement_credits where user_id = '${CARRY}'`), '4');
    assert.equal(scalar(`select count(*) from public.entitlement_credits
      where user_id = '${CARRY}' and issue_period = public.chicago_month_start(now())
        and status = 'pending' and challenge_item_id is null
        and expires_at is not distinct from ((issue_period + interval '1 month')::timestamp at time zone 'America/Chicago')`), '2');
    assert.equal(scalar(`select count(*) from public.challenge_cycles where user_id = '${CARRY}'`), '0');

    assert.equal(detailOf(firstLease.items.get(LINKED_NOW)?.detail ?? null).outcome, 'rolled');
    assert.equal(creditMark(LINKED_PREV_1), '1:pending:false:true');
    assert.equal(creditMark(LINKED_PREV_2), '2:pending:false:true');
    assert.equal(promiseMark(LINKED_NOW, 0), linkedNowBefore);
    assert.equal(scalar(`select count(*) from public.entitlement_credits
      where user_id = '${LINKED_NOW}' and status = 'linked'`), '2');
    assert.equal(scalar(`select count(*) from public.entitlement_credits
      where user_id = '${LINKED_NOW}' and status = 'pending'`), '2');

    assert.equal(detailOf(firstLease.items.get(CROSS)?.detail ?? null).outcome, 'rolled');
    assert.equal(creditMark(CROSS_OLD_1), '1:expired:true:false');
    assert.equal(creditMark(CROSS_OLD_2), '2:expired:true:false');
    assert.equal(creditMark(CROSS_PREV_1), '1:pending:false:true');
    assert.equal(creditMark(CROSS_PREV_2), '2:pending:false:true');
    assert.equal(scalar(`select count(*) from public.challenge_cycles where user_id = '${CROSS}'`), '0');

    assert.equal(detailOf(firstLease.items.get(ONE)?.detail ?? null).outcome, 'rolled');
    assert.equal(creditMark(ONE_OLDER), '2:pending:false:true');
    assert.equal(creditMark(ONE_NEWER), '1:expired:true:false');
    assert.equal(creditMark(ONE_LINKED), '1:linked:true:false');
    assert.equal(promiseMark(ONE, 2), oneBefore);

    // Previous month has two slots. A future T2 plus two eligible T1 rows cannot be inserted.
    // Slot 1 is already at a future T2, slot 2 is still at T1, and one older linked credit
    // occupies the other keep slot. additional is 0, so the T1 expires. If the future T2
    // did not count, that T1 would be carried.
    assert.equal(detailOf(firstLease.items.get(FUTURE)?.detail ?? null).outcome, 'rolled');
    assert.equal(creditMark(FUTURE_T2), '1:pending:false:true');
    assert.equal(creditMark(FUTURE_T1), '2:expired:true:false');
    assert.equal(creditMark(FUTURE_LINKED), '1:linked:true:false');
    assert.equal(promiseMark(FUTURE, 2), futureBefore);

    const overflowDetail = detailOf(firstLease.items.get(OVERFLOW)?.detail ?? null);
    assert.equal(overflowDetail.outcome, 'rolled_with_exception');
    assert.equal(overflowDetail.exceptionInserted, true);
    assert.equal(firstLease.items.get(OVERFLOW)?.status, 'failed');
    assert.equal(exceptionCount(firstLease.finishedExtra), 1);
    assert.deepEqual(firstNotices, [{ userId: OVERFLOW, chicagoMonth: month, outcome: 'rolled_with_exception' }]);
    assert.equal(creditMark(OV_T1), '1:expired:true:false');
    assert.equal(scalar(`select count(*) from public.credit_rollover_exceptions where user_id = '${OVERFLOW}'`), '1');
    assert.equal(scalar(`select linked_uncompleted_count::text || ':' || future_t2_count::text || ':' || reason
      from public.credit_rollover_exceptions where user_id = '${OVERFLOW}'`), '3:0:carry_cap_exceeded');
    assert.equal(scalar(`select coalesce(string_agg(
      ec.id::text || ':' || ec.status || ':' || ci.redemption_deadline::text || ':' || cr.status,
      ',' order by ec.id
    ), '')
    from public.entitlement_credits ec
    join public.challenge_items ci on ci.id = ec.challenge_item_id
    join public.capacity_reservations cr on cr.challenge_item_id = ci.id
    where ec.user_id = '${OVERFLOW}' and ec.status = 'linked'`), overflowBefore);

    assert.equal(detailOf(firstLease.items.get(PAST)?.detail ?? null).outcome, 'rolled');
    assert.equal(creditMark(PAST_CREDIT), '1:expired:false:true');
    assert.equal(detailOf(firstLease.items.get(EXPIRY_PAST)?.detail ?? null).outcome, 'unchanged');
    assert.equal(scalar(`select count(*) from public.entitlement_credits where user_id in ('${CARRY}', '${LINKED_NOW}', '${CROSS}', '${ONE}', '${FUTURE}', '${OVERFLOW}', '${PAST}')`), '23');

    const beforeSecond = callsBeforeSecond();
    const secondNotices: RolloverNotice[] = [];
    const secondLease = memoryLease();
    await rolloverCredits({
      now: second,
      runKey: secondKey,
      listProfiles,
      rolloverUser,
      notifyOperator: async (notice) => {
        secondNotices.push(notice);
      },
      lease: secondLease,
    });
    assert.equal(secondLease.failed, null);
    assert.equal(secondLease.finished, true);
    assert.equal(secondLease.items.has(LEGACY), false);
    assert.equal(secondLease.items.has(INACTIVE), false);
    assert.equal(detailOf(secondLease.items.get(CARRY)?.detail ?? null).outcome, 'unchanged');
    assert.equal(secondLease.items.get(CARRY)?.status, 'succeeded');
    assert.equal(creditMark(CARRY_1), '1:pending:false:true');
    assert.equal(creditMark(CARRY_2), '2:pending:false:true');
    assert.equal(scalar(`select count(*) from public.entitlement_credits where user_id = '${CARRY}'`), '4');
    assert.equal(promiseMark(LINKED_NOW, 0), linkedNowBefore);
    const secondOverflow = detailOf(secondLease.items.get(OVERFLOW)?.detail ?? null);
    assert.equal(secondOverflow.outcome, 'rolled_with_exception');
    assert.equal(secondOverflow.exceptionInserted, false);
    assert.equal(secondLease.items.get(OVERFLOW)?.status, 'failed');
    assert.equal(exceptionCount(secondLease.finishedExtra), 0);
    assert.deepEqual(secondNotices, [{ userId: OVERFLOW, chicagoMonth: month, outcome: 'rolled_with_exception' }]);
    assert.equal(scalar(`select count(*) from public.credit_rollover_exceptions where user_id = '${OVERFLOW}'`), '1');
    assert.equal(calls.slice(beforeSecond).some((row) => row.userId === OVERFLOW && row.exceptionInserted), false);
    process.stdout.write('Worker path: rolloverCredits carry, second day, and overflow alert.\n');

    sql(`
      insert into auth.users (id) values ('${OVERLAP}');
      insert into public.user_profiles (id, subscription_status, role, workflow_version)
        values ('${OVERLAP}', 'active', 'subscriber', 'credits');
      ${pendingCredit(OVERLAP_1, OVERLAP, 1, 1, 1, `timestamptz '2000-01-01+00'`)}
      ${pendingCredit(OVERLAP_2, OVERLAP, 1, 2, 1, `timestamptz '2000-01-02+00'`)}
    `);
    left = new PsqlSession(docker, host, containerId);
    right = new PsqlSession(docker, host, containerId);
    const overlapSql = `set lock_timeout = '3s';
      set statement_timeout = '10s';
      select outcome, exception_inserted from public.rollover_credits('${OVERLAP}'::uuid);`;
    const [leftOutcome, rightOutcome] = await Promise.all([left.send(overlapSql), right.send(overlapSql)]);
    for (const outcome of [leftOutcome, rightOutcome]) {
      const line = outcome.split('\n').map((part) => part.trim()).filter((part) => part.length > 0).pop() ?? '';
      assert.match(line, /^(rolled|unchanged)\|f$/, `overlap outcome ${outcome}`);
    }
    assert.equal(creditMark(OVERLAP_1), '1:pending:false:true');
    assert.equal(creditMark(OVERLAP_2), '2:pending:false:true');
    assert.equal(scalar(`select count(*) from public.entitlement_credits where user_id = '${OVERLAP}'`), '2');
    assert.equal(scalar(`select count(*) from public.credit_rollover_exceptions where user_id = '${OVERLAP}'`), '0');
    process.stdout.write(
      'SQL verification: overlapping rollover_credits left the same end state as one call. This is not a worker-path pass.\n',
    );
  } finally {
    left?.close();
    right?.close();
    sql(`
      delete from public.capacity_reservations
      where restaurant_id in (select id from public.restaurants where market_id = '${MARKET}')
         or challenge_item_id in (
           select ci.id from public.challenge_items ci
           join public.challenge_cycles cc on cc.id = ci.cycle_id
           where cc.user_id in (${quotedUsers()})
         );
      delete from public.redemptions
      where user_id in (${quotedUsers()})
         or challenge_item_id in (
           select ci.id from public.challenge_items ci
           join public.challenge_cycles cc on cc.id = ci.cycle_id
           where cc.user_id in (${quotedUsers()})
         );
      update public.challenge_items set credit_id = null
      where cycle_id in (select id from public.challenge_cycles where user_id in (${quotedUsers()}));
      delete from public.entitlement_credits where user_id in (${quotedUsers()});
      delete from public.challenge_items
      where cycle_id in (select id from public.challenge_cycles where user_id in (${quotedUsers()}));
      delete from public.challenge_cycles where user_id in (${quotedUsers()});
      update public.restaurants set current_offer_version_id = null where market_id = '${MARKET}';
      delete from public.offer_versions where published_by = '${ADMIN}';
      delete from public.restaurants where market_id = '${MARKET}';
      delete from public.markets where id = '${MARKET}';
      delete from public.credit_rollover_exceptions where user_id in (${quotedUsers()});
      delete from public.user_profiles where id in (${quotedUsers()});
      delete from auth.users where id in (${quotedUsers()});
    `);
  }
}
