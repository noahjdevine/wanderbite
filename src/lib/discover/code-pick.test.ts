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
  it('reads cheap tacos from the message and lets a chip replace the positive cuisine', () => {
    expect(mergeSoftAsk({ message: 'cheap tacos' })).toEqual({
      preferredCuisines: ['mexican'],
      excludedCuisines: [],
      priceRange: '$',
    });
    expect(mergeSoftAsk({ message: 'a taco' }).preferredCuisines).toEqual(['mexican']);
    expect(mergeSoftAsk({ message: '' })).toEqual({
      preferredCuisines: [],
      excludedCuisines: [],
      priceRange: undefined,
    });
    expect(
      mergeSoftAsk({ message: 'cheap tacos', preferredCuisine: 'japanese', priceRange: '$$$' }),
    ).toEqual({
      preferredCuisines: ['japanese'],
      excludedCuisines: [],
      priceRange: '$$$',
    });
  });

  it('treats a negated cuisine as an exclusion and keeps every positive cuisine', () => {
    expect(mergeSoftAsk({ message: 'anything but sushi' })).toEqual({
      preferredCuisines: [],
      excludedCuisines: ['japanese'],
      priceRange: undefined,
    });
    expect(mergeSoftAsk({ message: 'anything but sushi tonight' }).excludedCuisines).toEqual([
      'japanese',
    ]);
    expect(mergeSoftAsk({ message: 'no thai' }).excludedCuisines).toEqual(['thai']);
    expect(mergeSoftAsk({ message: 'not pizza tonight' })).toMatchObject({
      preferredCuisines: [],
      excludedCuisines: ['pizza'],
    });
    expect(mergeSoftAsk({ message: 'sushi or thai' }).preferredCuisines).toEqual([
      'japanese',
      'thai',
    ]);
    expect(mergeSoftAsk({ message: 'no sushi, maybe tacos' })).toEqual({
      preferredCuisines: ['mexican'],
      excludedCuisines: ['japanese'],
      priceRange: undefined,
    });
    expect(mergeSoftAsk({ message: 'not in the mood for thai' }).excludedCuisines).toEqual(['thai']);
    expect(mergeSoftAsk({ message: 'sushi-free' }).excludedCuisines).toEqual(['japanese']);
    expect(mergeSoftAsk({ message: 'avoid pizza' }).excludedCuisines).toEqual(['pizza']);
    expect(mergeSoftAsk({ message: 'without thai' }).excludedCuisines).toEqual(['thai']);
    expect(mergeSoftAsk({ message: 'except sushi' }).excludedCuisines).toEqual(['japanese']);
    expect(mergeSoftAsk({ message: "I'm so over sushi" })).toMatchObject({
      preferredCuisines: [],
      excludedCuisines: ['japanese'],
    });
    expect(mergeSoftAsk({ message: 'so over sushi' }).excludedCuisines).toEqual(['japanese']);
    expect(mergeSoftAsk({ message: 'over sushi' }).excludedCuisines).toEqual(['japanese']);
    expect(mergeSoftAsk({ message: 'sick of thai' }).excludedCuisines).toEqual(['thai']);
    expect(mergeSoftAsk({ message: 'tired of pizza' }).excludedCuisines).toEqual(['pizza']);
    expect(mergeSoftAsk({ message: 'had sushi last night' }).excludedCuisines).toEqual(['japanese']);
    expect(mergeSoftAsk({ message: 'had tacos yesterday' }).excludedCuisines).toEqual(['mexican']);
    expect(mergeSoftAsk({ message: 'skip the sushi' }).excludedCuisines).toEqual(['japanese']);
    expect(mergeSoftAsk({ message: 'skip sushi' }).excludedCuisines).toEqual(['japanese']);
    expect(mergeSoftAsk({ message: 'not feeling pizza' }).excludedCuisines).toEqual(['pizza']);
    expect(mergeSoftAsk({ message: 'sushi' })).toMatchObject({
      preferredCuisines: ['japanese'],
      excludedCuisines: [],
    });
    expect(mergeSoftAsk({ message: 'craving sushi' })).toMatchObject({
      preferredCuisines: ['japanese'],
      excludedCuisines: [],
    });
    expect(mergeSoftAsk({ message: 'I had amazing thai last week, want more' })).toMatchObject({
      preferredCuisines: ['thai'],
      excludedCuisines: [],
    });
    expect(mergeSoftAsk({ message: 'loved the thai I had' })).toMatchObject({
      preferredCuisines: ['thai'],
      excludedCuisines: [],
    });
    expect(mergeSoftAsk({ message: 'had sushi last night, something else' })).toMatchObject({
      preferredCuisines: [],
      excludedCuisines: ['japanese'],
    });
    expect(mergeSoftAsk({ message: 'already had sushi' }).excludedCuisines).toEqual(['japanese']);
    expect(mergeSoftAsk({ message: 'had too much pizza' }).excludedCuisines).toEqual(['pizza']);
    expect(mergeSoftAsk({ message: 'sushi over thai' })).toEqual({
      preferredCuisines: ['japanese'],
      excludedCuisines: [],
      priceRange: undefined,
    });
    expect(mergeSoftAsk({ message: "I'm over pizza" })).toMatchObject({
      preferredCuisines: [],
      excludedCuisines: ['pizza'],
    });
    expect(mergeSoftAsk({ message: 'over sushi tonight' }).excludedCuisines).toEqual(['japanese']);
  });
});

describe('negated cuisines stay out of the pick', () => {
  const sushi = { id: 'sushi', cuisine_tags: ['sushi'], price_range: '$$' };
  const thai = { id: 'thai', cuisine_tags: ['thai'], price_range: '$$' };
  const tacos = { id: 'tacos', cuisine_tags: ['tacos'], price_range: '$' };

  it('never picks an excluded cuisine, and does not call that an unmet preference', () => {
    const ask = mergeSoftAsk({ message: 'anything but sushi tonight' });
    const pick = rankDiscoverRestaurant({
      pool: [sushi, thai],
      preferredCuisines: ask.preferredCuisines,
      excludedCuisines: ask.excludedCuisines,
      random: () => 0,
    });
    expect(pick?.restaurant.id).toBe('thai');
    expect(pick?.preferencesMet).toBe(true);
  });

  it('returns nothing when the exclusion removes every partner', () => {
    const ask = mergeSoftAsk({ message: 'no sushi' });
    expect(
      rankDiscoverRestaurant({
        pool: [sushi],
        preferredCuisines: ask.preferredCuisines,
        excludedCuisines: ask.excludedCuisines,
        random: () => 0,
      }),
    ).toBeNull();
  });

  it('picks among every positive cuisine, not only the first catalog id', () => {
    const ask = mergeSoftAsk({ message: 'sushi or thai' });
    expect(
      rankDiscoverRestaurant({
        pool: [sushi, thai],
        preferredCuisines: ask.preferredCuisines,
        random: () => 0,
      })?.restaurant.id,
    ).toBe('sushi');
    expect(
      rankDiscoverRestaurant({
        pool: [sushi, thai],
        preferredCuisines: ask.preferredCuisines,
        random: () => 0.99,
      })?.restaurant.id,
    ).toBe('thai');
  });

  it('skips sushi and prefers tacos', () => {
    const ask = mergeSoftAsk({ message: 'no sushi, maybe tacos' });
    const pick = rankDiscoverRestaurant({
      pool: [sushi, thai, tacos],
      preferredCuisines: ask.preferredCuisines,
      excludedCuisines: ask.excludedCuisines,
      priceRange: ask.priceRange,
      random: () => 0.99,
    });
    expect(pick?.restaurant.id).toBe('tacos');
    expect(pick?.preferencesMet).toBe(true);
  });

  it('keeps praised thai and prefers sushi over thai', () => {
    const bbq = { id: 'bbq', cuisine_tags: ['bbq'], price_range: '$$' };
    const praised = mergeSoftAsk({ message: 'I had amazing thai last week, want more' });
    const praisedPick = rankDiscoverRestaurant({
      pool: [bbq, thai],
      preferredCuisines: praised.preferredCuisines,
      excludedCuisines: praised.excludedCuisines,
      random: () => 0,
    });
    expect(praisedPick?.restaurant.id).toBe('thai');
    expect(praisedPick?.preferencesMet).toBe(true);

    const over = mergeSoftAsk({ message: 'sushi over thai' });
    const overPick = rankDiscoverRestaurant({
      pool: [thai, sushi],
      preferredCuisines: over.preferredCuisines,
      excludedCuisines: over.excludedCuisines,
      random: () => 0,
    });
    expect(over.preferredCuisines).toEqual(['japanese']);
    expect(overPick?.restaurant.id).toBe('sushi');
    expect(overPick?.preferencesMet).toBe(true);
  });

  it('treats a sushi match for sushi or thai as met', () => {
    const ask = mergeSoftAsk({ message: 'sushi or thai' });
    const shun = { id: 'shun', cuisine_tags: ['sushi'], price_range: '$$' };
    const pick = rankDiscoverRestaurant({
      pool: [shun, { id: 'steak', cuisine_tags: ['steak'], price_range: '$$$' }],
      preferredCuisines: ask.preferredCuisines,
      excludedCuisines: ask.excludedCuisines,
      random: () => 0,
    });
    expect(pick?.restaurant.id).toBe('shun');
    expect(pick?.preferencesMet).toBe(true);
  });
});
