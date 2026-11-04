import { describe, expect, it } from 'vitest';
import { DISCOVER_FALLBACK_REASONS } from '@/lib/discover/fallback-reason';
import { discoverStreamReason } from '@/lib/discover/events';
import { eventsForDiscoverCard } from '@/lib/discover/card-events';
import { memberOfferFromVersion } from '@/lib/discover/member-offer';
import { restaurantMatchesDietaryQuick } from '@/lib/roulette-dietary';
import { ROULETTE_DIETARY_PILLS } from '@/lib/roulette-options';
import {
  classifyPickConstraints,
  constraintsFromDiscoveryInput,
  dietaryConstraintLabel,
  filterDetail,
  filterSample,
  foodFromParsedCuisine,
  listedDiscoverRestaurants,
  type DiscoverRestaurant,
} from '@/lib/discover/stages';

const NOW = new Date('2026-11-04T12:00:00.000Z');

function restaurant(partial: Partial<DiscoverRestaurant> & Pick<DiscoverRestaurant, 'id' | 'name'>): DiscoverRestaurant {
  return {
    cuisine_tags: null,
    neighborhood: null,
    address: null,
    price_range: null,
    image_url: null,
    google_place_id: null,
    is_dairy_free: false,
    is_vegan: false,
    is_halal: false,
    ...partial,
  };
}

const VEGAN = restaurant({
  id: 'rest-vegan',
  name: 'Green Table',
  cuisine_tags: ['vegan', 'noodles'],
  neighborhood: 'Downtown',
  price_range: '$$',
  is_vegan: true,
  status: 'active',
});

const BBQ = restaurant({
  id: 'rest-bbq',
  name: 'Smokehouse',
  cuisine_tags: ['bbq'],
  neighborhood: 'East',
  price_range: '$$',
  status: 'active',
});

describe('discover stage helpers', () => {
  it('drops paused, hidden, and test rows and keeps active or unset status', () => {
    const listed = listedDiscoverRestaurants([
      { id: 'a', status: 'active' },
      { id: 'b', status: 'paused' },
      { id: 'c', status: 'hidden' },
      { id: 'd', status: 'test' },
      { id: 'e', status: null },
      { id: 'f' },
    ]);
    expect(listed.map((row) => row.id)).toEqual(['a', 'e', 'f']);
  });

  it('marks every dietary constraint required and leaves the other chips optional', () => {
    const constraints = constraintsFromDiscoveryInput({
      dietary: ['vegan', 'halal'],
      vibe: 'Date Night',
      timeOfDay: 'Dinner',
      priceRange: '$$',
      preferredCuisine: 'japanese',
    });
    expect(constraints.filter((item) => item.key === 'dietary').every((item) => item.required)).toBe(
      true,
    );
    expect(constraints.filter((item) => item.key !== 'dietary').every((item) => !item.required)).toBe(
      true,
    );
    expect(constraints.map((item) => item.key)).toEqual([
      'dietary',
      'dietary',
      'occasion',
      'time',
      'budget',
      'cuisine',
    ]);
    for (const pill of ROULETTE_DIETARY_PILLS) {
      expect(dietaryConstraintLabel(pill.value)).toBe(pill.label);
    }
  });

  it('samples at most three real partners and does not invent a runner-up', () => {
    const rows = [VEGAN, BBQ, restaurant({ id: 'c', name: 'C' }), restaurant({ id: 'd', name: 'D' })];
    const events = eventsForDiscoverCard({
      message: 'spicy noodles',
      dietary: ['vegan'],
      excludedCuisineIds: [],
      restaurants: rows.filter((row) => restaurantMatchesDietaryQuick(row, ['vegan'])),
      chosen: VEGAN,
      reason: 'Green Table is a partner.',
      selectionMode: 'ai',
      fallbackReason: null,
      providerTimedOut: false,
    });
    const filter = events.find((event) => event.type === 'step' && event.id === 'filter');
    expect(filter && filter.type === 'step' && filter.id === 'filter' ? filter.sample : []).toHaveLength(1);
    expect(events.map((event) => (event.type === 'step' ? event.id : event.type))).toEqual([
      'parse',
      'filter',
      'pick',
    ]);
    expect(filterSample(rows)).toHaveLength(3);
    expect(filterSample(rows).map((partner) => partner.id)).toEqual(['rest-vegan', 'rest-bbq', 'c']);
  });

  it('maps food from the ask and defaults to generic', () => {
    expect(foodFromParsedCuisine({ message: 'spicy noodles' })).toBe('dumpling');
    expect(foodFromParsedCuisine({ message: 'sushi downtown' })).toBe('sushi');
    expect(foodFromParsedCuisine({ message: 'a pizza' })).toBe('pizza');
    expect(foodFromParsedCuisine({ message: 'tacos' })).toBe('taco');
    expect(foodFromParsedCuisine({ message: 'a burger' })).toBe('burger');
    expect(foodFromParsedCuisine({ message: 'bbq' })).toBe('bbq');
    expect(foodFromParsedCuisine({ message: 'quiet date night' })).toBe('generic');
    expect(foodFromParsedCuisine({ message: '', preferredCuisine: 'japanese' })).toBe('sushi');
  });

  it('classifies matched, unknown, and unmet from the parsed chips only', () => {
    const constraints = constraintsFromDiscoveryInput({
      dietary: ['vegan'],
      vibe: 'Date Night',
      priceRange: '$$',
      preferredCuisine: 'japanese',
    });
    const honesty = classifyPickConstraints({
      constraints,
      restaurant: VEGAN,
      priceRange: '$$',
      preferredCuisine: 'japanese',
    });
    expect(honesty.matched).toEqual(['Vegan', '$$ (Moderate)']);
    expect(honesty.unmet).toEqual(['Japanese / Sushi']);
    expect(honesty.unknown.map((item) => item.label)).toEqual(['Date Night']);
    expect(honesty.unknown[0]?.note.toLowerCase()).not.toContain('allerg');
  });

  it('describes only filters that actually ran', () => {
    expect(filterDetail({ dietary: [], excludedCuisineIds: [] })).toBe(
      'Active partners in the launch market',
    );
    expect(filterDetail({ dietary: ['vegan'], excludedCuisineIds: ['italian'] })).toBe(
      'Keeping partners that match Vegan. Skipping Italian',
    );
  });

  it('maps #97 reasons onto the stream fallback reasons', () => {
    for (const reason of DISCOVER_FALLBACK_REASONS) {
      const mapped = discoverStreamReason(reason, false);
      if (reason === 'provider_error') expect(mapped).toBe('provider_error');
      else expect(mapped).toBe('no_match');
    }
    expect(discoverStreamReason('provider_error', true)).toBe('timeout');
    expect(discoverStreamReason('parse_failed', true)).toBe('timeout');
  });

  it('omits a test offer and keeps a selectable member offer in cents', () => {
    const version = {
      id: 'ver-1',
      restaurant_id: VEGAN.id,
      tiers: [{ threshold_cents: 4000, discount_cents: 1000 }],
      valid_from: '2020-01-01T00:00:00.000Z',
      valid_until: '2028-01-01T00:00:00.000Z',
      withdrawn_from_selection_at: null,
    };
    expect(
      memberOfferFromVersion({
        restaurantId: VEGAN.id,
        currentOfferVersionId: 'ver-1',
        version,
        isTestOffer: true,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      memberOfferFromVersion({
        restaurantId: VEGAN.id,
        currentOfferVersionId: 'ver-1',
        version,
        isTestOffer: false,
        now: NOW,
      }),
    ).toEqual({ amountOff: 1000, minSpend: 4000 });
    expect(
      memberOfferFromVersion({
        restaurantId: VEGAN.id,
        currentOfferVersionId: 'other',
        version,
        isTestOffer: false,
        now: NOW,
      }),
    ).toBeNull();
  });
});
