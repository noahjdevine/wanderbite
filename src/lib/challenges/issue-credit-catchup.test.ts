import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chicagoMonthStart, dailyRunKey } from '@/lib/cron-period';
import {
  CREDIT_CATCHUP_BATCH,
  CREDIT_CATCHUP_JOB,
  creditIssueStatus,
  issueCreditCatchup,
  type CreditCatchupLease,
  type CreditCatchupProfileQuery,
} from '@/lib/challenges/issue-credit-catchup';
import type { Json } from '@/types/database.types';

const ROOT = path.resolve(__dirname, '../../..');

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

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

describe('credit catch-up outcomes', () => {
  it('succeeds only for created and existing', () => {
    expect(creditIssueStatus('created')).toBe('succeeded');
    expect(creditIssueStatus('existing')).toBe('succeeded');
    expect(creditIssueStatus('inactive_subscription')).toBe('skipped');
    expect(creditIssueStatus('local_month_not_open')).toBe('skipped');
    expect(creditIssueStatus('legacy_workflow')).toBe('skipped');
    expect(creditIssueStatus('incomplete_credits')).toBe('failed');
    expect(creditIssueStatus('capacity_full')).toBe('failed');
  });
});

describe('issueCreditCatchup', () => {
  const now = new Date('2026-03-02T07:00:00Z');

  it('rejects a run key that is not the daily key for that instant', async () => {
    const queries: CreditCatchupProfileQuery[] = [];
    const lease = memoryLease();
    await issueCreditCatchup({
      now,
      runKey: `${CREDIT_CATCHUP_JOB}:2026-03-01`,
      listProfiles: async (query) => {
        queries.push(query);
        return [];
      },
      issuePeriodCredits: async () => 'created',
      lease,
    });
    expect(queries).toEqual([]);
    expect(lease.failed).toBe(`credit catch-up run key must be ${dailyRunKey(CREDIT_CATCHUP_JOB, now)}`);
    expect(lease.finished).toBe(false);
  });

  it('asks for active credits profiles and issues chicagoMonthStart(now)', async () => {
    const queries: CreditCatchupProfileQuery[] = [];
    const issued: { userId: string; period: string }[] = [];
    const ids = Array.from({ length: CREDIT_CATCHUP_BATCH }, (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    const lease = memoryLease();
    await issueCreditCatchup({
      now,
      runKey: dailyRunKey(CREDIT_CATCHUP_JOB, now),
      listProfiles: async (query) => {
        queries.push(query);
        if (query.afterId == null) return ids.map((id) => ({ id }));
        return [];
      },
      issuePeriodCredits: async (userId, period) => {
        issued.push({ userId, period });
        return userId.endsWith('2') ? 'incomplete_credits' : 'created';
      },
      lease,
    });
    expect(queries[0]).toEqual({
      subscriptionStatus: 'active',
      workflowVersion: 'credits',
      afterId: null,
      limit: CREDIT_CATCHUP_BATCH,
    });
    expect(queries[1]?.afterId).toBe(ids[ids.length - 1]);
    expect(issued).toHaveLength(CREDIT_CATCHUP_BATCH);
    expect(issued.every((row) => row.period === chicagoMonthStart(now))).toBe(true);
    expect(lease.items.get(ids[1])?.status).toBe('failed');
    expect(lease.items.get(ids[0])?.status).toBe('succeeded');
    expect(lease.finished).toBe(true);
    expect(lease.failed).toBeNull();
  });
});

describe('credit catch-up route source', () => {
  const route = source('src/app/api/cron/issue-credit-catchup/route.ts');
  const worker = source('src/lib/challenges/issue-credit-catchup.ts');
  const vercel = source('vercel.json');

  it('calls the extracted worker for active credits and does not assign restaurants', () => {
    expect(route).toContain('issueCreditCatchup');
    expect(route).toContain("query.subscriptionStatus !== 'active'");
    expect(route).toContain("query.workflowVersion !== 'credits'");
    expect(route).toContain(".eq('subscription_status', query.subscriptionStatus)");
    expect(route).toContain(".eq('workflow_version', query.workflowVersion)");
    expect(route).toContain('issue_period_credits');
    expect(route).toContain('chicagoMonthStart');
    expect(route).toContain('dailyRunKey');
    expect(route).toContain('resumeExpired: true');
    expect(route).toContain('allowNewAttempt: false');
    expect(route).not.toContain('generateMonthlyChallengeForUser');
    expect(route).not.toContain('link_pending_credits');
    expect(route).not.toContain('legacy workflow');
    expect(worker).toContain('guardPeriod');
    expect(worker).toContain("subscriptionStatus: 'active'");
    expect(worker).toContain("workflowVersion: 'credits'");
    expect(vercel).toContain('"/api/cron/issue-credit-catchup"');
    expect(vercel).toContain('"schedule": "0 7 * * *"');
  });
});
