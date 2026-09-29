'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireUser } from '@/lib/auth/require-user';
import { firstRpcRow } from '@/lib/challenges/rpc';
import { chicagoMonthStart } from '@/lib/cron-period';
import { carriedAssignDeadline } from '@/lib/challenges/challenge-deadline';
import {
  assignCarriedUserMessage,
  shouldInvokeAssignRpc,
} from '@/lib/challenges/assign-carried-gate';
import {
  filterCarriedAssignCandidates,
  type AssignRestaurant,
  type AssignVersion,
  type PricedAssignRestaurant,
} from '@/lib/challenges/carried-assign-pool';
import {
  passesRestaurantHardFilters,
  type CooldownRedemption,
} from '@/lib/challenges/restaurant-safety';
import { normalizeCuisineIds } from '@/lib/cuisines';
import { requireLaunchMarketId } from '@/lib/launch-market-server';
import {
  isLaunchEligibleAddress,
  milesForDistanceBand,
  originFromZip,
  parseDistanceBand,
} from '@/lib/launch-market';
import type { Database } from '@/types/database.types';

const UNSAFE_RESTAURANT =
  'This restaurant does not match your dietary preferences, allergies, or recent visits.';
const UNAVAILABLE_RESTAURANT = 'That restaurant is not available to assign.';

export type AssignCarriedCreditResult = { ok: true } | { ok: false; error: string };

export type CarriedAssignCandidate = {
  id: string;
  name: string;
  cuisineTags: string[];
  discountAmountCents: number;
  minSpendCents: number;
};

export type ListCarriedAssignCandidatesResult =
  | { ok: true; candidates: CarriedAssignCandidate[] }
  | { ok: false; error: string };

type AdminClient = SupabaseClient<Database>;

type AssignScope = {
  ok: true;
  supabase: AdminClient;
  marketId: string;
  now: Date;
  credit: { id: string; status: string; issue_period: string; expires_at: string };
  candidates: PricedAssignRestaurant<AssignRestaurant>[];
  allergyFlags: string[] | null;
  dietaryFlags: string[] | null;
  excludedCuisineIds: string[];
  redemptions: CooldownRedemption[];
};

async function loadCarriedAssignPool(
  userId: string,
  creditId: string,
): Promise<AssignScope | { ok: false; error: string }> {
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const [{ data: profile, error: profileErr }, { data: prefs, error: prefsErr }, { data: credit, error: creditErr }] =
    await Promise.all([
      supabase
        .from('user_profiles')
        .select(
          'workflow_version, subscription_status, allergy_flags, dietary_flags, address_state, address_zip, distance_band',
        )
        .eq('id', userId)
        .maybeSingle(),
      supabase.from('user_preferences').select('excluded_cuisines').eq('user_id', userId).maybeSingle(),
      supabase
        .from('entitlement_credits')
        .select('id, status, issue_period, challenge_item_id, expires_at')
        .eq('id', creditId)
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

  if (profileErr) return { ok: false, error: `Failed to load profile: ${profileErr.message}` };
  if (prefsErr) return { ok: false, error: `Failed to load preferences: ${prefsErr.message}` };
  if (creditErr) return { ok: false, error: `Failed to load credits: ${creditErr.message}` };
  if (!profile || profile.workflow_version !== 'credits') {
    return { ok: false, error: 'Carried assignment is not available for this account.' };
  }
  if (profile.subscription_status !== 'active') {
    return { ok: false, error: 'An active Wanderbite subscription is required.' };
  }
  if (!credit) return { ok: false, error: assignCarriedUserMessage('not_carried') ?? 'This credit is not available to assign.' };
  if (!shouldInvokeAssignRpc({ status: credit.status, issuePeriod: credit.issue_period }, chicagoMonthStart(now))) {
    return { ok: false, error: assignCarriedUserMessage('not_carried') ?? 'This credit is not available to assign.' };
  }
  if (
    !isLaunchEligibleAddress({
      state: profile.address_state,
      zip: profile.address_zip,
    })
  ) {
    return { ok: false, error: 'Wanderbite is not available at this address yet.' };
  }
  const distanceBand = parseDistanceBand(profile.distance_band);
  const origin = originFromZip(profile.address_zip);
  if (!distanceBand || !origin) {
    return { ok: false, error: 'Choose a valid travel distance preference.' };
  }
  const market = await requireLaunchMarketId(supabase);
  if (!market.ok) return { ok: false, error: market.error };

  const { data: restaurants, error: restaurantsErr } = await supabase
    .from('restaurants')
    .select('id, name, cuisine_tags, lat, lon, current_offer_version_id')
    .eq('market_id', market.marketId)
    .eq('status', 'active');
  if (restaurantsErr) return { ok: false, error: `Failed to load restaurants: ${restaurantsErr.message}` };

  const restaurantList = (restaurants ?? []) as AssignRestaurant[];
  const versionIds = [
    ...new Set(
      restaurantList.flatMap((restaurant) =>
        restaurant.current_offer_version_id ? [restaurant.current_offer_version_id] : [],
      ),
    ),
  ];
  const versionsById = new Map<string, AssignVersion>();
  if (versionIds.length > 0) {
    const { data: versions, error: versionsErr } = await supabase
      .from('offer_versions')
      .select('id, restaurant_id, valid_from, valid_until, withdrawn_from_selection_at, tiers')
      .in('id', versionIds);
    if (versionsErr) return { ok: false, error: `Failed to load offers: ${versionsErr.message}` };
    for (const version of versions ?? []) versionsById.set(version.id, version);
  }

  const { data: redemptionRows, error: redemptionErr } = await supabase
    .from('redemptions')
    .select('restaurant_id, status, verified_at, created_at')
    .eq('user_id', userId);
  if (redemptionErr) return { ok: false, error: `Failed to load redemptions: ${redemptionErr.message}` };

  const allergyFlags = profile.allergy_flags;
  const dietaryFlags = profile.dietary_flags;
  const excludedCuisineIds = normalizeCuisineIds(prefs?.excluded_cuisines ?? []);
  const redemptions = (redemptionRows ?? []) as CooldownRedemption[];
  const deadline = carriedAssignDeadline(now, credit.expires_at);
  const candidates = filterCarriedAssignCandidates({
    restaurants: restaurantList,
    versionsById,
    origin,
    requestedMiles: milesForDistanceBand(distanceBand),
    allergyFlags,
    dietaryFlags,
    excludedCuisineIds,
    redemptions,
    now,
    deadline,
  });

  return {
    ok: true,
    supabase,
    marketId: market.marketId,
    now,
    credit,
    candidates,
    allergyFlags,
    dietaryFlags,
    excludedCuisineIds,
    redemptions,
  };
}

export async function listCarriedAssignCandidates(
  creditId: string,
): Promise<ListCarriedAssignCandidatesResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };
  try {
    const scope = await loadCarriedAssignPool(auth.userId, creditId);
    if (!scope.ok) return scope;
    return {
      ok: true,
      candidates: scope.candidates.map((restaurant) => ({
        id: restaurant.id,
        name: restaurant.name,
        cuisineTags: restaurant.cuisine_tags ?? [],
        discountAmountCents: restaurant.discount_amount_cents,
        minSpendCents: restaurant.min_spend_cents,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: `Could not load restaurants: ${message}` };
  }
}

export async function assignCarriedCredit(
  creditId: string,
  restaurantId: string,
): Promise<AssignCarriedCreditResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const scope = await loadCarriedAssignPool(auth.userId, creditId);
    if (!scope.ok) return scope;

    const { data: restaurant, error: restaurantErr } = await scope.supabase
      .from('restaurants')
      .select('id, cuisine_tags')
      .eq('id', restaurantId)
      .maybeSingle();
    if (restaurantErr) return { ok: false, error: `Failed to load restaurants: ${restaurantErr.message}` };
    if (!restaurant) return { ok: false, error: UNAVAILABLE_RESTAURANT };

    if (
      !passesRestaurantHardFilters({
        cuisineTags: restaurant.cuisine_tags,
        allergyFlags: scope.allergyFlags,
        dietaryFlags: scope.dietaryFlags,
        excludedCuisineIds: scope.excludedCuisineIds,
        restaurantId: restaurant.id,
        redemptions: scope.redemptions,
        now: scope.now,
      })
    ) {
      return { ok: false, error: UNSAFE_RESTAURANT };
    }

    const inPool = scope.candidates.some((row) => row.id === restaurantId);
    if (!inPool && scope.credit.status !== 'linked') {
      return { ok: false, error: UNAVAILABLE_RESTAURANT };
    }

    const { data: rpcData, error: rpcError } = await scope.supabase.rpc('assign_carried_credit', {
      p_user_id: auth.userId,
      p_credit_id: creditId,
      p_market_id: scope.marketId,
      p_restaurant_id: restaurantId,
    });
    if (rpcError) return { ok: false, error: `Could not assign this restaurant: ${rpcError.message}` };
    const assigned = firstRpcRow(rpcData);
    const failure = assignCarriedUserMessage(assigned?.outcome);
    if (failure) return { ok: false, error: failure };

    revalidatePath('/challenges');
    revalidatePath('/dashboard');
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: `Could not assign this restaurant: ${message}` };
  }
}
