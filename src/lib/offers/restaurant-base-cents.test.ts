import { describe, expect, it } from 'vitest';
import {
  firstActiveLegacyOfferByRestaurant,
  legacyOfferBaseCents,
  restaurantBaseCents,
  type LegacyOfferRow,
} from '@/lib/offers/restaurant-base-cents';

function offer(
  id: string,
  restaurantId: string,
  discount: number,
  minSpend: number,
  active = true,
): LegacyOfferRow {
  return {
    id,
    restaurant_id: restaurantId,
    discount_amount_cents: discount,
    min_spend_cents: minSpend,
    active,
  };
}

describe('restaurantBaseCents', () => {
  it('uses lowest tier when a current offer version is set', () => {
    expect(
      restaurantBaseCents({
        currentOfferVersionId: 'v1',
        versionTiers: [
          { threshold_cents: 6000, discount_cents: 1500 },
          { threshold_cents: 4000, discount_cents: 1000 },
        ],
        legacyOffer: offer('o1', 'r1', 2000, 4000),
      }),
    ).toBe(1000);
  });

  it('does not fall back to legacy when the version pointer is set but tiers are missing', () => {
    expect(
      restaurantBaseCents({
        currentOfferVersionId: 'v-missing',
        versionTiers: null,
        legacyOffer: offer('o1', 'r1', 2000, 4000),
      }),
    ).toBeNull();
  });

  it('picks the first active legacy offer by id', () => {
    const restaurantId = 'r1';
    const map = firstActiveLegacyOfferByRestaurant([
      offer('o2', restaurantId, 1000, 4000),
      offer('o1', restaurantId, 1500, 4000),
    ]);
    expect(map.get(restaurantId)?.id).toBe('o1');
    expect(
      restaurantBaseCents({
        currentOfferVersionId: null,
        versionTiers: null,
        legacyOffer: map.get(restaurantId),
      }),
    ).toBe(1500);
  });

  it('returns null when discount exceeds minimum spend', () => {
    expect(legacyOfferBaseCents({ discount_amount_cents: 5000, min_spend_cents: 4000 })).toBeNull();
    expect(
      restaurantBaseCents({
        currentOfferVersionId: null,
        versionTiers: null,
        legacyOffer: offer('o1', 'r1', 5000, 4000),
      }),
    ).toBeNull();
  });
});
