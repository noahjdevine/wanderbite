
import { randomInt } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import { startOfMonth, subMonths, subYears, format } from 'date-fns';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getRestaurantRatings } from '@/app/actions/restaurant-ratings';
import { getDietaryConflict, hasAllergyConflict } from '@/lib/dietary-utils';
import { normalizeCuisineIds, restaurantHasExcludedCuisine } from '@/lib/cuisines';
import { isCompleteCurrentLayout } from '@/lib/challenges/current-layout';
import { pickDistinctRestaurants, selectDistancePool } from '@/lib/challenges/distance-pool';
import { firstRpcRow } from '@/lib/challenges/rpc';
import { requireLaunchMarketId } from '@/lib/launch-market-server';
import {
  deriveDistanceMatch,
  isLaunchEligibleAddress,
  milesForDistanceBand,
  originFromZip,
  parseDistanceBand,
  type DistanceMatch,
} from '@/lib/launch-market';
import type { UserPreferencesRow } from '@/types/user-preferences';

const INCOMPLETE_CYCLE_ERROR = 'Failed to create challenge items.';
const INACTIVE_SUBSCRIPTION_ERROR =
  'An active Wanderbite subscription is required to generate challenges.';
const INELIGIBLE_ADDRESS_ERROR =
  'Wanderbite is not available at this address yet.';
const INVALID_DISTANCE_ERROR = 'Choose a valid travel distance preference.';
const THIN_POOL_ERROR =
  'No eligible restaurants found within your travel distance. Try a wider distance or check dietary preferences.';

// --- Types (aligned with schema) ---

type RestaurantRow = {
  id: string;
  name: string;
  cuisine_tags: string[] | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  status: string;
  market_id: string;
  org_id: string;
  image_url?: string | null;
  google_photo_url?: string | null;
  google_place_id?: string | null;
};

type RestaurantOfferRow = {
  id: string;
  restaurant_id: string;
  discount_amount_cents: number;
  min_spend_cents: number;
  max_redemptions_per_month: number;
  active: boolean;
};

type RedemptionRow = {
  id: string;
  restaurant_id: string;
  status: string;
  verified_at: string | null;
  created_at: string;
};

type ChallengeCycleRow = {
  id: string;
  user_id: string;
  cycle_month: string;
  status: string;
  swap_count_used: number;
  created_at: string;
};

type ChallengeItemRow = {
  id: string;
  cycle_id: string;
  restaurant_id: string;
  slot_number: number;
  status: string;
};

export type GeneratedChallengeItem = {
  challengeItem: ChallengeItemRow;
  restaurant: RestaurantRow;
  offer: { discount_amount_cents: number; min_spend_cents: number };
  /** Set when status is 'redeemed' (token from redemptions). */
  redemptionToken?: string | null;
  /** Redemption row id when status is 'redeemed' (for Bite Notes, etc.). */
  redemptionId?: string | null;
  /** Aggregate Bite Note ratings for this restaurant (from all users). */
  socialProof?: { avgRating: number | null; totalRatings: number };
};

export type GeneratedChallenge = {
  cycle: ChallengeCycleRow;
  items: GeneratedChallengeItem[];
  distanceMatch: DistanceMatch | null;
};

export type GenerateFailureReason =
  | 'unauthenticated'
  | 'inactive_subscription'
  | 'ineligible_address'
  | 'invalid_distance_preference'
  | 'incomplete_cycle'
  | 'thin_pool'
  | 'market_unavailable'
  | 'load_failed'
  | 'assignment_failed';

export type GenerateChallengeResult =
  | { ok: true; data: GeneratedChallenge }
  | { ok: false; error: string; reason: GenerateFailureReason };

function fail(
  reason: GenerateFailureReason,
  error: string
): GenerateChallengeResult {
  return { ok: false, reason, error };
}

/**
 * Fetches the current month's challenge for a user (for display).
 * Returns null if no active cycle for this month.
 */
export async function getCurrentChallengeForUser(
  userId: string
): Promise<GeneratedChallenge | null> {
  const supabase = getSupabaseAdmin();
  const cycleMonthStr = format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const { data: cycle, error } = await supabase
    .from('challenge_cycles')
    .select('*')
    .eq('user_id', userId)
    .eq('cycle_month', cycleMonthStr)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !cycle) return null;
  const items = await loadChallengeItemsWithRestaurants(
    supabase,
    (cycle as ChallengeCycleRow).id
  );
  const distanceMatch = await distanceMatchForUser(supabase, userId, items);
  return { cycle: cycle as ChallengeCycleRow, items, distanceMatch };
}

/** Unbiased Fisher-Yates shuffle over a copy of the input.
 *
 * Restaurant selection, NOT a security token. We use a crypto RNG (node:crypto
 * `randomInt`, which is rejection-sampled and therefore free of modulo bias)
 * only to satisfy the `src/lib/challenges/**` crypto rule while keeping the
 * distribution uniform.
 */
function shuffle<T>(array: T[]): T[] {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function distanceMatchForUser(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  items: GeneratedChallengeItem[]
): Promise<DistanceMatch | null> {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('address_zip, distance_band')
    .eq('id', userId)
    .maybeSingle();
  const active = items.filter(
    (item) =>
      item.challengeItem.status === 'assigned' ||
      item.challengeItem.status === 'redeemed'
  );
  return deriveDistanceMatch({
    zip: (profile as { address_zip: string | null } | null)?.address_zip ?? null,
    distanceBand:
      (profile as { distance_band: string | null } | null)?.distance_band ?? null,
    restaurants: active.map((item) => item.restaurant),
  });
}

/** Number of distinct restaurant challenges to generate per month. */
const CHALLENGE_ITEMS_PER_MONTH = 2;

/**
 * Generates (or returns existing) monthly challenge for a user in the launch market.
 * Eligibility and distance-band validation run before returning an existing cycle.
 */
export async function generateMonthlyChallengeForUser(
  userId: string
): Promise<GenerateChallengeResult> {
  try {
    const supabase = getSupabaseAdmin();
    const market = await requireLaunchMarketId(supabase);
    if (!market.ok) {
      return fail('market_unavailable', market.error);
    }
    const marketId = market.marketId;

    const [{ data: profile, error: profileErr }, { data: prefsRow, error: prefsErr }] =
      await Promise.all([
        supabase
          .from('user_profiles')
          .select(
            'subscription_status, allergy_flags, dietary_flags, wants_cocktail_experience, address_state, address_zip, distance_band'
          )
          .eq('id', userId)
          .maybeSingle(),
        supabase
          .from('user_preferences')
          .select('excluded_cuisines')
          .eq('user_id', userId)
          .maybeSingle(),
      ]);

    if (profileErr) {
      return fail('load_failed', `Failed to load profile: ${profileErr.message}`);
    }
    if (prefsErr) {
      return fail('load_failed', `Failed to load preferences: ${prefsErr.message}`);
    }
    if (profile?.subscription_status !== 'active') {
      return fail('inactive_subscription', INACTIVE_SUBSCRIPTION_ERROR);
    }
    if (
      !isLaunchEligibleAddress({
        state: (profile as { address_state: string | null }).address_state,
        zip: (profile as { address_zip: string | null }).address_zip,
      })
    ) {
      return fail('ineligible_address', INELIGIBLE_ADDRESS_ERROR);
    }
    const distanceBand = parseDistanceBand(
      (profile as { distance_band: string | null }).distance_band
    );
    if (!distanceBand) {
      return fail('invalid_distance_preference', INVALID_DISTANCE_ERROR);
    }
    const zipOrigin = originFromZip(
      (profile as { address_zip: string | null }).address_zip
    );
    if (!zipOrigin) {
      return fail('ineligible_address', INELIGIBLE_ADDRESS_ERROR);
    }

    const now = new Date();
    const cycleMonth = startOfMonth(now);
    const cycleMonthStr = format(cycleMonth, 'yyyy-MM-dd');
    const threeMonthsAgo = subMonths(now, 3);
    const sixMonthsAgo = subMonths(now, 6);
    const twelveMonthsAgo = subYears(now, 12);
    const monthStart = cycleMonth;
    const monthEnd = startOfMonth(subMonths(now, -1));

    const { data: existingCycle, error: cycleErr } = await supabase
      .from('challenge_cycles')
      .select('*')
      .eq('user_id', userId)
      .eq('cycle_month', cycleMonthStr)
      .eq('status', 'active')
      .maybeSingle();

    if (cycleErr) {
      return fail('load_failed', `Failed to check existing cycle: ${cycleErr.message}`);
    }
    if (existingCycle) {
      const cycle = existingCycle as ChallengeCycleRow;
      const items = await loadChallengeItemsWithRestaurants(supabase, cycle.id);
      if (!isCompleteCurrentLayout(items.map((item) => item.challengeItem))) {
        return fail('incomplete_cycle', INCOMPLETE_CYCLE_ERROR);
      }
      const distanceMatch = await distanceMatchForUser(supabase, userId, items);
      return { ok: true, data: { cycle, items, distanceMatch } };
    }

    const allergyFlags = (profile?.allergy_flags ?? null) as string[] | null;
    const dietaryFlags = (profile?.dietary_flags ?? null) as string[] | null;
    const excludedCuisines = normalizeCuisineIds(
      (prefsRow as UserPreferencesRow | null)?.excluded_cuisines ?? []
    );
    const wantsCocktailExperience = Boolean(
      (profile as { wants_cocktail_experience?: boolean } | null)
        ?.wants_cocktail_experience
    );

    const { data: restaurants, error: restErr } = await supabase
      .from('restaurants')
      .select(
        'id, name, cuisine_tags, address, lat, lon, status, market_id, org_id, image_url, google_photo_url, google_place_id'
      )
      .eq('market_id', marketId)
      .eq('status', 'active');

    if (restErr) {
      return fail('load_failed', `Failed to load restaurants: ${restErr.message}`);
    }
    if (!restaurants?.length) {
      return fail('thin_pool', 'No eligible restaurants found in this market.');
    }

    const restaurantList = restaurants as RestaurantRow[];
    const restaurantIds = restaurantList.map((r) => r.id);

    const { data: offers, error: offersErr } = await supabase
      .from('restaurant_offers')
      .select('id, restaurant_id, discount_amount_cents, min_spend_cents, max_redemptions_per_month, active')
      .in('restaurant_id', restaurantIds)
      .eq('active', true);

    if (offersErr) {
      return fail('load_failed', `Failed to load offers: ${offersErr.message}`);
    }
    const offerList = (offers ?? []) as RestaurantOfferRow[];
    const offerByRestaurant = new Map(offerList.map((o) => [o.restaurant_id, o]));

    const withOffer = restaurantList.filter((r) => offerByRestaurant.has(r.id));
    if (withOffer.length === 0) {
      return fail('thin_pool', 'No restaurants with an active offer in this market.');
    }

    const { data: userRedemptions, error: redErr } = await supabase
      .from('redemptions')
      .select('id, restaurant_id, status, verified_at, created_at')
      .eq('user_id', userId);

    if (redErr) {
      return fail('load_failed', `Failed to load redemptions: ${redErr.message}`);
    }
    const redemptions = (userRedemptions ?? []) as RedemptionRow[];

    const { data: userCycles } = await supabase
      .from('challenge_cycles')
      .select('id')
      .eq('user_id', userId);
    const cycleIds = (userCycles ?? []).map((c) => (c as { id: string }).id);
    const swappedOutRestaurantIds = new Set<string>();
    if (cycleIds.length > 0) {
      const { data: swappedItems } = await supabase
        .from('challenge_items')
        .select('restaurant_id')
        .in('cycle_id', cycleIds)
        .eq('status', 'swapped_out')
        .gte('created_at', threeMonthsAgo.toISOString());
      for (const row of swappedItems ?? []) {
        swappedOutRestaurantIds.add((row as { restaurant_id: string }).restaurant_id);
      }
    }

    const sixMonthsAgoStr = format(sixMonthsAgo, 'yyyy-MM-dd');
    const twelveMonthsAgoStr = format(twelveMonthsAgo, 'yyyy-MM-dd');
    const { data: cyclesLast6 } = await supabase
      .from('challenge_cycles')
      .select('id')
      .eq('user_id', userId)
      .gte('cycle_month', sixMonthsAgoStr);
    const cycles6Ids = (cyclesLast6 ?? []).map((c) => (c as { id: string }).id);
    const receivedInLast6Months = new Set<string>();
    if (cycles6Ids.length > 0) {
      const { data: items6 } = await supabase
        .from('challenge_items')
        .select('restaurant_id')
        .in('cycle_id', cycles6Ids);
      for (const row of items6 ?? []) {
        receivedInLast6Months.add((row as { restaurant_id: string }).restaurant_id);
      }
    }

    const { data: cyclesLast12 } = await supabase
      .from('challenge_cycles')
      .select('id')
      .eq('user_id', userId)
      .gte('cycle_month', twelveMonthsAgoStr);
    const cycles12Ids = (cyclesLast12 ?? []).map((c) => (c as { id: string }).id);
    const restaurantCycleCount = new Map<string, number>();
    if (cycles12Ids.length > 0) {
      const { data: items12 } = await supabase
        .from('challenge_items')
        .select('cycle_id, restaurant_id')
        .in('cycle_id', cycles12Ids);
      const seenPerRestaurant = new Map<string, Set<string>>();
      for (const row of (items12 ?? []) as { cycle_id: string; restaurant_id: string }[]) {
        const rid = row.restaurant_id;
        if (!seenPerRestaurant.has(rid)) seenPerRestaurant.set(rid, new Set());
        seenPerRestaurant.get(rid)!.add(row.cycle_id);
      }
      for (const [rid, cycleSet] of seenPerRestaurant) {
        restaurantCycleCount.set(rid, cycleSet.size);
      }
    }

    const lastMonth = startOfMonth(subMonths(now, 1));
    const lastMonthStr = format(lastMonth, 'yyyy-MM-dd');
    const { data: lastMonthCycle } = await supabase
      .from('challenge_cycles')
      .select('id')
      .eq('user_id', userId)
      .eq('cycle_month', lastMonthStr)
      .maybeSingle();
    const lastMonthRestaurantIds = new Set<string>();
    if (lastMonthCycle) {
      const { data: lastMonthItems } = await supabase
        .from('challenge_items')
        .select('restaurant_id')
        .eq('cycle_id', (lastMonthCycle as { id: string }).id);
      for (const row of lastMonthItems ?? []) {
        lastMonthRestaurantIds.add((row as { restaurant_id: string }).restaurant_id);
      }
    }

    const { data: monthRedemptions } = await supabase
      .from('redemptions')
      .select('restaurant_id')
      .in('status', ['issued', 'verified'])
      .gte('created_at', monthStart.toISOString())
      .lt('created_at', monthEnd.toISOString());

    const countByRestaurant = new Map<string, number>();
    for (const r of monthRedemptions ?? []) {
      const id = (r as { restaurant_id: string }).restaurant_id;
      countByRestaurant.set(id, (countByRestaurant.get(id) ?? 0) + 1);
    }

    function redemptionHardOk(restaurant: RestaurantRow): boolean {
      const userRedemptionsAtRestaurant = redemptions.filter(
        (rd) => rd.restaurant_id === restaurant.id && rd.status === 'verified'
      );
      const verifiedAts = userRedemptionsAtRestaurant
        .map((rd) => (rd.verified_at ? new Date(rd.verified_at) : new Date(rd.created_at)))
        .filter((d) => !isNaN(d.getTime()));
      if (verifiedAts.some((d) => d >= sixMonthsAgo)) return false;
      if (verifiedAts.filter((d) => d >= twelveMonthsAgo).length >= 2) return false;
      return true;
    }

    function passesHard(restaurant: RestaurantRow): boolean {
      const dietaryConflict = getDietaryConflict(restaurant.cuisine_tags, dietaryFlags);
      if (dietaryConflict) return false;
      if (hasAllergyConflict(restaurant.cuisine_tags, allergyFlags)) return false;
      if (
        restaurantHasExcludedCuisine({
          restaurantCuisineTags: restaurant.cuisine_tags,
          excludedCuisineIds: excludedCuisines,
        })
      ) {
        return false;
      }
      if (swappedOutRestaurantIds.has(restaurant.id)) return false;
      const offer = offerByRestaurant.get(restaurant.id);
      if (!offer) return false;
      const monthCount = countByRestaurant.get(restaurant.id) ?? 0;
      if (monthCount >= offer.max_redemptions_per_month) return false;
      return redemptionHardOk(restaurant);
    }

    function passesVariety(restaurant: RestaurantRow): boolean {
      if (receivedInLast6Months.has(restaurant.id)) return false;
      if ((restaurantCycleCount.get(restaurant.id) ?? 0) >= 2) return false;
      return true;
    }

    function passesRelaxedVariety(restaurant: RestaurantRow): boolean {
      return !lastMonthRestaurantIds.has(restaurant.id);
    }

    const pool = selectDistancePool({
      restaurants: withOffer,
      origin: zipOrigin,
      requestedMiles: milesForDistanceBand(distanceBand),
      requiredCount: CHALLENGE_ITEMS_PER_MONTH,
      passesHard,
      passesVariety,
      passesRelaxedVariety,
    });

    if (excludedCuisines?.length && pool.candidates.length < 3) {
      console.warn('[challenges] low candidate pool after cuisine exclusions', {
        userId,
        marketId,
        excludedCuisines,
        eligibleCount: pool.candidates.length,
        withOfferCount: withOffer.length,
      });
    }

    if (pool.candidates.length < CHALLENGE_ITEMS_PER_MONTH) {
      return fail('thin_pool', THIN_POOL_ERROR);
    }

    const chosen = pickDistinctRestaurants(
      pool.candidates,
      CHALLENGE_ITEMS_PER_MONTH,
      { reserveCocktail: wantsCocktailExperience, shuffle }
    );
    if (chosen.length < CHALLENGE_ITEMS_PER_MONTH) {
      return fail('thin_pool', THIN_POOL_ERROR);
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'generate_challenge_cycle',
      {
        p_user_id: userId,
        p_cycle_month: cycleMonthStr,
        p_market_id: marketId,
        p_restaurant_ids: chosen.map((restaurant) => restaurant.id),
      }
    );

    if (rpcError) {
      return fail('assignment_failed', `Failed to create cycle: ${rpcError.message}`);
    }

    const generated = firstRpcRow(rpcData);
    if (!generated) {
      return fail('assignment_failed', 'Failed to create challenge cycle.');
    }
    if (generated.outcome === 'inactive_subscription') {
      return fail('inactive_subscription', INACTIVE_SUBSCRIPTION_ERROR);
    }
    if (generated.outcome === 'invalid_restaurants') {
      return fail('thin_pool', THIN_POOL_ERROR);
    }
    if (generated.outcome === 'incomplete_cycle' || !generated.cycle_id) {
      return fail('incomplete_cycle', INCOMPLETE_CYCLE_ERROR);
    }
    if (generated.outcome !== 'created' && generated.outcome !== 'existing') {
      return fail('incomplete_cycle', INCOMPLETE_CYCLE_ERROR);
    }

    const { data: persistedCycle, error: loadCycleErr } = await supabase
      .from('challenge_cycles')
      .select('*')
      .eq('id', generated.cycle_id)
      .maybeSingle();

    if (loadCycleErr || !persistedCycle) {
      return fail('assignment_failed', 'Failed to create challenge cycle.');
    }

    const cycle = persistedCycle as ChallengeCycleRow;
    const items = await loadChallengeItemsWithRestaurants(supabase, cycle.id);
    if (!isCompleteCurrentLayout(items.map((item) => item.challengeItem))) {
      return fail('incomplete_cycle', INCOMPLETE_CYCLE_ERROR);
    }

    const distanceMatch = await distanceMatchForUser(supabase, userId, items);
    return { ok: true, data: { cycle, items, distanceMatch } };
  } catch (e) {
    Sentry.captureException(e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return fail('assignment_failed', `Assignment failed: ${message}`);
  }
}

async function loadChallengeItemsWithRestaurants(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  cycleId: string
): Promise<GeneratedChallengeItem[]> {
  const { data: items } = await supabase
    .from('challenge_items')
    .select('*')
    .eq('cycle_id', cycleId)
    .order('slot_number');

  if (!items?.length) return [];

  const restIds = [...new Set((items as ChallengeItemRow[]).map((i) => i.restaurant_id))];
  const { data: restaurants } = await supabase
    .from('restaurants')
    .select('*')
    .in('id', restIds);
  const { data: offers } = await supabase
    .from('restaurant_offers')
    .select('id, restaurant_id, discount_amount_cents, min_spend_cents')
    .in('restaurant_id', restIds);

  const restMap = new Map((restaurants ?? []).map((r) => [r.id, r as RestaurantRow]));
  const offerMap = new Map(
    (offers ?? []).map((o) => [(o as RestaurantOfferRow).restaurant_id, o as RestaurantOfferRow])
  );

  // redemptions.token_hash is a SHA-256 digest of the WB- code, not the code itself.
  // The display token is shown once at redeem time only; it is not recoverable from the DB.

  const redeemedItemIds = (items as ChallengeItemRow[])
    .filter((i) => i.status === 'redeemed')
    .map((i) => i.id);
  const redemptionIdByChallengeItemId = new Map<string, string>();
  if (redeemedItemIds.length > 0) {
    const { data: redemptionRows } = await supabase
      .from('redemptions')
      .select('id, challenge_item_id, created_at')
      .in('challenge_item_id', redeemedItemIds)
      .order('created_at', { ascending: false });
    for (const row of redemptionRows ?? []) {
      const rr = row as { id: string; challenge_item_id: string };
      if (!redemptionIdByChallengeItemId.has(rr.challenge_item_id)) {
        redemptionIdByChallengeItemId.set(rr.challenge_item_id, rr.id);
      }
    }
  }

  const ratingsMap = await getRestaurantRatings(restIds);

  return (items as ChallengeItemRow[]).map((item) => {
    const restaurant = restMap.get(item.restaurant_id)!;
    const offer = offerMap.get(item.restaurant_id);
    const stats = ratingsMap.get(item.restaurant_id);
    return {
      challengeItem: item,
      restaurant,
      offer: offer
        ? { discount_amount_cents: offer.discount_amount_cents, min_spend_cents: offer.min_spend_cents }
        : { discount_amount_cents: 1000, min_spend_cents: 4000 },
      redemptionToken: null,
      redemptionId:
        item.status === 'redeemed'
          ? redemptionIdByChallengeItemId.get(item.id) ?? null
          : null,
      socialProof: stats
        ? { avgRating: stats.avgRating, totalRatings: stats.totalRatings }
        : { avgRating: null, totalRatings: 0 },
    };
  });
}
