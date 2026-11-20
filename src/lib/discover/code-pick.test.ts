import { describe, expect, it } from 'vitest';
import {
  mergeSoftAsk,
  rankDiscoverRestaurant,
  type CodePickRestaurant,
} from '@/lib/discover/code-pick';
import { discoverCodePickEnabled } from '@/lib/discover/flag';

const TACO: CodePickRestaurant = {
  id: 'taco',
  cuisine_tags: ['mexican', 'tacos'],
  price_range: '$',
};
const SALSA: CodePickRestaurant = {
  id: 'salsa',
  cuisine_tags: ['mexican'],
  price_range: '$',
};
const FANCY: CodePickRestaurant = {
  id: 'fancy',
  cuisine_tags: ['mexican'],
  price_range: '$$$',
};
const BBQ: CodePickRestaurant = {
  id: 'bbq',
  cuisine_tags: ['bbq'],
  price_range: '$$',
};

const match = { preferredCuisine: 'mexican', priceRange: '$' };

describe('discoverCodePickEnabled', () => {
  it('is on only for the exact string true', () => {
    expect(discoverCodePickEnabled(undefined)).toBe(false);
    expect(discoverCodePickEnabled('')).toBe(false);
    expect(discoverCodePickEnabled('TRUE')).toBe(false);
    expect(discoverCodePickEnabled(' true')).toBe(false);
    expect(discoverCodePickEnabled('true ')).toBe(false);
    expect(discoverCodePickEnabled('1')).toBe(false);
    expect(discoverCodePickEnabled('true')).toBe(true);
  });
});

describe('rankDiscoverRestaurant', () => {
  it('returns null for an empty pool', () => {
    expect(rankDiscoverRestaurant({ pool: [], random: () => 0 })).toBeNull();
  });

  it('prefers an unvisited partner that matches cuisine and price', () => {
    const pool = [FANCY, BBQ, SALSA, TACO];
    const pick = rankDiscoverRestaurant({
      pool,
      ...match,
      visitedRestaurantIds: new Set(['salsa']),
      random: () => 0.99,
    });
    expect(pick?.restaurant.id).toBe('taco');
  });

  it('stays in the matching pool when every match has been visited', () => {
    const pool = [BBQ, SALSA, TACO, FANCY];
    const pick = rankDiscoverRestaurant({
      pool,
      ...match,
      visitedRestaurantIds: new Set(['taco', 'salsa']),
      random: () => 0,
    });
    expect(pick?.restaurant.id).toBe('salsa');
    const later = rankDiscoverRestaurant({
      pool,
      ...match,
      visitedRestaurantIds: new Set(['taco', 'salsa']),
      random: () => 0.99,
    });
    expect(later?.restaurant.id).toBe('taco');
  });

  it('draws inside the top tier so a repeat can change', () => {
    const pool = [TACO, SALSA];
    expect(
      rankDiscoverRestaurant({
        pool,
        ...match,
        visitedRestaurantIds: new Set(),
        random: () => 0,
      })?.restaurant.id,
    ).toBe('taco');
    expect(
      rankDiscoverRestaurant({
        pool,
        ...match,
        visitedRestaurantIds: new Set(),
        random: () => 0.99,
      })?.restaurant.id,
    ).toBe('salsa');
  });

  it('lets a cuisine match beat an unvisited restaurant that misses both preferences', () => {
    const pick = rankDiscoverRestaurant({
      pool: [BBQ, FANCY],
      preferredCuisine: 'mexican',
      priceRange: '$',
      visitedRestaurantIds: new Set(['fancy']),
      random: () => 0,
    });
    expect(pick?.restaurant.id).toBe('fancy');
  });

  it('treats cuisine and price as equal when only one can match', () => {
    const cuisineOnly = rankDiscoverRestaurant({
      pool: [FANCY, BBQ],
      preferredCuisine: 'mexican',
      priceRange: '$',
      random: () => 0,
    });
    expect(cuisineOnly?.restaurant.id).toBe('fancy');
    const priceOnly = rankDiscoverRestaurant({
      pool: [FANCY, BBQ],
      preferredCuisine: 'japanese',
      priceRange: '$$',
      random: () => 0,
    });
    expect(priceOnly?.restaurant.id).toBe('bbq');
  });

  it('does not treat a longer price mark as the requested range', () => {
    const pick = rankDiscoverRestaurant({
      pool: [FANCY, TACO],
      priceRange: '$$',
      random: () => 0,
    });
    expect(pick?.restaurant.id).toBe('fancy');
    expect(
      rankDiscoverRestaurant({
        pool: [{ id: 'exact', cuisine_tags: null, price_range: '$$' }, FANCY],
        priceRange: '$$',
        random: () => 0,
      })?.restaurant.id,
    ).toBe('exact');
  });

  it('keeps a visited row available when visits were not read', () => {
    const pick = rankDiscoverRestaurant({
      pool: [SALSA, TACO],
      ...match,
      visitedRestaurantIds: null,
      random: () => 0,
    });
    expect(pick?.restaurant.id).toBe('salsa');
  });

  it('prefers unvisited rows when no cuisine or price was asked', () => {
    const pick = rankDiscoverRestaurant({
      pool: [SALSA, TACO, BBQ],
      visitedRestaurantIds: new Set(['salsa', 'taco']),
      random: () => 0.99,
    });
    expect(pick?.restaurant.id).toBe('bbq');
  });

  it('matches a cuisine keyword on the tags', () => {
    const pick = rankDiscoverRestaurant({
      pool: [BBQ, { id: 'stand', cuisine_tags: ['tacos'], price_range: '$' }],
      preferredCuisine: 'mexican',
      priceRange: '$',
      random: () => 0,
    });
    expect(pick?.restaurant.id).toBe('stand');
  });

  it('treats a full soft match as met and a shortfall as unmet', () => {
    const both = rankDiscoverRestaurant({
      pool: [TACO, BBQ],
      ...match,
      random: () => 0,
    });
    expect(both?.preferencesMet).toBe(true);
    const none = rankDiscoverRestaurant({
      pool: [BBQ, FANCY],
      ...match,
      random: () => 0,
    });
    expect(none?.preferencesMet).toBe(false);
    expect(none?.restaurant.id).toBe('fancy');
    const open = rankDiscoverRestaurant({ pool: [BBQ], random: () => 0 });
    expect(open?.preferencesMet).toBe(true);
  });
});

describe('mergeSoftAsk', () => {
  it('reads cheap tacos from the message and lets chips win', () => {
    expect(mergeSoftAsk({ message: 'cheap tacos' })).toEqual({
      preferredCuisine: 'mexican',
      priceRange: '$',
    });
    expect(mergeSoftAsk({ message: 'a taco' })).toMatchObject({ preferredCuisine: 'mexican' });
    expect(mergeSoftAsk({ message: '' })).toEqual({
      preferredCuisine: undefined,
      priceRange: undefined,
    });
    expect(
      mergeSoftAsk({ message: 'cheap tacos', preferredCuisine: 'japanese', priceRange: '$$$' }),
    ).toEqual({ preferredCuisine: 'japanese', priceRange: '$$$' });
  });
});
