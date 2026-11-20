import 'server-only';

import type { getSupabaseAdmin } from '@/lib/supabase-admin';
import { storedRedemptionCountsAsVisit } from '@/lib/discover/member-memory';

type Admin = ReturnType<typeof getSupabaseAdmin>;

const VISIT_COLUMNS = 'restaurant_id, status';
const VISITS_READ_FAILED = '[discover] member visits read failed';

let visitsReadFailedLogged = false;

/** One warning per process. The message has no user id, note, or rating. */
export function logMemberVisitsReadFailedOnce(): void {
  if (visitsReadFailedLogged) return;
  visitsReadFailedLogged = true;
  console.warn(VISITS_READ_FAILED);
}

export function resetMemberVisitsReadLog(): void {
  visitsReadFailedLogged = false;
}

type VisitRow = {
  restaurant_id: string | null;
  status: string | null;
};

/**
 * Read-only. Restaurant ids this member has a verified visit at, limited
 * to `restaurantIds`. The select list is the restaurant id and the status.
 * A query error throws so the caller can keep the rest of the turn.
 */
export async function loadMemberVisitedRestaurantIds(
  admin: Admin,
  userId: string,
  restaurantIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(restaurantIds.filter((id) => id.length > 0))];
  if (ids.length === 0) return new Set();
  const { data, error } = await admin
    .from('redemptions')
    .select(VISIT_COLUMNS)
    .eq('user_id', userId)
    .eq('status', 'verified')
    .in('restaurant_id', ids);
  if (error) throw new Error(error.message);
  const visited = new Set<string>();
  for (const row of (data ?? []) as VisitRow[]) {
    if (!storedRedemptionCountsAsVisit(row.status)) continue;
    if (typeof row.restaurant_id !== 'string' || row.restaurant_id.length === 0) continue;
    visited.add(row.restaurant_id);
  }
  return visited;
}
