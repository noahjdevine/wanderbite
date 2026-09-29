import { addHours, format, min as earliest, startOfMonth } from 'date-fns';
import { chicagoMonthStart } from '@/lib/cron-period';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const CARRIED_ASSIGN_WINDOW_HOURS = 840;

export function cycleMonthForWorkflow(
  workflow: 'legacy' | 'credits',
  now = new Date(),
): string {
  if (workflow === 'credits') return chicagoMonthStart(now);
  return format(startOfMonth(now), 'yyyy-MM-dd');
}

/** Linked item deadline when set; otherwise the pending credit's expires_at. */
export function effectiveDeadlineAt(
  credit: { expires_at: string },
  item?: { redemption_deadline: string | null } | null,
): Date {
  if (item?.redemption_deadline) return new Date(item.redemption_deadline);
  return new Date(credit.expires_at);
}

export function compareCarriedCredits(
  a: {
    id: string;
    issued_at: string;
    expires_at: string;
    item?: { redemption_deadline: string | null } | null;
  },
  b: {
    id: string;
    issued_at: string;
    expires_at: string;
    item?: { redemption_deadline: string | null } | null;
  },
): number {
  const deadlineDelta =
    effectiveDeadlineAt(a, a.item).getTime() - effectiveDeadlineAt(b, b.item).getTime();
  if (deadlineDelta !== 0) return deadlineDelta;
  if (a.issued_at !== b.issued_at) return a.issued_at < b.issued_at ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** Carried assign window: least(now + 840h, credit.expires_at). */
export function carriedAssignDeadline(now: Date, expiresAtIso: string): Date {
  return earliest([addHours(now, CARRIED_ASSIGN_WINDOW_HOURS), new Date(expiresAtIso)]);
}

export function offerVersionCoversDeadline(
  version: {
    valid_from: string;
    valid_until: string;
    withdrawn_from_selection_at: string | null;
  },
  now: Date,
  deadline: Date,
): boolean {
  if (version.withdrawn_from_selection_at) return false;
  const validFrom = new Date(version.valid_from);
  const validUntil = new Date(version.valid_until);
  return validFrom <= now && validUntil > now && validUntil > deadline;
}

/**
 * Legacy cards expire 30 days after the cycle was created.
 * Credits cards expire at the stored deadline. A null stored deadline stays open.
 */
export function challengeCardExpired(args: {
  now: Date;
  cycleCreatedAt: string;
  useStoredDeadline: boolean;
  storedDeadline?: string | null;
}): boolean {
  if (args.useStoredDeadline) {
    if (!args.storedDeadline) return false;
    const at = new Date(args.storedDeadline).getTime();
    if (Number.isNaN(at)) return false;
    return args.now.getTime() >= at;
  }
  const created = new Date(args.cycleCreatedAt).getTime();
  if (Number.isNaN(created)) return false;
  return args.now.getTime() - created > THIRTY_DAYS_MS;
}

export function formatChicagoDeadline(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(at);
}

export function formatIssuePeriodLabel(issuePeriod: string): string {
  const at = new Date(`${issuePeriod}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return issuePeriod;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(at);
}
