import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase/server';
import { safeManualImagePath } from '@/lib/restaurant-image';
import { getBiteNotes } from '@/app/actions/bite-notes';
import { getRestaurantRatings } from '@/app/actions/restaurant-ratings';
import { calculateStreak, getStreakBadgeForLongest } from '@/lib/streaks';
import { unwrapJoin } from '@/lib/supabase/unwrap-join';
import {
  PassportClient,
  type PassportBiteNoteEntry,
  type PassportBiteNotesByRestaurant,
  type PassportRestaurantRatings,
  type PassportVisit,
} from '@/components/passport/passport-client';

type RedemptionRow = {
  id: string;
  verified_at: string;
  restaurants:
    | {
        id: string;
        name: string;
        address: string | null;
        lat: number | null;
        lon: number | null;
        cuisine_tags: string[] | null;
        neighborhood: string | null;
        google_place_id: string | null;
      }
    | {
        id: string;
        name: string;
        address: string | null;
        lat: number | null;
        lon: number | null;
        cuisine_tags: string[] | null;
        neighborhood: string | null;
        google_place_id: string | null;
      }[]
    | null;
};

type PassportContentProps = {
  userId: string;
};

export async function PassportContent({ userId }: PassportContentProps) {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();

  type ProfileRow = { full_name: string | null };
  const displayName =
    (profile as ProfileRow | null)?.full_name?.trim() || 'Explorer';

  const { data: redemptionRows, error } = await supabase
    .from('redemptions')
    .select(
      `
      id,
      verified_at,
      restaurants (
        id,
        name,
        address,
        lat,
        lon,
        cuisine_tags,
        neighborhood,
        google_place_id
      )
    `
    )
    .eq('user_id', userId)
    .eq('status', 'verified')
    .not('verified_at', 'is', null)
    .order('verified_at', { ascending: false });

  if (error) {
    return (
      <p className="text-destructive">Could not load your passport: {error.message}</p>
    );
  }

  const redemptionData = (redemptionRows ?? []) as RedemptionRow[];
  const visits: PassportVisit[] = redemptionData
    .map((r) => {
      const restaurant = unwrapJoin(r.restaurants);
      if (!restaurant?.id) return null;
      return {
        id: r.id,
        verifiedAt: r.verified_at,
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          address: restaurant.address,
          lat: restaurant.lat,
          lon: restaurant.lon,
          cuisine_tags: restaurant.cuisine_tags,
          neighborhood: restaurant.neighborhood,
          image_url: null as string | null,
          google_place_id: restaurant.google_place_id,
        },
      };
    })
    .filter((v): v is PassportVisit => v != null);

  const uniqueRestaurantIds = [...new Set(visits.map((v) => v.restaurant.id))];
  if (uniqueRestaurantIds.length > 0) {
    const admin = getSupabaseAdmin();
    const { data: imageRows } = await admin
      .from('restaurants')
      .select('id, image_url')
      .in('id', uniqueRestaurantIds);
    const safeById = new Map(
      (imageRows ?? []).map((row) => [
        (row as { id: string; image_url: string | null }).id,
        safeManualImagePath((row as { image_url: string | null }).image_url),
      ]),
    );
    for (const visit of visits) {
      visit.restaurant.image_url = safeById.get(visit.restaurant.id) ?? null;
    }
  }
  const [streak, biteRes, ratingMap] = await Promise.all([
    calculateStreak(userId),
    getBiteNotes(),
    getRestaurantRatings(uniqueRestaurantIds),
  ]);

  const earnedBadge = getStreakBadgeForLongest(streak.longestStreak);
  const badgeLabel = earnedBadge?.label ?? null;

  const biteNotesByRestaurantId: PassportBiteNotesByRestaurant = {};
  if (biteRes.ok) {
    for (const row of biteRes.data) {
      const entry: PassportBiteNoteEntry = {
        redemption_id: row.redemption_id,
        restaurant_id: row.restaurant_id,
        rating: row.rating,
        note: row.note,
        updated_at: row.updated_at,
      };
      const list = biteNotesByRestaurantId[row.restaurant_id] ?? [];
      list.push(entry);
      biteNotesByRestaurantId[row.restaurant_id] = list;
    }
  }

  const ratingsByRestaurantId: PassportRestaurantRatings =
    Object.fromEntries(ratingMap);

  return (
    <PassportClient
      userDisplayName={displayName}
      visits={visits}
      ratingsByRestaurantId={ratingsByRestaurantId}
      biteNotesByRestaurantId={biteNotesByRestaurantId}
      currentStreak={streak.currentStreak}
      longestStreak={streak.longestStreak}
      totalMonthsActive={streak.totalMonthsActive}
      badgeLabel={badgeLabel}
    />
  );
}
