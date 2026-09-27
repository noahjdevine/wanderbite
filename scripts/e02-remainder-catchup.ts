import assert from 'node:assert/strict';
import { chicagoMonthStart, dailyRunKey } from '@/lib/cron-period';
import {
  CREDIT_CATCHUP_JOB,
  issueCreditCatchup,
  type CreditCatchupLease,
  type CreditCatchupProfileQuery,
} from '@/lib/challenges/issue-credit-catchup';
import type { Json } from '@/types/database.types';

const MISSED = 'e2rc0000-0000-4000-8000-000000000001';
const LEGACY = 'e2rc0000-0000-4000-8000-000000000002';
const LATER = 'e2rc0000-0000-4000-8000-000000000004';

type IssueCall = { userId: string; period: string; outcome: string };

function memoryLease(): CreditCatchupLease & {
  items: Map<string, { status: string; error: string | null; detail: Json | null }>;
  failed: string | null;
  finished: boolean;
} {
  const items = new Map<string, { status: string; error: string | null; detail: Json | null }>();
  const lease = {
    checkpoint: null as Json | null,
    items,
    failed: null as string | null,
    finished: false,
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
    async finishClear() {
      lease.finished = true;
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

function outcomeOf(detail: Json | null): string {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return '';
  const outcome = detail.outcome;
  return typeof outcome === 'string' ? outcome : '';
}

export async function runE02RemainderCatchup(opts: {
  sql: (query: string) => string;
}): Promise<void> {
  const { sql } = opts;
  const month = sql(`select public.chicago_month_start(now())`).trim();
  assert.match(month, /^\d{4}-\d{2}-01$/);
  const { first, second } = daysInDbMonth(month);
  assert.equal(chicagoMonthStart(first), month);
  assert.equal(chicagoMonthStart(second), month);
  const firstKey = dailyRunKey(CREDIT_CATCHUP_JOB, first);
  const secondKey = dailyRunKey(CREDIT_CATCHUP_JOB, second);
  assert.notEqual(firstKey, secondKey);

  const queries: CreditCatchupProfileQuery[] = [];
  const issues: IssueCall[] = [];

  async function listProfiles(query: CreditCatchupProfileQuery): Promise<{ id: string }[]> {
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

  async function issuePeriodCredits(userId: string, issuePeriod: string): Promise<string> {
    assert.match(issuePeriod, /^\d{4}-\d{2}-\d{2}$/);
    const outcome = sql(
      `select public.issue_period_credits('${assertUuid(userId)}'::uuid, '${issuePeriod}'::date)`,
    ).trim();
    issues.push({ userId, period: issuePeriod, outcome });
    return outcome;
  }

  try {
    sql(`
      insert into auth.users (id) values ('${MISSED}'), ('${LEGACY}'), ('${LATER}');
      insert into public.user_profiles (id, subscription_status, role, workflow_version) values
        ('${MISSED}', 'active', 'subscriber', 'credits'),
        ('${LEGACY}', 'active', 'subscriber', 'legacy'),
        ('${LATER}', 'inactive', 'subscriber', 'credits');
    `);
    const firstLease = memoryLease();
    await issueCreditCatchup({
      now: first,
      runKey: firstKey,
      listProfiles,
      issuePeriodCredits,
      lease: firstLease,
    });
    assert.equal(firstLease.failed, null);
    assert.equal(firstLease.finished, true);
    assert.ok(
      queries.some((query) => query.subscriptionStatus === 'active' && query.workflowVersion === 'credits'),
      'worker did not pass the active credits snapshot',
    );
    assert.equal(firstLease.items.has(LEGACY), false);
    assert.equal(firstLease.items.has(LATER), false);
    assert.equal(outcomeOf(firstLease.items.get(MISSED)?.detail ?? null), 'created');
    assert.equal(
      issues.filter((row) => row.userId === MISSED).map((row) => row.outcome).join(','),
      'created',
    );
    assert.equal(issues.some((row) => row.userId === LEGACY || row.userId === LATER), false);
    assert.equal(sql(`select count(*) from public.entitlement_credits where user_id = '${MISSED}'`).trim(), '2');
    assert.equal(sql(`select count(*) from public.entitlement_credits
      where user_id = '${MISSED}' and status = 'pending'`).trim(), '2');
    assert.equal(sql(`select count(*) from public.challenge_cycles where user_id = '${MISSED}'`).trim(), '0');
    assert.equal(sql(`select count(*) from public.entitlement_credits where user_id = '${LEGACY}'`).trim(), '0');
    assert.equal(sql(`select count(*) from public.entitlement_credits where user_id = '${LATER}'`).trim(), '0');

    sql(`update public.user_profiles set subscription_status = 'active' where id = '${LATER}'`);
    const beforeSecond = issues.length;
    const secondLease = memoryLease();
    await issueCreditCatchup({
      now: second,
      runKey: secondKey,
      listProfiles,
      issuePeriodCredits,
      lease: secondLease,
    });
    assert.equal(secondLease.failed, null);
    assert.equal(secondLease.finished, true);
    assert.equal(secondLease.items.has(LEGACY), false);
    assert.equal(outcomeOf(secondLease.items.get(MISSED)?.detail ?? null), 'existing');
    assert.equal(outcomeOf(secondLease.items.get(LATER)?.detail ?? null), 'created');
    const secondIssues = issues.slice(beforeSecond);
    assert.equal(
      secondIssues.find((row) => row.userId === MISSED)?.outcome,
      'existing',
    );
    assert.equal(
      secondIssues.find((row) => row.userId === LATER)?.outcome,
      'created',
    );
    assert.equal(secondIssues.every((row) => row.period === month), true);
    assert.equal(sql(`select count(*) from public.entitlement_credits where user_id = '${MISSED}'`).trim(), '2');
    assert.equal(sql(`select count(*) from public.entitlement_credits where user_id = '${LATER}' and status = 'pending'`).trim(), '2');
    assert.equal(sql(`select count(*) from public.challenge_cycles where user_id in ('${MISSED}', '${LATER}', '${LEGACY}')`).trim(), '0');
    assert.equal(sql(`select count(*) from public.entitlement_credits where user_id = '${LEGACY}'`).trim(), '0');

    const previous = sql(`select public.issue_period_credits(
      '${MISSED}'::uuid, ('${month}'::date - interval '1 month')::date)`).trim();
    assert.equal(previous, 'local_month_not_open');
    assert.equal(sql(`select count(*) from public.entitlement_credits where user_id = '${MISSED}'`).trim(), '2');
    process.stdout.write(
      'RPC-only: previous month is local_month_not_open. This is not a worker-path pass.\n',
    );
  } finally {
    sql(`
      delete from public.entitlement_credits
      where user_id in ('${MISSED}', '${LEGACY}', '${LATER}');
      delete from public.user_profiles where id in ('${MISSED}', '${LEGACY}', '${LATER}');
      delete from auth.users where id in ('${MISSED}', '${LEGACY}', '${LATER}');
    `);
  }
}
