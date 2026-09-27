import { chicagoMonthStart, dailyRunKey } from '@/lib/cron-period';
import type { Json } from '@/types/database.types';

export const ROLLOVER_JOB = 'rollover-credits';
export const ROLLOVER_BATCH = 25;

export type RolloverItemStatus = 'succeeded' | 'skipped' | 'failed';

export type RolloverProfileQuery = {
  subscriptionStatus: 'active';
  workflowVersion: 'credits';
  afterId: string | null;
  limit: number;
};

export type RolloverResult = {
  outcome: string;
  exceptionInserted: boolean;
};

export type RolloverNotice = {
  userId: string;
  chicagoMonth: string;
  outcome: string;
};

export type RolloverLease = {
  checkpoint: Json | null;
  guardPeriod: () => Promise<boolean>;
  renew: (checkpoint?: Json | null) => Promise<boolean>;
  record: (
    itemKey: string,
    status: 'pending' | RolloverItemStatus,
    error?: string | null,
    detail?: Json | null,
  ) => Promise<boolean>;
  listPending: (limit: number) => Promise<{ itemKey: string }[]>;
  fail: (error: string) => Promise<void>;
  finishClear: (extra?: Json | null) => Promise<void>;
};

type RolloverCheckpoint = {
  snapshotComplete: boolean;
  lastId: string | null;
};

/** `rolled_with_exception` is a failed cron item. The text alone is not a success. */
export function rolloverItemStatus(outcome: string): RolloverItemStatus {
  if (outcome === 'rolled' || outcome === 'unchanged') return 'succeeded';
  if (outcome === 'rolled_with_exception') return 'failed';
  if (outcome === 'legacy_workflow' || outcome === 'inactive_subscription') return 'skipped';
  return 'failed';
}

function readCheckpoint(value: Json | null): RolloverCheckpoint {
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
  listProfiles: (query: RolloverProfileQuery) => Promise<{ id: string }[]>;
  lease: RolloverLease;
}): Promise<boolean> {
  const state = readCheckpoint(input.lease.checkpoint);
  if (state.snapshotComplete) return true;
  let lastId = state.lastId;

  while (true) {
    if (!(await input.lease.guardPeriod())) return false;
    if (!(await input.lease.renew())) return false;
    const query: RolloverProfileQuery = {
      subscriptionStatus: 'active',
      workflowVersion: 'credits',
      afterId: lastId,
      limit: ROLLOVER_BATCH,
    };
    let rows: { id: string }[];
    try {
      rows = await input.listProfiles(query);
    } catch (err) {
      await input.lease.fail(errorMessage(err, 'credit rollover snapshot failed'));
      return false;
    }
    if (rows.length === 0) {
      const saved = await input.lease.renew({ snapshotComplete: true, lastId });
      return saved;
    }
    for (const row of rows) {
      if (typeof row.id !== 'string' || row.id.length === 0) {
        await input.lease.fail('credit rollover snapshot row is missing an id');
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

async function rollPending(input: {
  now: Date;
  rolloverUser: (userId: string) => Promise<RolloverResult>;
  notifyOperator: (notice: RolloverNotice) => Promise<void>;
  lease: RolloverLease;
}): Promise<void> {
  let newExceptionCount = 0;
  while (true) {
    if (!(await input.lease.guardPeriod())) return;
    if (!(await input.lease.renew())) return;
    const pending = await input.lease.listPending(ROLLOVER_BATCH);
    if (pending.length === 0) {
      await input.lease.finishClear({ newExceptionCount });
      return;
    }
    for (const item of pending) {
      if (!(await input.lease.guardPeriod())) return;
      if (!(await input.lease.renew())) return;
      let result: RolloverResult;
      try {
        result = await input.rolloverUser(item.itemKey);
      } catch (err) {
        const recorded = await input.lease.record(
          item.itemKey,
          'failed',
          errorMessage(err, 'credit rollover failed'),
        );
        if (!recorded) return;
        continue;
      }
      const status = rolloverItemStatus(result.outcome);
      const recorded = await input.lease.record(
        item.itemKey,
        status,
        status === 'succeeded' ? null : result.outcome,
        { outcome: result.outcome, exceptionInserted: result.exceptionInserted },
      );
      if (!recorded) return;
      if (result.exceptionInserted) newExceptionCount += 1;
      if (result.outcome === 'rolled_with_exception') {
        try {
          await input.notifyOperator({
            userId: item.itemKey,
            chicagoMonth: chicagoMonthStart(input.now),
            outcome: result.outcome,
          });
        } catch (err) {
          console.error(
            '[cron] rollover operator alert failed:',
            errorMessage(err, 'alert failed'),
          );
        }
      }
    }
  }
}

/**
 * Daily carry for active `credits` profiles. Calls `rollover_credits` with the user id only.
 * Does not assign restaurants or issue the current period.
 */
export async function rolloverCredits(input: {
  now: Date;
  runKey: string;
  listProfiles: (query: RolloverProfileQuery) => Promise<{ id: string }[]>;
  rolloverUser: (userId: string) => Promise<RolloverResult>;
  notifyOperator: (notice: RolloverNotice) => Promise<void>;
  lease: RolloverLease;
}): Promise<void> {
  const expectedKey = dailyRunKey(ROLLOVER_JOB, input.now);
  if (input.runKey !== expectedKey) {
    await input.lease.fail(`credit rollover run key must be ${expectedKey}`);
    return;
  }
  const snapshotted = await snapshotCredits(input);
  if (!snapshotted) return;
  await rollPending(input);
}
