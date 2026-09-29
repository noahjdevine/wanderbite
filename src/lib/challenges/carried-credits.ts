import { chicagoMonthStart } from '@/lib/cron-period';
import { compareCarriedCredits, effectiveDeadlineAt } from '@/lib/challenges/challenge-deadline';
import { lowestSealedBase } from '@/lib/offers/sealed-base';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getRestaurantRatings } from '@/app/actions/restaurant-ratings';
import { safeManualImagePath } from '@/lib/restaurant-image';
import type { GeneratedChallengeItem } from '@/lib/challenges/generate';

export type CarriedRedemptionSnapshot = {
  id: string;
  challenge_item_id: string | null;
  status: string | null;
  created_at: string | null;
};

export type CarriedCreditView = {
  creditId: string;
  issuePeriod: string;
  slotNumber: number;
  issuedAt: string;
  expiresAt: string;
  effectiveDeadline: string;
  state: 'pending' | 'linked';
  item: GeneratedChallengeItem | null;
};

/** Latest issued redemption for a challenge item, if one is still active. */
export function issuedRedemptionId(
  itemId: string,
  redemptions: CarriedRedemptionSnapshot[],
): string | null {
  const issued = redemptions.filter(
    (row) => row.challenge_item_id === itemId && row.status === 'issued' && row.created_at,
  );
  issued.sort((a, b) => (a.created_at! < b.created_at! ? 1 : a.created_at! > b.created_at! ? -1 : 0));
  return issued[0]?.id ?? null;
}

/**
 * Assigned rows stay while the stored deadline is still open.
 * Redeemed rows stay when an issued redemption can still show a code.
 */
export function carriedItemVisibility(
  item: { status: string | null; redemption_deadline: string | null },
  redemptionId: string | null,
  now: Date,
): boolean {
  if (item.status === 'expired' || item.status === 'swapped_out') return false;
  if (item.status === 'assigned') {
    if (item.redemption_deadline == null) return true;
    const at = new Date(item.redemption_deadline);
    return !Number.isNaN(at.getTime()) && at > now;
  }
  if (item.status === 'redeemed') return redemptionId != null;
  return false;
}

export function omitCreditsOnCurrentCycle<T extends { creditId: string }>(
  credits: T[],
  currentCycleCreditIds: ReadonlySet<string>,
): T[] {
  return credits.filter((credit) => !currentCycleCreditIds.has(credit.creditId));
}

export async function loadCreditsSwapRemaining(
  userId: string,
  now = new Date(),
): Promise<{ ok: true; remaining: 0 | 1 } | { ok: false; error: string }> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('credit_swap_allowances')
    .select('user_id')
    .eq('user_id', userId)
    .eq('swap_month', chicagoMonthStart(now))
    .maybeSingle();
  if (error) return { ok: false, error: `Failed to load swap allowance: ${error.message}` };
  return { ok: true, remaining: data ? 0 : 1 };
}

export async function loadCarriedCreditsForUser(
  userId: string,
  options?: { excludeCreditIds?: Iterable<string>; now?: Date },
): Promise<{ ok: true; credits: CarriedCreditView[] } | { ok: false; error: string }> {
  const now = options?.now ?? new Date();
  const admin = getSupabaseAdmin();
  const { data: creditRows, error: creditError } = await admin
    .from('entitlement_credits')
    .select(
      'id, user_id, issue_period, slot_number, status, challenge_item_id, issued_at, expires_at',
    )
    .eq('user_id', userId)
    .in('status', ['pending', 'linked'])
    .lt('issue_period', chicagoMonthStart(now));
  if (creditError) return { ok: false, error: `Failed to load credits: ${creditError.message}` };

  const credits = creditRows ?? [];
  const linkedItemIds = credits.flatMap((credit) =>
    credit.status === 'linked' && credit.challenge_item_id ? [credit.challenge_item_id] : [],
  );

  const itemById = new Map<
    string,
    {
      id: string;
      cycle_id: string | null;
      restaurant_id: string | null;
      slot_number: number | null;
      status: string | null;
      offer_version_id: string | null;
      redemption_deadline: string | null;
      credit_id: string | null;
    }
  >();
  if (linkedItemIds.length > 0) {
    const { data: itemRows, error: itemError } = await admin
      .from('challenge_items')
      .select(
        'id, cycle_id, restaurant_id, slot_number, status, offer_version_id, redemption_deadline, credit_id',
      )
      .in('id', linkedItemIds);
    if (itemError) return { ok: false, error: `Failed to load challenge items: ${itemError.message}` };
    for (const item of itemRows ?? []) itemById.set(item.id, item);
  }

  const redemptionRows: CarriedRedemptionSnapshot[] = [];
  if (linkedItemIds.length > 0) {
    const { data: redemptions, error: redemptionError } = await admin
      .from('redemptions')
      .select('id, challenge_item_id, status, created_at')
      .in('challenge_item_id', linkedItemIds);
    if (redemptionError) {
      return { ok: false, error: `Failed to load redemptions: ${redemptionError.message}` };
    }
    redemptionRows.push(...(redemptions ?? []));
  }

  const visibleLinked = credits.flatMap((credit) => {
    if (credit.status !== 'linked' || !credit.challenge_item_id) return [];
    const item = itemById.get(credit.challenge_item_id);
    if (!item || item.credit_id !== credit.id || !item.restaurant_id || !item.cycle_id) return [];
    const redemptionId = issuedRedemptionId(item.id, redemptionRows);
    if (!carriedItemVisibility(item, redemptionId, now)) return [];
    return [{ credit, item, redemptionId }];
  });

  const restaurantIds = [...new Set(visibleLinked.map((row) => row.item.restaurant_id!))];
  const restaurantById = new Map<
    string,
    {
      id: string;
      name: string;
      cuisine_tags: string[] | null;
      address: string | null;
      lat: number | null;
      lon: number | null;
      status: string | null;
      market_id: string | null;
      org_id: string | null;
      image_url: string | null;
      google_place_id: string | null;
    }
  >();
  const versionBase = new Map<string, { discount_amount_cents: number; min_spend_cents: number }>();
  if (restaurantIds.length > 0) {
    const { data: restaurants, error: restaurantError } = await admin
      .from('restaurants')
      .select('id, name, cuisine_tags, address, lat, lon, status, market_id, org_id, image_url, google_place_id')
      .in('id', restaurantIds);
    if (restaurantError) {
      return { ok: false, error: `Failed to load restaurants: ${restaurantError.message}` };
    }
    for (const restaurant of restaurants ?? []) restaurantById.set(restaurant.id, restaurant);

    const versionIds = [
      ...new Set(
        visibleLinked.flatMap((row) => (row.item.offer_version_id ? [row.item.offer_version_id] : [])),
      ),
    ];
    if (versionIds.length > 0) {
      const { data: versions, error: versionError } = await admin
        .from('offer_versions')
        .select('id, tiers')
        .in('id', versionIds);
      if (versionError) return { ok: false, error: `Failed to load offers: ${versionError.message}` };
      for (const version of versions ?? []) {
        const base = lowestSealedBase(version.tiers);
        if (base) versionBase.set(version.id, base);
      }
    }
  }

  const ratings = restaurantIds.length > 0 ? await getRestaurantRatings(restaurantIds) : new Map();
  const exclude = new Set(options?.excludeCreditIds ?? []);
  const views: CarriedCreditView[] = [];

  for (const credit of credits) {
    if (exclude.has(credit.id)) continue;
    if (credit.status === 'pending' && credit.challenge_item_id == null) {
      const deadline = effectiveDeadlineAt(credit, null);
      views.push({
        creditId: credit.id,
        issuePeriod: credit.issue_period,
        slotNumber: credit.slot_number,
        issuedAt: credit.issued_at,
        expiresAt: credit.expires_at,
        effectiveDeadline: deadline.toISOString(),
        state: 'pending',
        item: null,
      });
      continue;
    }
    const linked = visibleLinked.find((row) => row.credit.id === credit.id);
    if (!linked) continue;
    const restaurant = restaurantById.get(linked.item.restaurant_id!);
    if (!restaurant) continue;
    const sealed = linked.item.offer_version_id
      ? versionBase.get(linked.item.offer_version_id)
      : undefined;
    const stats = ratings.get(restaurant.id);
    const deadline = effectiveDeadlineAt(credit, linked.item);
    views.push({
      creditId: credit.id,
      issuePeriod: credit.issue_period,
      slotNumber: credit.slot_number,
      issuedAt: credit.issued_at,
      expiresAt: credit.expires_at,
      effectiveDeadline: deadline.toISOString(),
      state: 'linked',
      item: {
        challengeItem: {
          id: linked.item.id,
          cycle_id: linked.item.cycle_id!,
          restaurant_id: linked.item.restaurant_id!,
          slot_number: linked.item.slot_number ?? credit.slot_number,
          status: linked.item.status ?? '',
          offer_version_id: linked.item.offer_version_id,
          redemption_deadline: linked.item.redemption_deadline,
          credit_id: linked.item.credit_id,
        },
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          cuisine_tags: restaurant.cuisine_tags,
          address: restaurant.address,
          lat: restaurant.lat,
          lon: restaurant.lon,
          status: restaurant.status ?? '',
          market_id: restaurant.market_id ?? '',
          org_id: restaurant.org_id ?? '',
          image_url: safeManualImagePath(restaurant.image_url),
          google_place_id: restaurant.google_place_id,
        },
        offer: sealed ? { available: true, ...sealed } : { available: false },
        redemptionToken: null,
        redemptionId: linked.redemptionId,
        socialProof: stats
          ? { avgRating: stats.avgRating, totalRatings: stats.totalRatings }
          : { avgRating: null, totalRatings: 0 },
      },
    });
  }

  views.sort((a, b) =>
    compareCarriedCredits(
      {
        id: a.creditId,
        issued_at: a.issuedAt,
        expires_at: a.expiresAt,
        item: a.item ? { redemption_deadline: a.item.challengeItem.redemption_deadline ?? null } : null,
      },
      {
        id: b.creditId,
        issued_at: b.issuedAt,
        expires_at: b.expiresAt,
        item: b.item ? { redemption_deadline: b.item.challengeItem.redemption_deadline ?? null } : null,
      },
    ),
  );

  return { ok: true, credits: omitCreditsOnCurrentCycle(views, exclude) };
}
