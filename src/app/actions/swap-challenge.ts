'use server';

import { randomInt } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { startOfMonth, subMonths, subYears } from 'date-fns';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireUser } from '@/lib/auth/require-user';
import { getDietaryConflict, hasAllergyConflict } from '@/lib/dietary-utils';
import { normalizeCuisineIds, restaurantHasExcludedCuisine } from '@/lib/cuisines';
import { firstRpcRow } from '@/lib/challenges/rpc';
import { selectDistancePool } from '@/lib/challenges/distance-pool';
import { requireLaunchMarketId } from '@/lib/launch-market-server';
import {
  isLaunchEligibleAddress,
  milesForDistanceBand,
  originFromZip,
  parseDistanceBand,
} from '@/lib/launch-market';
import type { UserPreferencesRow } from '@/types/user-preferences';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

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
  swapped_from_item_id: string | null;
};

export type SwapChallengeResult =
  | { ok: true; data: { newRestaurant: RestaurantRow; offer: { discount_amount_cents: number; min_spend_cents: number } } }
  | { ok: false; error: string };

/** Shuffle array and return first element (for picking one replacement). */
function pickOne<T>(array: T[]): T | undefined {
  if (array.length === 0) return undefined;
  const i = randomInt(array.length);
  return array[i];
}

function isValidSuccessorLineage(
  source: ChallengeItemRow,
  successor: ChallengeItemRow,
  cycleId: string
): boolean {
  return (
    successor.swapped_from_item_id === source.id
    && successor.cycle_id === cycleId
    && successor.slot_number === source.slot_number
    && (successor.status === 'assigned' || successor.status === 'redeemed')
    && source.status === 'swapped_out'
  );
}

async function loadRestaurantOffer(
  supabase: SupabaseClient<Database>,
  restaurantId: string
): Promise<SwapChallengeResult> {
  const { data: restaurant, error: restErr } = await supabase
    .from('restaurants')
    .select('id, name, cuisine_tags, address, lat, lon, status, market_id, org_id')
    .eq('id', restaurantId)
    .maybeSingle();
  const { data: offer, error: offerErr } = await supabase
    .from('restaurant_offers')
    .select('discount_amount_cents, min_spend_cents, active')
    .eq('restaurant_id', restaurantId)
    .eq('active', true)
    .maybeSingle();

  if (restErr || offerErr || !restaurant || !offer) {
    return { ok: false, error: 'Could not load current restaurant.' };
  }

  return {
    ok: true,
    data: {
      newRestaurant: restaurant as RestaurantRow,
      offer: {
        discount_amount_cents: (offer as { discount_amount_cents: number }).discount_amount_cents,
        min_spend_cents: (offer as { min_spend_cents: number }).min_spend_cents,
      },
    },
  };
}

/**
 * Swap one challenge item for a new restaurant.
 * Enforces: cycle belongs to user, swap_count_used < 1, same safety/cooldown filters.
 */
export async function swapChallengeItem(
  challengeItemId: string
): Promise<SwapChallengeResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const supabase = getSupabaseAdmin();
    const now = new Date();
    const sixMonthsAgo = subMonths(now, 6);
    const twelveMonthsAgo = subYears(now, 12);
    const monthStart = startOfMonth(now);
    const monthEnd = startOfMonth(subMonths(now, -1));

    // 1. Fetch the challenge_item
    const { data: item, error: itemErr } = await supabase
      .from('challenge_items')
      .select('*')
      .eq('id', challengeItemId)
      .maybeSingle();

    if (itemErr) {
      return { ok: false, error: `Failed to load challenge item: ${itemErr.message}` };
    }
    if (!item) {
      return { ok: false, error: 'Challenge item not found.' };
    }

    const challengeItem = item as ChallengeItemRow;

    // 2. Fetch parent challenge_cycle
    const { data: cycle, error: cycleErr } = await supabase
      .from('challenge_cycles')
      .select('*')
      .eq('id', challengeItem.cycle_id)
      .maybeSingle();

    if (cycleErr) {
      return { ok: false, error: `Failed to load challenge cycle: ${cycleErr.message}` };
    }
    if (!cycle) {
      return { ok: false, error: 'Challenge cycle not found.' };
    }

    const challengeCycle = cycle as ChallengeCycleRow;

    // 3. Ensure cycle belongs to the authenticated user
    if (challengeCycle.user_id !== auth.userId) {
      return { ok: false, error: 'This challenge does not belong to you.' };
    }

    if (challengeItem.status === 'swapped_out') {
      const { data: successor, error: successorErr } = await supabase
        .from('challenge_items')
        .select('*')
        .eq('swapped_from_item_id', challengeItemId)
        .maybeSingle();

      if (successorErr || !successor) {
        return { ok: false, error: 'Swap failed.' };
      }
      const successorItem = successor as ChallengeItemRow;
      if (!isValidSuccessorLineage(challengeItem, successorItem, challengeCycle.id)) {
        return { ok: false, error: 'Swap failed.' };
      }
      return loadRestaurantOffer(supabase, successorItem.restaurant_id);
    }

    if (challengeCycle.swap_count_used >= 1) {
      return { ok: false, error: 'You have already used your one swap for this month.' };
    }

    if (challengeItem.status !== 'assigned') {
      return {
        ok: false,
        error:
          challengeItem.status === 'redeemed'
            ? 'This challenge has already been redeemed.'
            : 'This item was already swapped.',
      };
    }

    const [{ data: profile, error: profileErr }, { data: prefsRow, error: prefsErr }] =
      await Promise.all([
        supabase
          .from('user_profiles')
          .select('allergy_flags, dietary_flags, address_state, address_zip, distance_band')
          .eq('id', auth.userId)
          .maybeSingle(),
        supabase
          .from('user_preferences')
          .select('excluded_cuisines')
          .eq('user_id', auth.userId)
          .maybeSingle(),
      ]);

    if (profileErr) {
      return { ok: false, error: `Failed to load profile: ${profileErr.message}` };
    }
    if (prefsErr) {
      return { ok: false, error: `Failed to load preferences: ${prefsErr.message}` };
    }
    if (
      !isLaunchEligibleAddress({
        state: (profile as { address_state: string | null } | null)?.address_state,
        zip: (profile as { address_zip: string | null } | null)?.address_zip,
      })
    ) {
      return { ok: false, error: 'Wanderbite is not available at this address yet.' };
    }
    const distanceBand = parseDistanceBand(
      (profile as { distance_band: string | null } | null)?.distance_band
    );
    const zipOrigin = originFromZip(
      (profile as { address_zip: string | null } | null)?.address_zip
    );
    if (!distanceBand || !zipOrigin) {
      return { ok: false, error: 'Choose a valid travel distance preference.' };
    }

    const market = await requireLaunchMarketId(supabase);
    if (!market.ok) {
      return { ok: false, error: market.error };
    }

    const excludeRestaurantIds = new Set<string>([challengeItem.restaurant_id]);

    const { data: allCycleItems } = await supabase
      .from('challenge_items')
      .select('restaurant_id')
      .eq('cycle_id', challengeCycle.id);

    for (const row of allCycleItems ?? []) {
      const rid = (row as { restaurant_id: string }).restaurant_id;
      if (rid !== challengeItem.restaurant_id) {
        excludeRestaurantIds.add(rid);
      }
    }

    // 6. Cuisine exclusions (user_preferences)
    const allergyFlags = (profile?.allergy_flags ?? null) as string[] | null;
    const dietaryFlags = (profile?.dietary_flags ?? null) as string[] | null;
    const excludedCuisines = normalizeCuisineIds(
      (prefsRow as UserPreferencesRow | null)?.excluded_cuisines ?? []
    );

    // 7. Restaurants in market with active offer, excluding current + other assigned
    const { data: restaurants, error: restaurantsErr } = await supabase
      .from('restaurants')
      .select('id, name, cuisine_tags, address, lat, lon, status, market_id, org_id')
      .eq('market_id', market.marketId)
      .eq('status', 'active');

    if (restaurantsErr) {
      return { ok: false, error: `Failed to load restaurants: ${restaurantsErr.message}` };
    }

    const restaurantList = ((restaurants ?? []) as RestaurantRow[]).filter(
      (r) => !excludeRestaurantIds.has(r.id)
    );

    if (restaurantList.length === 0) {
      return { ok: false, error: 'No other restaurants available to swap into.' };
    }

    const restaurantIds = restaurantList.map((r) => r.id);
    const { data: offers, error: offersErr } = await supabase
      .from('restaurant_offers')
      .select('id, restaurant_id, discount_amount_cents, min_spend_cents, max_redemptions_per_month, active')
      .in('restaurant_id', restaurantIds)
      .eq('active', true);

    if (offersErr) {
      return { ok: false, error: `Failed to load offers: ${offersErr.message}` };
    }
    const offerList = (offers ?? []) as RestaurantOfferRow[];
    const offerByRestaurant = new Map(offerList.map((o) => [o.restaurant_id, o]));

    const withOffer = restaurantList.filter((r) => offerByRestaurant.has(r.id));
    if (withOffer.length === 0) {
      return { ok: false, error: 'No restaurants with an active offer available to swap into.' };
    }

    // 8. User redemptions (cooldown + 2x/year)
    const { data: userRedemptions, error: redErr } = await supabase
      .from('redemptions')
      .select('id, restaurant_id, status, verified_at, created_at')
      .eq('user_id', auth.userId);

    if (redErr) {
      return { ok: false, error: `Failed to load redemptions: ${redErr.message}` };
    }
    const redemptions = (userRedemptions ?? []) as RedemptionRow[];

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

    const pool = selectDistancePool({
      restaurants: withOffer,
      origin: zipOrigin,
      requestedMiles: milesForDistanceBand(distanceBand),
      requiredCount: 1,
      passesHard: (restaurant) => {
        const dietaryConflict = getDietaryConflict(restaurant.cuisine_tags, dietaryFlags);
        if (dietaryConflict) {
          console.warn(
            `[Swap] Filtered out ${restaurant.name} due to ${dietaryConflict.flag} conflict (overlapping tags: ${dietaryConflict.conflictingTags.join(', ')})`
          );
          return false;
        }
        if (hasAllergyConflict(restaurant.cuisine_tags, allergyFlags)) return false;
        if (
          restaurantHasExcludedCuisine({
            restaurantCuisineTags: restaurant.cuisine_tags,
            excludedCuisineIds: excludedCuisines,
          })
        ) {
          return false;
        }

        const userRedemptionsAtRestaurant = redemptions.filter(
          (rd) => rd.restaurant_id === restaurant.id && rd.status === 'verified'
        );
        const verifiedAts = userRedemptionsAtRestaurant
          .map((rd) => (rd.verified_at ? new Date(rd.verified_at) : new Date(rd.created_at)))
          .filter((d) => !isNaN(d.getTime()));

        if (verifiedAts.some((d) => d >= sixMonthsAgo)) return false;
        if (verifiedAts.filter((d) => d >= twelveMonthsAgo).length >= 2) return false;

        const offer = offerByRestaurant.get(restaurant.id);
        if (!offer) return false;
        const monthCount = countByRestaurant.get(restaurant.id) ?? 0;
        if (monthCount >= offer.max_redemptions_per_month) return false;
        return true;
      },
      passesVariety: () => true,
      passesRelaxedVariety: () => true,
    });

    if (pool.candidates.length === 0) {
      return {
        ok: false,
        error: 'No eligible replacement restaurant found. Check dietary preferences, allergies, and cooldowns.',
      };
    }

    const replacement = pickOne(pool.candidates);
    if (!replacement) {
      return { ok: false, error: 'Could not pick a replacement restaurant.' };
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc('swap_challenge_item', {
      p_user_id: auth.userId,
      p_item_id: challengeItemId,
      p_replacement_restaurant_id: replacement.id,
    });

    if (rpcError) {
      return { ok: false, error: `Swap failed: ${rpcError.message}` };
    }

    const swapped = firstRpcRow(rpcData);
    if (!swapped) {
      return { ok: false, error: 'Swap failed.' };
    }
    if (swapped.outcome === 'swap_exhausted') {
      return { ok: false, error: 'You have already used your one swap for this month.' };
    }
    if (swapped.outcome === 'forbidden') {
      return { ok: false, error: 'This challenge does not belong to you.' };
    }
    if (swapped.outcome === 'not_found') {
      return { ok: false, error: 'Challenge item not found.' };
    }
    if (
      swapped.outcome !== 'created' && swapped.outcome !== 'existing'
    ) {
      return { ok: false, error: 'Swap failed.' };
    }
    if (!swapped.restaurant_id) {
      return { ok: false, error: 'Swap failed.' };
    }

    revalidatePath('/dashboard');
    revalidatePath('/challenges');

    return loadRestaurantOffer(supabase, swapped.restaurant_id);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false, error: `Swap failed: ${message}` };
  }
}
