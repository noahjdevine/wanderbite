import { format, startOfMonth } from 'date-fns';

/** Matches `generateMonthlyChallengeForUser`, which uses `startOfMonth(new Date())`. */
export function monthlyRunKey(jobName: string, now = new Date()): string {
  return `${jobName}:${format(startOfMonth(now), 'yyyy-MM-dd')}`;
}

/** UTC calendar date. Daily jobs do not follow the generator's local month. */
export function dailyRunKey(jobName: string, now = new Date()): string {
  return `${jobName}:${now.toISOString().slice(0, 10)}`;
}

export const PERIOD_BOUNDARY_ERROR = 'period boundary crossed during run';

export function issueItemStatus(result: {
  ok: boolean;
  reason?: string;
}): 'succeeded' | 'skipped' | 'failed' {
  if (result.ok) return 'succeeded';
  if (
    result.reason === 'ineligible_address' ||
    result.reason === 'invalid_distance_preference'
  ) {
    return 'skipped';
  }
  return 'failed';
}

export function reminderCronItemStatus(
  delivery: { status: string; reason?: string },
  claimedRowStatus: string | null,
): 'succeeded' | 'skipped' | 'failed' | 'pending' {
  if (delivery.status === 'emailed') return 'succeeded';
  if (delivery.status === 'skipped' && delivery.reason === 'claimed by another worker') {
    if (claimedRowStatus === 'sent') return 'succeeded';
    if (
      claimedRowStatus === 'skipped_opt_out' ||
      claimedRowStatus === 'skipped_suppressed'
    ) {
      return 'skipped';
    }
    if (claimedRowStatus === 'failed' || claimedRowStatus === 'needs_reconciliation') {
      return 'failed';
    }
    return 'pending';
  }
  if (delivery.status === 'skipped') return 'skipped';
  return 'failed';
}

export function httpStatusForCron(status: string): number {
  if (status === 'success') return 200;
  if (status === 'lease-held') return 409;
  return 500;
}
