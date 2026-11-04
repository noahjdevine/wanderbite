import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase/server';
import { safeManualImagePath } from '@/lib/restaurant-image';
import { getBiteNotes } from '@/app/actions/bite-notes';
import { getRestaurantRatings } from '@/app/actions/restaurant-ratings';
import { getMemberProgress, presentMemberProgress } from '@/lib/progress/get-member-progress';
import { NEUTRAL_MEMBER_HEADER, memberHeaderLabel } from '@/lib/progress/rules';
import { unwrapJoin } from '@/lib/supabase/unwrap-join';
import { loadRecipeSections } from '@/lib/recipes/load';
import { deriveVisitStatus } from '@/lib/visits/visit-status';
import { chicagoVisitDate, stampKind } from '@/lib/passport/passport-board';
import {
  PassportClient,
  type PassportBiteNoteEntry,
  type PassportBiteNotesByRestaurant,
  type PassportRestaurantRatings,
  type PassportVisit,
} from '@/components/passport/passport-client';
import { PassportChrome } from '@/components/passport/passport-chrome';

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
  status: string | null;
  verified_at: string | null;
  expires_at: string | null;
  challenge_item_id: string | null;
  restaurants: PassportRestaurantEmbed | PassportRestaurantEmbed[] | null;
};

type ItemClock = {
  id: string;
  status: string | null;
  redemption_deadline: string | null;
};

type LoadedVisit = PassportVisit & {
  challengeItemId: string | null;
  expiresAt: string | null;
};

type PassportContentProps = {
  userId: string;
};

export async function PassportContent({ userId }: PassportContentProps) {
  const supabase = await createClient();
  const now = new Date();
  const progressPromise = getMemberProgress(userId, now);

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();

  type ProfileRow = { full_name: string | null };
  const first = memberHeaderLabel((profile as ProfileRow | null)?.full_name);
  const displayName = first === NEUTRAL_MEMBER_HEADER ? 'Your' : first;
  const pageYear = chicagoVisitDate(now.toISOString())?.year;

  const { data: redemptionRows, error } = await supabase
    .from('redemptions')
    .select(
      `
      id,
      status,
      verified_at,
      expires_at,
      challenge_item_id,
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
    .eq('user_id', userId);

  const progress = await progressPromise;
  const presented = presentMemberProgress(progress);
  const pendingVisits = 'error' in progress ? 0 : progress.pendingVisits;

  if (error) {
    return (
      <PassportChrome
        displayName={displayName}
        segment="stamps"
        progressUnavailable={presented.progressUnavailable}
        verifiedVisits={presented.verifiedVisits}
        uniqueRestaurants={presented.uniqueRestaurants}
        neighborhoods={presented.neighborhoods}
        currentStreak={presented.streak.currentStreak}
        longestStreak={presented.streak.longestStreak}
        pendingVisits={pendingVisits}
        earnedBadges={presented.earnedBadges}
        showFirstBiteLocked={presented.showFirstBiteLocked}
        pageYear={pageYear}
      >
        <p className="m-0 text-sm text-wb-muted">Could not load your passport: {error.message}</p>
      </PassportChrome>
    );
  }

  const redemptionData = (redemptionRows ?? []) as RedemptionRow[];
  const visits: LoadedVisit[] = redemptionData
    .map((row) => {
      const restaurant = unwrapJoin(row.restaurants);
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
      const visit: LoadedVisit = {
        id: row.id,
        verifiedAt: row.verified_at ?? '',
        visitStatus: 'ready',
        redemptionStatus: row.status,
        challengeItemId: row.challenge_item_id,
        expiresAt: row.expires_at,
        restaurant: restaurantVisit,
      };
      return visit;
    })
    .filter((visit): visit is LoadedVisit => visit != null);

  const uniqueRestaurantIds = [...new Set(visits.map((visit) => visit.restaurant.id))];
  const itemIds = [
    ...new Set(visits.flatMap((visit) => (visit.challengeItemId ? [visit.challengeItemId] : []))),
  ];
  const admin = getSupabaseAdmin();
  const itemById = new Map<string, ItemClock>();
  if (uniqueRestaurantIds.length > 0) {
    // image_url, lat, and lon are not granted to authenticated. Load them
    // with the service role for this member's restaurants only.
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
  if (itemIds.length > 0) {
    const { data: itemRows } = await admin
      .from('challenge_items')
      .select('id, status, redemption_deadline')
      .in('id', itemIds);
    for (const item of (itemRows ?? []) as ItemClock[]) itemById.set(item.id, item);
  }

  const [biteRes, ratingMap] = await Promise.all([
    getBiteNotes(),
    getRestaurantRatings(uniqueRestaurantIds),
  ]);

  const biteNotesByRestaurantId: PassportBiteNotesByRestaurant = {};
  const noteByRedemptionId = new Map<string, { note: string | null }>();
  if (biteRes.ok) {
    for (const row of biteRes.data) {
      noteByRedemptionId.set(row.redemption_id, { note: row.note });
      const entry: PassportBiteNoteEntry = {
        id: row.id,
        redemption_id: row.redemption_id,
        restaurant_id: row.restaurant_id,
        rating: row.rating,
        note: row.note,
        updated_at: row.updated_at,
        is_public: row.is_public,
      };
      const list = biteNotesByRestaurantId[row.restaurant_id] ?? [];
      list.push(entry);
      biteNotesByRestaurantId[row.restaurant_id] = list;
    }
  }

  for (const visit of visits) {
    const item = visit.challengeItemId ? itemById.get(visit.challengeItemId) : undefined;
    visit.visitStatus = deriveVisitStatus({
      item: item
        ? { status: item.status ?? 'assigned', redemptionDeadline: item.redemption_deadline }
        : null,
      redemption: {
        status: visit.redemptionStatus ?? '',
        verifiedAt: visit.verifiedAt || null,
        expiresAt: visit.expiresAt,
      },
      note: noteByRedemptionId.get(visit.id) ?? null,
      now,
    });
    const dated = chicagoVisitDate(visit.verifiedAt);
    visit.verifiedOnShort = dated?.short ?? null;
    visit.verifiedOnLong = dated?.long ?? null;
    visit.chicagoMonth = dated?.month ?? null;
  }

  visits.sort((a, b) => {
    const aStamp = stampKind(a.visitStatus) === 'stamp';
    const bStamp = stampKind(b.visitStatus) === 'stamp';
    if (aStamp !== bStamp) return aStamp ? -1 : 1;
    const aTime = a.verifiedAt ? new Date(a.verifiedAt).getTime() : 0;
    const bTime = b.verifiedAt ? new Date(b.verifiedAt).getTime() : 0;
    return bTime - aTime;
  });

  const ratingsByRestaurantId: PassportRestaurantRatings = Object.fromEntries(ratingMap);
  const recipeSections = await loadRecipeSections(uniqueRestaurantIds);
  const shown: PassportVisit[] = visits.map((visit) => {
    const { challengeItemId: _item, expiresAt: _expires, ...rest } = visit;
    void _item;
    void _expires;
    return rest;
  });

  return (
    <PassportClient
      userDisplayName={displayName}
      visits={shown}
      ratingsByRestaurantId={ratingsByRestaurantId}
      biteNotesByRestaurantId={biteNotesByRestaurantId}
      currentStreak={presented.streak.currentStreak}
      longestStreak={presented.streak.longestStreak}
      totalMonthsActive={presented.streak.totalMonthsActive}
      progressUnavailable={presented.progressUnavailable}
      uniqueRestaurants={presented.uniqueRestaurants}
      neighborhoods={presented.neighborhoods}
      verifiedVisits={presented.verifiedVisits}
      pendingVisits={presented.progressUnavailable ? 0 : pendingVisits}
      earnedBadges={presented.earnedBadges}
      showFirstBiteLocked={presented.showFirstBiteLocked}
      pageYear={pageYear}
      recipeSections={recipeSections}
    />
  );
}
