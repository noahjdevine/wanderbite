import { describe, expect, it } from 'vitest';

import {
  creditFloorEligibleRestaurants,
  pickDistinctRestaurants,
  poolHasDistinctCreditFloorEligible,
  selectDistancePool,
} from '@/lib/challenges/distance-pool';
import { MINIMUM_CREDIT_BASE_CENTS } from '@/lib/offers/credit-floor';

const identity = <T,>(items: T[]) => items;

describe('credit floor distance pool', () => {
  it('requires two distinct independently eligible restaurants', () => {
    const nine = { id: 'nine', baseCents: 900, cuisine_tags: ['salad'] as string[] | null };
    const otherNine = { id: 'nine-b', baseCents: 900, cuisine_tags: ['salad'] };
    const eleven = { id: 'eleven', baseCents: 1100, cuisine_tags: ['salad'] };

    expect(poolHasDistinctCreditFloorEligible([nine, otherNine])).toBe(false);
    expect(poolHasDistinctCreditFloorEligible([nine, otherNine, eleven])).toBe(false);
    expect(poolHasDistinctCreditFloorEligible([eleven, { ...eleven, id: 'eleven-b' }])).toBe(true);

    const picked = pickDistinctRestaurants([eleven, { ...eleven, id: 'twelve', baseCents: 1000 }], 2, {
      shuffle: identity,
      reserveCocktail: false,
    });
    expect(picked).toHaveLength(2);
    expect(new Set(picked.map((row) => row.id)).size).toBe(2);
  });

  it('prefers a cocktail pick when reserving cocktail experience', () => {
    const saladA = { id: 'salad-a', baseCents: 1000, cuisine_tags: ['salad'] };
    const saladB = { id: 'salad-b', baseCents: 1000, cuisine_tags: ['salad'] };
    const cocktail = { id: 'cocktail', baseCents: 1000, cuisine_tags: ['cocktail bar'] };

    const preferred = pickDistinctRestaurants([saladA, saladB, cocktail], 2, {
      shuffle: identity,
      reserveCocktail: true,
    });
    expect(preferred.map((row) => row.id)).toContain('cocktail');
  });

  it('expands when the callback needs two eligible ids and stays put when only the count is checked', () => {
    const near = Array.from({ length: 8 }, (_, index) => ({
      id: `near-${index}`,
      lat: 33.15 + index * 0.001,
      lon: -96.82,
      baseCents: 900,
      cuisine_tags: ['salad'] as string[] | null,
    }));
    const far = {
      id: 'far-a',
      lat: 33.25,
      lon: -96.82,
      baseCents: MINIMUM_CREDIT_BASE_CENTS,
      cuisine_tags: ['salad'] as string[] | null,
    };
    const farB = {
      id: 'far-b',
      lat: 33.251,
      lon: -96.82,
      baseCents: MINIMUM_CREDIT_BASE_CENTS,
      cuisine_tags: ['salad'] as string[] | null,
    };

    const pool = selectDistancePool({
      restaurants: [...near, far, farB],
      origin: { lat: 33.15, lon: -96.82 },
      requestedMiles: 5,
      requiredCount: 2,
      passesHard: () => true,
      passesVariety: () => true,
      passesRelaxedVariety: () => true,
      poolSatisfies: (candidates) => poolHasDistinctCreditFloorEligible(candidates),
    });
    expect(pool.match.expanded).toBe(true);
    expect(poolHasDistinctCreditFloorEligible(pool.candidates)).toBe(true);
    expect(creditFloorEligibleRestaurants(pool.candidates)).toHaveLength(2);
  });

  it('relaxes inside the requested band when only that pool has two eligible restaurants', () => {
    const strictOnly = {
      id: 'strict',
      lat: 33.15,
      lon: -96.82,
      baseCents: MINIMUM_CREDIT_BASE_CENTS,
      cuisine_tags: ['salad'] as string[] | null,
    };
    const relaxedOnly = {
      id: 'relaxed',
      lat: 33.151,
      lon: -96.82,
      baseCents: MINIMUM_CREDIT_BASE_CENTS,
      cuisine_tags: ['salad'] as string[] | null,
    };
    const pool = selectDistancePool({
      restaurants: [strictOnly, relaxedOnly],
      origin: { lat: 33.15, lon: -96.82 },
      requestedMiles: 5,
      requiredCount: 2,
      passesHard: () => true,
      passesVariety: (restaurant) => restaurant.id === 'strict',
      passesRelaxedVariety: () => true,
      poolSatisfies: (candidates) => poolHasDistinctCreditFloorEligible(candidates),
    });
    expect(pool.match.expanded).toBe(false);
    expect(poolHasDistinctCreditFloorEligible(pool.candidates)).toBe(true);
  });

  it('stops after one band when no radius has two eligible restaurants', () => {
    const pool = selectDistancePool({
      restaurants: [
        { id: 'way-out', lat: 33.4, lon: -96.82, baseCents: MINIMUM_CREDIT_BASE_CENTS, cuisine_tags: null },
        { id: 'also-out', lat: 33.41, lon: -96.82, baseCents: MINIMUM_CREDIT_BASE_CENTS, cuisine_tags: null },
      ],
      origin: { lat: 33.15, lon: -96.82 },
      requestedMiles: 5,
      requiredCount: 2,
      passesHard: () => true,
      passesVariety: () => true,
      passesRelaxedVariety: () => true,
      poolSatisfies: (candidates) => poolHasDistinctCreditFloorEligible(candidates),
    });
    expect(pool.match.expanded).toBe(true);
    expect(poolHasDistinctCreditFloorEligible(pool.candidates)).toBe(false);
  });
});
