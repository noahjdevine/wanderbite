import { chicagoMonthStart, dailyRunKey } from '@/lib/cron-period';
import type { Json } from '@/types/database.types';

export const CREDIT_CATCHUP_JOB = 'issue-credit-catchup';
export const CREDIT_CATCHUP_BATCH = 25;

export type CreditCatchupItemStatus = 'succeeded' | 'skipped' | 'failed';

export type CreditCatchupProfileQuery = {
  subscriptionStatus: 'active';
  workflowVersion: 'credits';
  afterId: string | null;
  limit: number;
};

export type CreditCatchupLease = {
  checkpoint: Json | null;
  guardPeriod: () => Promise<boolean>;
  renew: (checkpoint?: Json | null) => Promise<boolean>;
  record: (
    itemKey: string,
    status: 'pending' | CreditCatchupItemStatus,
    error?: string | null,
    detail?: Json | null,
  ) => Promise<boolean>;
  listPending: (limit: number) => Promise<{ itemKey: string }[]>;
  fail: (error: string) => Promise<void>;
  finishClear: (extra?: Json | null) => Promise<void>;
};

type CatchupCheckpoint = {
  snapshotComplete: boolean;
  lastId: string | null;
};

/** Maps `issue_period_credits` text. `incomplete_credits` stays failed and is not repaired. */
export function creditIssueStatus(outcome: string): CreditCatchupItemStatus {
  if (outcome === 'created' || outcome === 'existing') return 'succeeded';
  if (
    outcome === 'inactive_subscription' ||
    outcome === 'local_month_not_open' ||
    outcome === 'legacy_workflow'
  ) {
    return 'skipped';
  }
  return 'failed';
}

function readCheckpoint(value: Json | null): CatchupCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { snapshotComplete: false, lastId: null };
  }
  const row = value as { snapshotComplete?: unknown; lastId?: unknown };
  return {
    snapshotComplete: row.snapshotComplete === true,
    lastId: typeof row.lastId === 'string' ? row.lastId : null,
  };
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

async function snapshotCredits(input: {
  listProfiles: (query: CreditCatchupProfileQuery) => Promise<{ id: string }[]>;
  lease: CreditCatchupLease;
}): Promise<boolean> {
  const state = readCheckpoint(input.lease.checkpoint);
  if (state.snapshotComplete) return true;
  let lastId = state.lastId;

  while (true) {
    if (!(await input.lease.guardPeriod())) return false;
    if (!(await input.lease.renew())) return false;
    const query: CreditCatchupProfileQuery = {
      subscriptionStatus: 'active',
      workflowVersion: 'credits',
      afterId: lastId,
      limit: CREDIT_CATCHUP_BATCH,
    };
    let rows: { id: string }[];
    try {
      rows = await input.listProfiles(query);
    } catch (err) {
      await input.lease.fail(errorMessage(err, 'credit catch-up snapshot failed'));
      return false;
    }
    if (rows.length === 0) {
      const saved = await input.lease.renew({ snapshotComplete: true, lastId });
      return saved;
    }
    for (const row of rows) {
      if (typeof row.id !== 'string' || row.id.length === 0) {
        await input.lease.fail('credit catch-up snapshot row is missing an id');
        return false;
      }
      if (!(await input.lease.renew())) return false;
      const recorded = await input.lease.record(row.id, 'pending');
      if (!recorded) return false;
      lastId = row.id;
    }
    const saved = await input.lease.renew({ snapshotComplete: false, lastId });
    if (!saved) return false;
  }
}

async function issuePending(
  input: {
    issuePeriodCredits: (userId: string, issuePeriod: string) => Promise<string>;
    lease: CreditCatchupLease;
  },
  issuePeriod: string,
): Promise<void> {
  while (true) {
    if (!(await input.lease.guardPeriod())) return;
    if (!(await input.lease.renew())) return;
    const pending = await input.lease.listPending(CREDIT_CATCHUP_BATCH);
    if (pending.length === 0) {
      await input.lease.finishClear();
      return;
    }
    for (const item of pending) {
      if (!(await input.lease.guardPeriod())) return;
      if (!(await input.lease.renew())) return;
      let outcome = '';
      try {
        outcome = await input.issuePeriodCredits(item.itemKey, issuePeriod);
      } catch (err) {
        const recorded = await input.lease.record(
          item.itemKey,
          'failed',
          errorMessage(err, 'credit catch-up issue failed'),
        );
        if (!recorded) return;
        continue;
      }
      const status = creditIssueStatus(outcome);
      const recorded = await input.lease.record(
        item.itemKey,
        status,
        status === 'succeeded' ? null : outcome,
        { outcome },
      );
      if (!recorded) return;
    }
  }
}

/**
 * Daily catch-up for active `credits` profiles. Issues the current Chicago month only.
 * Does not assign restaurants or call the legacy generator.
 */
export async function issueCreditCatchup(input: {
  now: Date;
  runKey: string;
  listProfiles: (query: CreditCatchupProfileQuery) => Promise<{ id: string }[]>;
  issuePeriodCredits: (userId: string, issuePeriod: string) => Promise<string>;
  lease: CreditCatchupLease;
}): Promise<void> {
  const expectedKey = dailyRunKey(CREDIT_CATCHUP_JOB, input.now);
  if (input.runKey !== expectedKey) {
    await input.lease.fail(`credit catch-up run key must be ${expectedKey}`);
    return;
  }
  const snapshotted = await snapshotCredits(input);
  if (!snapshotted) return;
  await issuePending(input, chicagoMonthStart(input.now));
}
