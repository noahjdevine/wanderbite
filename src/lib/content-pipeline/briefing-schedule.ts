import { activityVerifiedAtMs, VENUE_PAGE_REFRESH_AFTER_MS } from '@/lib/content-pipeline/activity-schedule';

/** Same elapsed cadence as venue_page. Equal to the cadence is not due. */
export const RESTAURANT_PAGE_REFRESH_AFTER_MS = VENUE_PAGE_REFRESH_AFTER_MS;

export function restaurantPageDue(
  source: { kind: string; lastVerifiedAt: string | null },
  now: Date,
): boolean {
  if (source.kind !== 'restaurant_page') return false;
  const verified = activityVerifiedAtMs(source.lastVerifiedAt);
  if (verified == null) return true;
  return now.getTime() - verified > RESTAURANT_PAGE_REFRESH_AFTER_MS;
}
