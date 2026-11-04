import { describe, expect, it } from 'vitest';
import { eventsForDiscoverCard } from '@/lib/discover/card-events';
import {
  discoverMapsSearchUrl,
  googleMapsSearchUrl,
  httpsGoogleMapsUrl,
  partnerDirections,
} from '@/lib/discover/directions';
import { LAUNCH_MARKET } from '@/lib/launch-market';
import type { DiscoverRestaurant } from '@/lib/discover/stages';

function restaurant(
  partial: Partial<DiscoverRestaurant> & Pick<DiscoverRestaurant, 'id' | 'name'>,
): DiscoverRestaurant {
  return {
    cuisine_tags: ['noodles'],
    neighborhood: 'Downtown',
    address: null,
    price_range: '$$',
    image_url: null,
    google_place_id: null,
    ...partial,
  };
}

describe('discover maps URL', () => {
  it('matches the roulette Get Directions query: name plus launch city', () => {
    const name = 'Noodle House';
    const url = discoverMapsSearchUrl(name, LAUNCH_MARKET.cityQuery);
    expect(url).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${LAUNCH_MARKET.cityQuery}`)}`,
    );
    expect(url).toContain('McKinney%20TX');
    expect(discoverMapsSearchUrl('', LAUNCH_MARKET.cityQuery)).toBeNull();
    expect(googleMapsSearchUrl('100 Main St')).toBe(
      'https://www.google.com/maps/search/?api=1&query=100%20Main%20St',
    );
  });

  it('accepts only https Google Maps hosts', () => {
    const ok = 'https://www.google.com/maps/search/?api=1&query=Noodle';
    expect(httpsGoogleMapsUrl(ok)).toBe(ok);
    expect(httpsGoogleMapsUrl('https://maps.google.com/maps?q=Noodle')).toContain('maps.google.com');
    expect(httpsGoogleMapsUrl('http://www.google.com/maps/search/?api=1&query=Noodle')).toBeNull();
    expect(httpsGoogleMapsUrl('https://evil.example/maps')).toBeNull();
    expect(httpsGoogleMapsUrl('not a url')).toBeNull();
  });

  it('adds address and maps URL only when the row has them', () => {
    expect(partnerDirections({ name: '', address: null })).toBeUndefined();
    expect(partnerDirections({ name: '', address: '   ' })).toBeUndefined();
    expect(partnerDirections({ name: 'Noodle House', address: null })).toEqual({
      mapsUrl: discoverMapsSearchUrl('Noodle House', LAUNCH_MARKET.cityQuery),
    });
    expect(partnerDirections({ name: 'Noodle House', address: '  100 Main St  ' })).toEqual({
      address: '100 Main St',
      mapsUrl: discoverMapsSearchUrl('Noodle House', LAUNCH_MARKET.cityQuery),
    });
    expect(partnerDirections({ name: '', address: '100 Main St' })).toEqual({
      address: '100 Main St',
    });
  });
});

describe('discover event directions', () => {
  const named = restaurant({ id: 'rest-1', name: 'Noodle House', address: '100 Main St' });
  const nameless = restaurant({ id: 'rest-2', name: '', address: null });

  it('puts directions on the pick partner and the fallback alternative', () => {
    const pick = eventsForDiscoverCard({
      message: 'noodles',
      dietary: [],
      excludedCuisineIds: [],
      restaurants: [named],
      chosen: named,
      reason: 'Noodle House is a partner.',
      selectionMode: 'ai',
      fallbackReason: null,
      providerTimedOut: false,
    });
    const pickEvent = pick.find((event) => event.type === 'pick');
    expect(pickEvent && pickEvent.type === 'pick' ? pickEvent.partner.directions : null).toEqual(
      partnerDirections({ name: named.name, address: named.address }),
    );
    const filter = pick.find((event) => event.type === 'step' && event.id === 'filter');
    const sample =
      filter && filter.type === 'step' && filter.id === 'filter' ? filter.sample[0] : null;
    expect(sample?.directions).toBeUndefined();

    const fallback = eventsForDiscoverCard({
      message: 'noodles',
      dietary: [],
      excludedCuisineIds: [],
      restaurants: [named, nameless],
      chosen: named,
      reason: 'Noodle House is a partner.',
      selectionMode: 'random_fallback',
      fallbackReason: 'invalid_pick',
      providerTimedOut: false,
    });
    const fallbackEvent = fallback.find((event) => event.type === 'fallback');
    expect(
      fallbackEvent && fallbackEvent.type === 'fallback' ? fallbackEvent.alternative.directions : null,
    ).toEqual(partnerDirections({ name: named.name, address: named.address }));

    const empty = eventsForDiscoverCard({
      message: 'noodles',
      dietary: [],
      excludedCuisineIds: [],
      restaurants: [nameless],
      chosen: nameless,
      reason: 'No name.',
      selectionMode: 'ai',
      fallbackReason: null,
      providerTimedOut: false,
    });
    const emptyPick = empty.find((event) => event.type === 'pick');
    expect(emptyPick && emptyPick.type === 'pick' ? emptyPick.partner.directions : 'missing').toBeUndefined();
    expect(emptyPick && emptyPick.type === 'pick' ? emptyPick.partner.name : '').toBe('');
  });
});
