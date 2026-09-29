import { format, startOfMonth } from 'date-fns';

/** Matches `generateMonthlyChallengeForUser`, which uses `startOfMonth(new Date())`. */
export function monthlyRunKey(jobName: string, now = new Date()): string {
  return `${jobName}:${format(startOfMonth(now), 'yyyy-MM-dd')}`;
}

/**
 * Run key for reset-swap-counters only. Other monthly jobs stay on monthlyRunKey,
 * which follows the UTC month used by issue-monthly-challenges.
 */
export function resetSwapCountersRunKey(now = new Date()): string {
  return `reset-swap-counters:${chicagoMonthStart(now)}`;
}

/**
 * True once America/Chicago has entered the UTC calendar month of `now`.
 * 00:05 UTC on the 1st is still the previous Chicago evening.
 */
export function resetSwapCountersMonthOpen(now = new Date()): boolean {
  const utcMonth = `${now.toISOString().slice(0, 7)}-01`;
  return chicagoMonthStart(now) >= utcMonth;
}

/** America/Chicago calendar month start as YYYY-MM-01. SQL remains the authority. */
export function chicagoMonthStart(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  return `${year}-${month}-01`;
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
    result.reason === 'invalid_distance_preference' ||
    result.reason === 'waiting_for_local_month'
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
