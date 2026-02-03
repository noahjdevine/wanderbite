'use server';

import { revalidatePath } from 'next/cache';
import { startOfMonth, subMonths, subYears, format } from 'date-fns';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getDietaryConflict, hasAllergyConflict } from '@/lib/dietary-utils';

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
  const i = Math.floor(Math.random() * array.length);
  return array[i];
}

/**
 * Swap one challenge item for a new restaurant.
 * Enforces: cycle belongs to user, swap_count_used < 1, same safety/cooldown filters.
 */
export async function swapChallengeItem(
  challengeItemId: string,
  userId: string
): Promise<SwapChallengeResult> {
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
    if (challengeItem.status === 'swapped_out') {
      return { ok: false, error: 'This item was already swapped.' };
    }

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

    // 3. Ensure cycle belongs to userId
    if (challengeCycle.user_id !== userId) {
      return { ok: false, error: 'This challenge does not belong to you.' };
    }

    // 4. Critical: swap_count_used < 1
    if (challengeCycle.swap_count_used >= 1) {
      return { ok: false, error: 'You have already used your one swap for this month.' };
    }

    // 5. Get market_id and the "other" assigned restaurant in this cycle (to exclude both)
    const { data: currentRestaurant, error: restErr } = await supabase
      .from('restaurants')
      .select('id, market_id')
      .eq('id', challengeItem.restaurant_id)
      .single();

    if (restErr || !currentRestaurant) {
      return { ok: false, error: 'Could not load current restaurant.' };
    }

    const marketId = (currentRestaurant as { market_id: string }).market_id;
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

    // 6. User profile (dietary_flags, allergy_flags)
    const { data: profile, error: profileErr } = await supabase
      .from('user_profiles')
      .select('allergy_flags, dietary_flags')
      .eq('id', userId)
      .maybeSingle();

    if (profileErr) {
      return { ok: false, error: `Failed to load profile: ${profileErr.message}` };
    }
    const allergyFlags = (profile?.allergy_flags ?? null) as string[] | null;
    const dietaryFlags = (profile?.dietary_flags ?? null) as string[] | null;

    // 7. Restaurants in market with active offer, excluding current + other assigned
    const { data: restaurants, error: restaurantsErr } = await supabase
      .from('restaurants')
      .select('id, name, cuisine_tags, address, lat, lon, status, market_id, org_id')
      .eq('market_id', marketId)
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
      .eq('user_id', userId);

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

    // 9. Apply same filters: dietary, allergy, cooldown, capacity
    const eligible = withOffer.filter((restaurant) => {
      const dietaryConflict = getDietaryConflict(restaurant.cuisine_tags, dietaryFlags);
      if (dietaryConflict) {
        console.log(
          `[Swap] Filtered out ${restaurant.name} due to ${dietaryConflict.flag} conflict (overlapping tags: ${dietaryConflict.conflictingTags.join(', ')})`
        );
        return false;
      }
      if (hasAllergyConflict(restaurant.cuisine_tags, allergyFlags)) return false;

      const userRedemptionsAtRestaurant = redemptions.filter(
        (rd) => rd.restaurant_id === restaurant.id && rd.status === 'verified'
      );
      const verifiedAts = userRedemptionsAtRestaurant
        .map((rd) => (rd.verified_at ? new Date(rd.verified_at) : new Date(rd.created_at)))
        .filter((d) => !isNaN(d.getTime()));

      const inCooldown = verifiedAts.some((d) => d >= sixMonthsAgo);
      if (inCooldown) return false;

      const inLast12 = verifiedAts.filter((d) => d >= twelveMonthsAgo);
      if (inLast12.length >= 2) return false;

      const offer = offerByRestaurant.get(restaurant.id)!;
      const monthCount = countByRestaurant.get(restaurant.id) ?? 0;
      if (monthCount >= offer.max_redemptions_per_month) return false;

      return true;
    });

    if (eligible.length === 0) {
      return {
        ok: false,
        error: 'No eligible replacement restaurant found. Check dietary preferences, allergies, and cooldowns.',
      };
    }

    const replacement = pickOne(eligible);
    if (!replacement) {
      return { ok: false, error: 'Could not pick a replacement restaurant.' };
    }

    // 10. Execute swap (update old, insert new, increment swap_count_used)
    const { error: updateItemErr } = await supabase
      .from('challenge_items')
      .update({ status: 'swapped_out' })
      .eq('id', challengeItemId);

    if (updateItemErr) {
      return { ok: false, error: `Failed to mark item as swapped: ${updateItemErr.message}` };
    }

    const { data: newItem, error: insertItemErr } = await supabase
      .from('challenge_items')
      .insert({
        cycle_id: challengeCycle.id,
        restaurant_id: replacement.id,
        slot_number: challengeItem.slot_number,
        status: 'assigned',
        swapped_from_item_id: challengeItemId,
      })
      .select()
      .single();

    if (insertItemErr) {
      return { ok: false, error: `Failed to create replacement item: ${insertItemErr.message}` };
    }

    const { error: updateCycleErr } = await supabase
      .from('challenge_cycles')
      .update({ swap_count_used: challengeCycle.swap_count_used + 1 })
      .eq('id', challengeCycle.id);

    if (updateCycleErr) {
      return { ok: false, error: `Failed to increment swap count: ${updateCycleErr.message}` };
    }

    revalidatePath('/');

    const offer = offerByRestaurant.get(replacement.id)!;
    return {
      ok: true,
      data: {
        newRestaurant: replacement,
        offer: {
          discount_amount_cents: offer.discount_amount_cents,
          min_spend_cents: offer.min_spend_cents,
        },
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false, error: `Swap failed: ${message}` };
  }
}
