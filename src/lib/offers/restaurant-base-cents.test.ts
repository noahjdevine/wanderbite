import { describe, expect, it } from 'vitest';
import {
  firstActiveLegacyOfferByRestaurant,
  legacyOfferBaseCents,
  restaurantBaseCents,
  type LegacyOfferRow,
} from '@/lib/offers/restaurant-base-cents';
import { meetsMinimumCreditBase, MINIMUM_CREDIT_BASE_CENTS } from '@/lib/offers/credit-floor';

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

  it('picks legacy offers by restaurant id, not input row order', () => {
    const restaurantA = 'aaaaaaaa-0000-4000-8000-000000000001';
    const restaurantB = 'bbbbbbbb-0000-4000-8000-000000000002';
    const rows = [
      offer('o-b1', restaurantB, 1200, 4000),
      offer('o-a2', restaurantA, 1100, 4000),
      offer('o-a1', restaurantA, 1500, 4000),
      offer('o-b2', restaurantB, 1000, 4000),
    ];
    const forward = firstActiveLegacyOfferByRestaurant(rows);
    const reversed = firstActiveLegacyOfferByRestaurant([...rows].reverse());
    expect(forward.get(restaurantA)?.id).toBe('o-a1');
    expect(forward.get(restaurantB)?.id).toBe('o-b1');
    expect(reversed.get(restaurantA)?.id).toBe('o-a1');
    expect(reversed.get(restaurantB)?.id).toBe('o-b1');
    expect(
      restaurantBaseCents({
        currentOfferVersionId: null,
        versionTiers: null,
        legacyOffer: forward.get(restaurantB),
      }),
    ).toBe(1200);
  });

  it('matches SQL restaurant_base_cents floor boundaries on sealed tiers', () => {
    const tiers = [
      { threshold_cents: 6000, discount_cents: 1500 },
      { threshold_cents: 4000, discount_cents: 1000 },
    ];
    const atFloor = restaurantBaseCents({
      currentOfferVersionId: 'v1',
      versionTiers: tiers,
      legacyOffer: null,
    });
    expect(atFloor).toBe(1000);
    expect(meetsMinimumCreditBase(atFloor)).toBe(true);
    expect(MINIMUM_CREDIT_BASE_CENTS).toBe(1000);

    const belowFloor = restaurantBaseCents({
      currentOfferVersionId: 'v2',
      versionTiers: [{ threshold_cents: 4000, discount_cents: 999 }],
      legacyOffer: null,
    });
    expect(belowFloor).toBe(999);
    expect(meetsMinimumCreditBase(belowFloor)).toBe(false);
  });
});
