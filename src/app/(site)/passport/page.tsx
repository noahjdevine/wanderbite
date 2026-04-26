import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getBiteNotes } from '@/app/actions/bite-notes';
import { getRestaurantRatings } from '@/app/actions/restaurant-ratings';
import { calculateStreak, getStreakBadgeForLongest } from '@/lib/streaks';
import {
  PassportClient,
  type PassportBiteNoteEntry,
  type PassportBiteNotesByRestaurant,
  type PassportRestaurantRatings,
  type PassportVisit,
} from '@/components/passport/passport-client';

export const dynamic = 'force-dynamic';

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
        image_url: string | null;
        google_photo_url: string | null;
      }
    | {
        id: string;
        name: string;
        address: string | null;
        lat: number | null;
        lon: number | null;
        cuisine_tags: string[] | null;
        neighborhood: string | null;
        image_url: string | null;
        google_photo_url: string | null;
      }[]
    | null;
};

export default async function PassportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/signin?redirectTo=/passport');
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('full_name')
    .eq('id', user.id)
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
        image_url,
        google_photo_url
      )
    `
    )
    .eq('user_id', user.id)
    .eq('status', 'verified')
    .not('verified_at', 'is', null)
    .order('verified_at', { ascending: false });

  if (error) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <p className="text-destructive">
          Could not load your passport: {error.message}
        </p>
      </main>
    );
  }

  const redemptionData = (redemptionRows ?? []) as unknown as RedemptionRow[];
  const visits: PassportVisit[] = redemptionData
    .map((r) => {
      const rel = r.restaurants;
      const restaurant = Array.isArray(rel) ? rel[0] : rel;
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
          image_url: restaurant.image_url,
          google_photo_url: restaurant.google_photo_url,
        },
      };
    })
    .filter((v): v is PassportVisit => v != null);

  const uniqueRestaurantIds = [...new Set(visits.map((v) => v.restaurant.id))];
  const [streak, biteRes, ratingMap] = await Promise.all([
    calculateStreak(user.id),
    getBiteNotes(user.id),
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
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 md:px-6 md:pb-12">
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
    </main>
  );
}
