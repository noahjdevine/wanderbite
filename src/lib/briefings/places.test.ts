import { describe, expect, it, vi } from 'vitest';
import {
  PLACES_DETAILS_ATMOSPHERE_MICRODOLLARS,
  PLACES_DETAILS_ENTERPRISE_MICRODOLLARS,
  PLACES_DETAILS_FACT_FIELD_MASK,
  PLACES_DETAILS_WEBSITE_FIELD_MASK,
  PLACES_TEXT_SEARCH_FIELD_MASK,
  PLACES_TEXT_SEARCH_URL,
  factsFromPlaceRecord,
  lookupBriefingPlace,
  microdollarsForPlacesUnit,
  placeMatchesRestaurant,
  placesSkuForMask,
} from '@/lib/briefings/places';
import { normalizeHttpsUrl } from '@/lib/briefings/research';

const KEY = 'places-test-key';
const PLACE_ID = 'ChIJtestplace01';
const MAPS = 'https://maps.google.com/?cid=99';
const SITE = 'https://bobs.example.com/menu';

const RESTAURANT = {
  name: "Bob's",
  address: '100 Main St, McKinney, TX 75069',
  lat: 33.2,
  lon: -96.61,
};

function placeBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PLACE_ID,
    displayName: { text: "Bob's Burgers", languageCode: 'en' },
    formattedAddress: '100 Main St, McKinney, TX 75069',
    googleMapsUri: MAPS,
    websiteUri: SITE,
    parkingOptions: { freeParkingLot: true, paidParkingLot: false, valetParking: true },
    reservable: false,
    goodForGroups: true,
    outdoorSeating: true,
    accessibilityOptions: { wheelchairAccessibleEntrance: true, wheelchairAccessibleSeating: false },
    editorialSummary: { text: 'Invented prose about a secret roof deck.' },
    generativeSummary: { overview: { text: 'Do not copy this summary.' } },
    ...extra,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Places field masks and list prices', () => {
  it('keeps Text Search on the free id mask and details on one atmosphere call', () => {
    expect(PLACES_TEXT_SEARCH_FIELD_MASK).toBe('places.id');
    expect(placesSkuForMask(PLACES_TEXT_SEARCH_FIELD_MASK)).toBe('ids_only');
    expect(microdollarsForPlacesUnit('places_text_search_ids_only')).toBe(0);
    expect(placesSkuForMask(PLACES_DETAILS_FACT_FIELD_MASK)).toBe('atmosphere');
    expect(microdollarsForPlacesUnit('places_details_atmosphere')).toBe(
      PLACES_DETAILS_ATMOSPHERE_MICRODOLLARS,
    );
    expect(PLACES_DETAILS_ATMOSPHERE_MICRODOLLARS).toBe(25_000);
    for (const field of ['reviews', 'location', 'nationalPhoneNumber', 'rating', 'editorialSummary', 'photos']) {
      expect(PLACES_DETAILS_FACT_FIELD_MASK.split(',')).not.toContain(field);
    }
    expect(placesSkuForMask(PLACES_DETAILS_WEBSITE_FIELD_MASK)).toBe('enterprise');
    expect(microdollarsForPlacesUnit('places_details_enterprise')).toBe(PLACES_DETAILS_ENTERPRISE_MICRODOLLARS);
    expect(PLACES_DETAILS_ENTERPRISE_MICRODOLLARS).toBe(20_000);
    expect(PLACES_DETAILS_WEBSITE_FIELD_MASK.split(',')).not.toContain('parkingOptions');
    expect(placesSkuForMask('id,parkingOptions')).toBe('atmosphere');
  });
});

describe('factsFromPlaceRecord', () => {
  it('turns booleans into fixed sentences and ignores prose', () => {
    const built = factsFromPlaceRecord(placeBody(), MAPS);
    expect(built.attributionBlocked).toBe(false);
    expect(built.facts.map((fact) => fact.field)).toEqual([
      'parking',
      'arrival',
      'what_to_expect',
      'accessibility',
    ]);
    expect(built.facts.map((fact) => fact.text)).toEqual([
      'A free parking lot and valet parking are listed.',
      'Reservations are not accepted.',
      'Listed as good for groups and outdoor seating.',
      'A wheelchair-accessible entrance is listed.',
    ]);
    const joined = built.facts.map((fact) => `${fact.text} ${fact.supportPassage}`).join('\n');
    expect(joined).not.toMatch(/secret roof|overview|Invented/);
    expect(built.facts.every((fact) => fact.sourceUrl === MAPS)).toBe(true);
    expect(factsFromPlaceRecord(placeBody(), 'https://example.com/not-maps').facts).toEqual([]);
  });

  it('drops every fact when Places returns a third-party attribution', () => {
    const built = factsFromPlaceRecord(
      placeBody({ attributions: [{ provider: 'Example Provider', providerUri: 'https://example.com/credit' }] }),
      MAPS,
    );
    expect(built.attributionBlocked).toBe(true);
    expect(built.facts).toEqual([]);
  });

  it('omits a boolean that is missing and does not treat false parking as a sentence', () => {
    const built = factsFromPlaceRecord(
      {
        parkingOptions: { paidParkingLot: false },
        goodForGroups: false,
      },
      MAPS,
    );
    expect(built.facts).toEqual([]);
  });
});

describe('placeMatchesRestaurant', () => {
  it('requires the street number when the restaurant address has one', () => {
    expect(
      placeMatchesRestaurant({
        restaurantName: "Bob's",
        restaurantAddress: RESTAURANT.address,
        displayName: "Bob's Burgers",
        formattedAddress: '100 Main St, McKinney, TX',
      }),
    ).toBe(true);
    expect(
      placeMatchesRestaurant({
        restaurantName: "Bob's",
        restaurantAddress: RESTAURANT.address,
        displayName: "Bob's Burgers",
        formattedAddress: '400 Other St, McKinney, TX',
      }),
    ).toBe(false);
    expect(
      placeMatchesRestaurant({
        restaurantName: "Bob's",
        restaurantAddress: RESTAURANT.address,
        displayName: 'Other Kitchen',
        formattedAddress: '100 Main St, McKinney, TX',
      }),
    ).toBe(false);
  });
});

describe('lookupBriefingPlace', () => {
  it('searches by name and address, then reads one atmosphere details call', async () => {
    const calls: Array<{ url: string; mask: string; body: string; key: string }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      calls.push({
        url: String(input),
        mask: headers['X-Goog-FieldMask'] ?? '',
        body: String(init?.body ?? ''),
        key: headers['X-Goog-Api-Key'] ?? '',
      });
      if (String(input) === PLACES_TEXT_SEARCH_URL) {
        return jsonResponse({ places: [{ id: PLACE_ID }] });
      }
      return jsonResponse(placeBody());
    }) as typeof fetch;
    const result = await lookupBriefingPlace({
      restaurant: RESTAURANT,
      apiKey: KEY,
      fetchImpl,
      purpose: 'facts',
      normalizeUrl: normalizeHttpsUrl,
      acceptWebsite: (url) => url.startsWith('https://bobs.example.com'),
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(PLACES_TEXT_SEARCH_URL);
    expect(calls[0]?.url).not.toContain(KEY);
    expect(calls[1]?.url).not.toContain(KEY);
    expect(calls[0]?.key).toBe(KEY);
    expect(calls[0]?.mask).toBe('places.id');
    expect(calls[1]?.mask).toBe(PLACES_DETAILS_FACT_FIELD_MASK);
    const searchBody = JSON.parse(calls[0]?.body ?? '{}') as {
      textQuery?: string;
      pageSize?: number;
      locationBias?: { circle?: { center?: { latitude?: number } } };
    };
    expect(searchBody.textQuery).toContain("Bob's");
    expect(searchBody.textQuery).toContain('100 Main St');
    expect(searchBody.pageSize).toBe(1);
    expect(searchBody.locationBias?.circle?.center?.latitude).toBe(33.2);
    expect(result.placeId).toBe(PLACE_ID);
    expect(result.placeIdToStore).toBe(PLACE_ID);
    expect(result.officialWebsite).toBe(SITE);
    expect(result.facts).toHaveLength(4);
    expect(result.units).toEqual({
      places_text_search_ids_only: 1,
      places_details_atmosphere: 1,
    });
    expect(JSON.stringify(result)).not.toContain('secret roof');
    expect(JSON.stringify(result)).not.toContain('formattedAddress');
  });

  it('uses a stored place id without Text Search and does not replace it', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(`https://places.googleapis.com/v1/places/${PLACE_ID}`);
      return jsonResponse(placeBody());
    }) as typeof fetch;
    const result = await lookupBriefingPlace({
      restaurant: { ...RESTAURANT, googlePlaceId: PLACE_ID },
      apiKey: KEY,
      fetchImpl,
      purpose: 'facts',
      normalizeUrl: normalizeHttpsUrl,
      acceptWebsite: () => false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.placeId).toBe(PLACE_ID);
    expect(result.placeIdToStore).toBeNull();
    expect(result.officialWebsite).toBeNull();
    expect(result.notes.join('\n')).toMatch(/not an official host/);
    expect(result.units).toEqual({ places_details_atmosphere: 1 });
  });

  it('prices a website lookup at Place Details Enterprise and skips atmosphere fields', async () => {
    const masks: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      masks.push(headers['X-Goog-FieldMask'] ?? '');
      if (String(input) === PLACES_TEXT_SEARCH_URL) return jsonResponse({ places: [{ id: PLACE_ID }] });
      return jsonResponse(placeBody());
    }) as typeof fetch;
    const result = await lookupBriefingPlace({
      restaurant: RESTAURANT,
      apiKey: KEY,
      fetchImpl,
      purpose: 'website',
      normalizeUrl: normalizeHttpsUrl,
      acceptWebsite: () => true,
    });
    expect(masks[1]).toBe(PLACES_DETAILS_WEBSITE_FIELD_MASK);
    expect(result.facts).toEqual([]);
    expect(result.officialWebsite).toBe(SITE);
    expect(result.units).toEqual({
      places_text_search_ids_only: 1,
      places_details_enterprise: 1,
    });
  });

  it('does not call Places when the key is missing or outbound calls are disabled', async () => {
    const fetchImpl = vi.fn() as typeof fetch;
    const missing = await lookupBriefingPlace({
      restaurant: RESTAURANT,
      apiKey: '',
      fetchImpl,
      purpose: 'facts',
      normalizeUrl: normalizeHttpsUrl,
      acceptWebsite: () => true,
    });
    const disabled = await lookupBriefingPlace({
      restaurant: RESTAURANT,
      apiKey: KEY,
      fetchImpl,
      outboundDisabled: true,
      purpose: 'facts',
      normalizeUrl: normalizeHttpsUrl,
      acceptWebsite: () => true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(missing.notes.join('\n')).toMatch(/GOOGLE_PLACES_API_KEY is not set/);
    expect(missing.units).toEqual({});
    expect(disabled.notes.join('\n')).toMatch(/outbound Places calls are disabled/);
    expect(missing.notes.join('\n')).not.toContain(KEY);
  });
});
