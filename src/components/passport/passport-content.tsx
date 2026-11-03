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

type PassportRestaurantEmbed = {
  id: string;
  name: string;
  address: string | null;
  cuisine_tags: string[] | null;
  neighborhood: string | null;
  google_place_id: string | null;
};

type RedemptionRow = {
  id: string;
  verified_at: string;
  restaurants: PassportRestaurantEmbed | PassportRestaurantEmbed[] | null;
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
      const restaurantVisit: PassportVisit['restaurant'] = {
        id: restaurant.id,
        name: restaurant.name,
        address: restaurant.address,
        lat: null,
        lon: null,
        cuisine_tags: restaurant.cuisine_tags,
        neighborhood: restaurant.neighborhood,
        image_url: null,
        google_place_id: restaurant.google_place_id,
      };
      return {
        id: r.id,
        verifiedAt: r.verified_at,
        restaurant: restaurantVisit,
      };
    })
    .filter((v): v is PassportVisit => v != null);

  const uniqueRestaurantIds = [...new Set(visits.map((v) => v.restaurant.id))];
  if (uniqueRestaurantIds.length > 0) {
    // image_url, lat, and lon are not granted to authenticated. Load them
    // with the service role for this member's verified restaurants only.
    const admin = getSupabaseAdmin();
    const { data: detailRows } = await admin
      .from('restaurants')
      .select('id, image_url, lat, lon')
      .in('id', uniqueRestaurantIds);
    const detailById = new Map((detailRows ?? []).map((row) => [row.id, row]));
    for (const visit of visits) {
      const row = detailById.get(visit.restaurant.id);
      if (!row) continue;
      visit.restaurant.image_url = safeManualImagePath(row.image_url);
      visit.restaurant.lat = row.lat;
      visit.restaurant.lon = row.lon;
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
