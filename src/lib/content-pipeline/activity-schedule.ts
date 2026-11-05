/**
 * Cadence for activity source refresh. Elapsed time, not a Chicago calendar day.
 * A daylight-saving day is still 24 hours of milliseconds.
 * A null or unreadable last_verified_at is due.
 * Equal to the cadence is not due. Only older than the cadence is due.
 */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const EVENT_PAGE_REFRESH_AFTER_MS = MS_PER_DAY;
export const VENUE_PAGE_REFRESH_AFTER_MS = 7 * MS_PER_DAY;

export function activityRefreshAfterMs(kind: string): number | null {
  if (kind === 'event_page') return EVENT_PAGE_REFRESH_AFTER_MS;
  if (kind === 'venue_page') return VENUE_PAGE_REFRESH_AFTER_MS;
  return null;
}

export function activityVerifiedAtMs(lastVerifiedAt: string | null): number | null {
  if (lastVerifiedAt == null || lastVerifiedAt.trim() === '') return null;
  const parsed = Date.parse(lastVerifiedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

/** event_page older than 1 day, venue_page older than 7 days. Other kinds are never due. */
export function activitySourceDue(
  source: { kind: string; lastVerifiedAt: string | null },
  now: Date,
): boolean {
  const cadence = activityRefreshAfterMs(source.kind);
  if (cadence == null) return false;
  const verified = activityVerifiedAtMs(source.lastVerifiedAt);
  if (verified == null) return true;
  return now.getTime() - verified > cadence;
}
