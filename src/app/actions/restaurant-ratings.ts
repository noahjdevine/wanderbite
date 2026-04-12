'use server';

import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type RestaurantRatingStats = {
  avgRating: number;
  totalRatings: number;
};

/**
 * Aggregate Bite Note ratings per restaurant (rating IS NOT NULL only).
 */
export async function getRestaurantRatings(
  restaurantIds: string[]
): Promise<Map<string, RestaurantRatingStats>> {
  const out = new Map<string, RestaurantRatingStats>();
  if (!restaurantIds.length) return out;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('bite_notes')
    .select('restaurant_id, rating')
    .in('restaurant_id', restaurantIds)
    .not('rating', 'is', null);

  if (error || !data?.length) return out;

  const sums = new Map<string, { sum: number; count: number }>();
  for (const row of data) {
    const r = row as { restaurant_id: string; rating: number | null };
    if (r.rating == null) continue;
    const cur = sums.get(r.restaurant_id) ?? { sum: 0, count: 0 };
    cur.sum += r.rating;
    cur.count += 1;
    sums.set(r.restaurant_id, cur);
  }

  for (const [id, { sum, count }] of sums) {
    out.set(id, { avgRating: sum / count, totalRatings: count });
  }
  return out;
}
