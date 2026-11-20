import { memoryStepLine } from '@/lib/discover/events';
import { deriveVisitStatus, visitStatusCountsAsVisit } from '@/lib/visits/visit-status';

/**
 * A verified visit is a `redemptions` row with stored status `verified`.
 *
 * Journey and Passport count that row through `visitStatusCountsAsVisit`:
 * derived `verified` and `note_added` both count, and `note_added` is the
 * same stored status plus a bite note. This helper does not read notes or
 * ratings. `issued` is a pending stamp (`code_issued`) or an expired code,
 * and neither counts. E09 records the same status, and skips a null
 * `verified_at` only because the ledger needs an instant. The timestamp
 * does not change this label, so it is not an input.
 */
const OPEN = '2099-01-01T00:00:00.000Z';
const FIXED_NOW = new Date('2026-06-01T12:00:00.000Z');

export function storedRedemptionCountsAsVisit(status: string | null | undefined): boolean {
  if (typeof status !== 'string' || status.length === 0) return false;
  const derived = deriveVisitStatus({
    item: { status: 'assigned', redemptionDeadline: OPEN },
    redemption: { status, verifiedAt: '2020-01-01T00:00:00.000Z', expiresAt: OPEN },
    note: null,
    now: FIXED_NOW,
  });
  return visitStatusCountsAsVisit(derived);
}

export function isNewToMember(
  restaurantId: string,
  visitedRestaurantIds: ReadonlySet<string>,
): boolean {
  return !visitedRestaurantIds.has(restaurantId);
}

/**
 * Null or omitted means the member's visits are unknown (guest, or the
 * read failed). An empty set means this pool has no verified visit.
 */
export function memberVisitMemory(
  restaurant: { id: string; name: string },
  visitedRestaurantIds: ReadonlySet<string> | null | undefined,
): { isNewToMember: boolean; line: string } | null {
  if (visitedRestaurantIds == null) return null;
  const fresh = isNewToMember(restaurant.id, visitedRestaurantIds);
  return { isNewToMember: fresh, line: memoryStepLine(restaurant.name, fresh) };
}

/**
 * Fallback picks only. Prefer partners with no verified visit.
 * When every remaining row has been visited, or the pool is empty, the
 * pool comes back unchanged. Ids that are not already in the pool stay out,
 * so a restaurant dropped by session exclusion cannot return here.
 */
export function preferUnvisitedRestaurants<T extends { id: string }>(
  pool: readonly T[],
  visitedRestaurantIds: ReadonlySet<string>,
): readonly T[] {
  if (pool.length === 0) return pool;
  const unvisited = pool.filter((row) => !visitedRestaurantIds.has(row.id));
  if (unvisited.length === 0 || unvisited.length === pool.length) return pool;
  return unvisited;
}
