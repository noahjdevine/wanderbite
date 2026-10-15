import type { Json } from '@/types/database.types';
import { lowestSealedBase } from '@/lib/offers/sealed-base';

export type LegacyOfferRow = {
  id: string;
  restaurant_id: string;
  discount_amount_cents: number | null;
  min_spend_cents: number | null;
  active: boolean;
};

/** Mirrors `public.restaurant_base_cents` legacy branch (no version pointer). */
export function legacyOfferBaseCents(offer: {
  discount_amount_cents: number | null | undefined;
  min_spend_cents: number | null | undefined;
}): number | null {
  const discount = offer.discount_amount_cents;
  const minimum = offer.min_spend_cents;
  if (discount == null || discount <= 0 || minimum == null || discount > minimum) {
    return null;
  }
  return discount;
}

/** First active legacy offer per restaurant, ordered by `id` (SQL `order by id limit 1`). */
export function firstActiveLegacyOfferByRestaurant<T extends LegacyOfferRow>(
  offers: T[],
): Map<string, T> {
  const sorted = [...offers]
    .filter((row) => row.active === true)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byRestaurant = new Map<string, T>();
  for (const row of sorted) {
    if (!byRestaurant.has(row.restaurant_id)) {
      byRestaurant.set(row.restaurant_id, row);
    }
  }
  return byRestaurant;
}

/**
 * Mirrors `public.restaurant_base_cents`: version pointer uses lowest tier only;
 * no legacy fallback when a version is referenced.
 */
export function restaurantBaseCents(args: {
  currentOfferVersionId: string | null | undefined;
  versionTiers: Json | null | undefined;
  legacyOffer: LegacyOfferRow | null | undefined;
}): number | null {
  if (args.currentOfferVersionId) {
    const sealed = lowestSealedBase(args.versionTiers);
    return sealed?.discount_amount_cents ?? null;
  }
  if (!args.legacyOffer) return null;
  return legacyOfferBaseCents(args.legacyOffer);
}
