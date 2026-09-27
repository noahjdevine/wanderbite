import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dailyRunKey } from '@/lib/cron-period';
import {
  ROLLOVER_BATCH,
  ROLLOVER_JOB,
  rolloverCredits,
  rolloverItemStatus,
  type RolloverLease,
  type RolloverNotice,
  type RolloverProfileQuery,
  type RolloverResult,
} from '@/lib/challenges/rollover-credits';
import type { Json } from '@/types/database.types';

const ROOT = path.resolve(__dirname, '../../..');

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
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

describe('rollover outcomes', () => {
  it('fails a carry-cap exception and succeeds only for rolled and unchanged', () => {
    expect(rolloverItemStatus('rolled')).toBe('succeeded');
    expect(rolloverItemStatus('unchanged')).toBe('succeeded');
    expect(rolloverItemStatus('rolled_with_exception')).toBe('failed');
    expect(rolloverItemStatus('legacy_workflow')).toBe('skipped');
    expect(rolloverItemStatus('inactive_subscription')).toBe('skipped');
    expect(rolloverItemStatus('capacity_full')).toBe('failed');
  });
});

describe('rolloverCredits', () => {
  const now = new Date('2026-03-16T12:00:00.000Z');
  const userId = 'e2e00000-0000-4000-8000-000000000006';

  it('rejects a run key that is not the daily key for that instant', async () => {
    const queries: RolloverProfileQuery[] = [];
    const lease = memoryLease();
    await rolloverCredits({
      now,
      runKey: `${ROLLOVER_JOB}:2026-03-15`,
      listProfiles: async (query) => {
        queries.push(query);
        return [];
      },
      rolloverUser: async () => ({ outcome: 'rolled', exceptionInserted: false }),
      notifyOperator: async () => undefined,
      lease,
    });
    expect(queries).toEqual([]);
    expect(lease.failed).toBe(`credit rollover run key must be ${dailyRunKey(ROLLOVER_JOB, now)}`);
    expect(lease.finished).toBe(false);
  });

  it('asks for active credits profiles and records a new exception as failed', async () => {
    const queries: RolloverProfileQuery[] = [];
    const notices: RolloverNotice[] = [];
    const ids = Array.from({ length: ROLLOVER_BATCH }, (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    const lease = memoryLease();
    await rolloverCredits({
      now,
      runKey: dailyRunKey(ROLLOVER_JOB, now),
      listProfiles: async (query) => {
        queries.push(query);
        if (query.afterId == null) return ids.map((id) => ({ id }));
        return [];
      },
      rolloverUser: async (id): Promise<RolloverResult> => {
        if (id === ids[0]) return { outcome: 'rolled_with_exception', exceptionInserted: true };
        return { outcome: 'rolled', exceptionInserted: false };
      },
      notifyOperator: async (notice) => {
        notices.push(notice);
      },
      lease,
    });
    expect(queries[0]).toEqual({
      subscriptionStatus: 'active',
      workflowVersion: 'credits',
      afterId: null,
      limit: ROLLOVER_BATCH,
    });
    expect(lease.items.get(ids[0])?.status).toBe('failed');
    expect(lease.items.get(ids[1])?.status).toBe('succeeded');
    expect(notices).toEqual([
      {
        userId: ids[0],
        chicagoMonth: '2026-03-01',
        outcome: 'rolled_with_exception',
      },
    ]);
    expect(lease.finishedExtra).toEqual({ newExceptionCount: 1 });
    expect(lease.finished).toBe(true);
  });

  it('alerts again when the exception row was already present', async () => {
    const notices: RolloverNotice[] = [];
    const lease = memoryLease();
    await rolloverCredits({
      now,
      runKey: dailyRunKey(ROLLOVER_JOB, now),
      listProfiles: async (query) => (query.afterId == null ? [{ id: userId }] : []),
      rolloverUser: async () => ({ outcome: 'rolled_with_exception', exceptionInserted: false }),
      notifyOperator: async (notice) => {
        notices.push(notice);
      },
      lease,
    });
    expect(lease.items.get(userId)?.status).toBe('failed');
    expect(notices).toHaveLength(1);
    expect(lease.finishedExtra).toEqual({ newExceptionCount: 0 });
  });
});

describe('rollover route source', () => {
  const route = source('src/app/api/cron/rollover-credits/route.ts');
  const worker = source('src/lib/challenges/rollover-credits.ts');
  const vercel = source('vercel.json');

  it('calls the extracted worker for active credits and alerts a failed carry', () => {
    expect(route).toContain('rolloverCredits');
    expect(route).toContain('rollover_credits');
    expect(route).toContain("query.subscriptionStatus !== 'active'");
    expect(route).toContain("query.workflowVersion !== 'credits'");
    expect(route).toContain(".eq('subscription_status', query.subscriptionStatus)");
    expect(route).toContain(".eq('workflow_version', query.workflowVersion)");
    expect(route).toContain("outcome === 'rolled_with_exception'");
    expect(route).toContain("rolloverItemStatus(outcome) === 'failed'");
    expect(route).toContain('Sentry.captureMessage');
    expect(route).toContain('resumeExpired: true');
    expect(route).toContain('allowNewAttempt: false');
    expect(route).toContain('dailyRunKey');
    expect(route).not.toContain('generateMonthlyChallengeForUser');
    expect(route).not.toContain('link_pending_credits');
    expect(route).not.toContain('issue_period_credits');
    expect(worker).toContain('guardPeriod');
    expect(worker).toContain("subscriptionStatus: 'active'");
    expect(worker).toContain("workflowVersion: 'credits'");
    expect(worker).toMatch(/outcome === 'rolled_with_exception'[\s\S]*return 'failed'/);
    expect(vercel).toContain('"/api/cron/rollover-credits"');
    expect(vercel).toContain('"schedule": "30 7 * * *"');
  });
});
