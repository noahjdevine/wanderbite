'use server';

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
};

export type GeneratedChallengeItem = {
  challengeItem: ChallengeItemRow;
  restaurant: RestaurantRow;
  offer: { discount_amount_cents: number; min_spend_cents: number };
  /** Set when status is 'redeemed' (token from redemptions). */
  redemptionToken?: string | null;
};

export type GeneratedChallenge = {
  cycle: ChallengeCycleRow;
  items: GeneratedChallengeItem[];
};

export type GenerateChallengeResult =
  | { ok: true; data: GeneratedChallenge }
  | { ok: false; error: string };

/**
 * Fetches the current month's challenge for a user (for display).
 * Returns null if no active cycle for this month.
 */
export async function getCurrentChallenge(
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
  const items = await loadChallengeItemsWithRestaurants(supabase, cycle.id);
  return { cycle: cycle as ChallengeCycleRow, items };
}

/** Shuffle array in place (Fisher–Yates) and return. */
function shuffle<T>(array: T[]): T[] {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Number of distinct restaurant challenges to generate per month. */
const CHALLENGE_ITEMS_PER_MONTH = 2;

/**
 * Generates (or returns existing) monthly challenge for a user in a market.
 * Enforces Section 3 rules: subscription (TODO when table exists), safety (allergy_flags),
 * 6-month cooldown, 2 redemptions/restaurant/12mo, capacity.
 * Generates exactly CHALLENGE_ITEMS_PER_MONTH distinct restaurants (no duplicates).
 */
export async function generateMonthlyChallenge(
  userId: string,
  marketId: string
): Promise<GenerateChallengeResult> {
  try {
    const supabase = getSupabaseAdmin();
    const now = new Date();
    const cycleMonth = startOfMonth(now);
    const cycleMonthStr = format(cycleMonth, 'yyyy-MM-dd');
    const threeMonthsAgo = subMonths(now, 3);
    const sixMonthsAgo = subMonths(now, 6);
    const twelveMonthsAgo = subYears(now, 12);
    const monthStart = cycleMonth;
    const monthEnd = startOfMonth(subMonths(now, -1));

    // 1. Already have an active cycle for this month?
    const { data: existingCycle, error: cycleErr } = await supabase
      .from('challenge_cycles')
      .select('*')
      .eq('user_id', userId)
      .eq('cycle_month', cycleMonthStr)
      .eq('status', 'active')
      .maybeSingle();

    if (cycleErr) {
      return { ok: false, error: `Failed to check existing cycle: ${cycleErr.message}` };
    }
    if (existingCycle) {
      const items = await loadChallengeItemsWithRestaurants(supabase, existingCycle.id);
      return {
        ok: true,
        data: { cycle: existingCycle as ChallengeCycleRow, items },
      };
    }

    // 2. User profile (allergy_flags, dietary_flags)
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

    // 3. Restaurants in market with active offer
    const { data: restaurants, error: restErr } = await supabase
      .from('restaurants')
      .select('id, name, cuisine_tags, address, lat, lon, status, market_id, org_id')
      .eq('market_id', marketId)
      .eq('status', 'active');

    if (restErr) {
      return { ok: false, error: `Failed to load restaurants: ${restErr.message}` };
    }
    if (!restaurants?.length) {
      return { ok: false, error: 'No eligible restaurants found in this market.' };
    }

    const restaurantList = restaurants as RestaurantRow[];
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

    // Restaurants that have an active offer
    const withOffer = restaurantList.filter((r) => offerByRestaurant.has(r.id));
    if (withOffer.length === 0) {
      return { ok: false, error: 'No restaurants with an active offer in this market.' };
    }

    // 4. User redemptions (for cooldown + 2x/year)
    const { data: userRedemptions, error: redErr } = await supabase
      .from('redemptions')
      .select('id, restaurant_id, status, verified_at, created_at')
      .eq('user_id', userId);

    if (redErr) {
      return { ok: false, error: `Failed to load redemptions: ${redErr.message}` };
    }
    const redemptions = (userRedemptions ?? []) as RedemptionRow[];

    // 4b. Swap cooldown: restaurants this user swapped out in the last 3 months
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

    // 4c. Variety Rule 1 (6-Month Block): restaurants received in any challenge in last 6 months
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

    // 4d. Variety Rule 2 (2x Yearly Cap): restaurants they've had 2+ times in last 12 months
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

    // 4e. Last month's restaurants (for relaxed fallback)
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

    // 5. Current month redemption counts per restaurant (capacity)
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

    // 6. Filter: dietary, safety, swap cooldown, capacity, variety (6-month block, 2x/year cap)
    function passesBaseFilter(restaurant: RestaurantRow): boolean {
      const dietaryConflict = getDietaryConflict(restaurant.cuisine_tags, dietaryFlags);
      if (dietaryConflict) return false;
      if (hasAllergyConflict(restaurant.cuisine_tags, allergyFlags)) return false;
      if (swappedOutRestaurantIds.has(restaurant.id)) return false;
      const offer = offerByRestaurant.get(restaurant.id)!;
      const monthCount = countByRestaurant.get(restaurant.id) ?? 0;
      if (monthCount >= offer.max_redemptions_per_month) return false;
      return true;
    }

    function passesVarietyRules(restaurant: RestaurantRow): boolean {
      if (receivedInLast6Months.has(restaurant.id)) return false;
      if ((restaurantCycleCount.get(restaurant.id) ?? 0) >= 2) return false;
      return true;
    }

    let eligible = withOffer.filter((restaurant) => {
      if (!passesBaseFilter(restaurant)) return false;
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
      return passesVarietyRules(restaurant);
    });

    // Edge case: relax variety rules so user still gets 2 restaurants (exclude only last month)
    if (eligible.length < CHALLENGE_ITEMS_PER_MONTH) {
      eligible = withOffer.filter((restaurant) => {
        if (!passesBaseFilter(restaurant)) return false;
        const userRedemptionsAtRestaurant = redemptions.filter(
          (rd) => rd.restaurant_id === restaurant.id && rd.status === 'verified'
        );
        const verifiedAts = userRedemptionsAtRestaurant
          .map((rd) => (rd.verified_at ? new Date(rd.verified_at) : new Date(rd.created_at)))
          .filter((d) => !isNaN(d.getTime()));
        if (verifiedAts.some((d) => d >= sixMonthsAgo)) return false;
        if (verifiedAts.filter((d) => d >= twelveMonthsAgo).length >= 2) return false;
        return !lastMonthRestaurantIds.has(restaurant.id);
      });
    }

    if (eligible.length < CHALLENGE_ITEMS_PER_MONTH) {
      return {
        ok: false,
        error: `No eligible restaurants found. Need at least ${CHALLENGE_ITEMS_PER_MONTH} distinct restaurants; found ${eligible.length}. Check dietary preferences, allergies, redemption cooldown, swap cooldown, and capacity.`,
      };
    }

    // 7. Select exactly CHALLENGE_ITEMS_PER_MONTH distinct restaurants (limit 2; no same restaurant twice)
    // User's existing active cycle for this month is already returned above, so we never duplicate within a month.
    const shuffled = shuffle(eligible);
    const chosen = shuffled.slice(0, CHALLENGE_ITEMS_PER_MONTH);

    // 8. Insert challenge_cycles + challenge_items
    const { data: newCycle, error: insertCycleErr } = await supabase
      .from('challenge_cycles')
      .insert({
        user_id: userId,
        cycle_month: cycleMonthStr,
        status: 'active',
        swap_count_used: 0,
      })
      .select()
      .single();

    if (insertCycleErr) {
      return { ok: false, error: `Failed to create cycle: ${insertCycleErr.message}` };
    }
    if (!newCycle) {
      return { ok: false, error: 'Failed to create challenge cycle.' };
    }

    const cycle = newCycle as ChallengeCycleRow;

    const itemsToInsert = chosen.map((restaurant, index) => ({
      cycle_id: cycle.id,
      restaurant_id: restaurant.id,
      slot_number: index + 1,
      status: 'assigned' as const,
    }));

    const { data: newItems, error: insertItemsErr } = await supabase
      .from('challenge_items')
      .insert(itemsToInsert)
      .select();

    if (insertItemsErr) {
      return { ok: false, error: `Failed to create challenge items: ${insertItemsErr.message}` };
    }
    if (!newItems || newItems.length !== CHALLENGE_ITEMS_PER_MONTH) {
      return { ok: false, error: 'Failed to create challenge items.' };
    }

    const items: GeneratedChallengeItem[] = (newItems as ChallengeItemRow[]).map((item, i) => ({
      challengeItem: item,
      restaurant: chosen[i],
      offer: {
        discount_amount_cents: offerByRestaurant.get(chosen[i].id)!.discount_amount_cents,
        min_spend_cents: offerByRestaurant.get(chosen[i].id)!.min_spend_cents,
      },
    }));

    return {
      ok: true,
      data: { cycle, items },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false, error: `Assignment failed: ${message}` };
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

  const redeemedItemIds = (items as ChallengeItemRow[])
    .filter((i) => i.status === 'redeemed')
    .map((i) => i.id);
  const tokenByItemId = new Map<string, string>();
  if (redeemedItemIds.length > 0) {
    const { data: redemptions } = await supabase
      .from('redemptions')
      .select('challenge_item_id, token_hash')
      .in('challenge_item_id', redeemedItemIds)
      .eq('status', 'issued')
      .order('created_at', { ascending: false });
    for (const r of redemptions ?? []) {
      const row = r as { challenge_item_id: string; token_hash: string | null };
      if (row.token_hash && !tokenByItemId.has(row.challenge_item_id)) {
        tokenByItemId.set(row.challenge_item_id, row.token_hash);
      }
    }
  }

  return (items as ChallengeItemRow[]).map((item) => {
    const restaurant = restMap.get(item.restaurant_id)!;
    const offer = offerMap.get(item.restaurant_id);
    return {
      challengeItem: item,
      restaurant,
      offer: offer
        ? { discount_amount_cents: offer.discount_amount_cents, min_spend_cents: offer.min_spend_cents }
        : { discount_amount_cents: 1000, min_spend_cents: 4000 },
      redemptionToken: tokenByItemId.get(item.id) ?? null,
    };
  });
}
