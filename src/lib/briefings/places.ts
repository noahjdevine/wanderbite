import { briefingSourceLabel, type BriefingField } from '@/lib/briefings/types';

/**
 * Places API (New) prices checked 2026-11-05 against
 * https://developers.google.com/maps/billing-and-pricing/pricing
 * First paid tier (after the free monthly cap, up to 100,000 requests).
 * The free monthly cap is not subtracted: it is shared by the billing account.
 *
 * Text Search Essentials (IDs Only): unlimited, list price $0.
 * Place Details Essentials: $5 per 1,000.
 * Place Details Pro: $17 per 1,000.
 * Place Details Enterprise: $20 per 1,000.
 * Place Details Enterprise + Atmosphere: $25 per 1,000.
 * Text Search Pro / Enterprise / Enterprise + Atmosphere: $32 / $35 / $40 per 1,000.
 * A request is billed at the highest SKU in its field mask.
 */

export const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

/** IDs Only. Do not add displayName or the call becomes Text Search Pro. */
export const PLACES_TEXT_SEARCH_FIELD_MASK = 'places.id';

/**
 * One Place Details call at Enterprise + Atmosphere.
 * displayName and formattedAddress are match checks and are not returned.
 * websiteUri is an ephemeral official host and is not stored here.
 * location, photos, reviews, ratings, phone, and prose summaries are absent.
 */
export const PLACES_DETAILS_FACT_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'googleMapsUri',
  'attributions',
  'websiteUri',
  'accessibilityOptions',
  'parkingOptions',
  'reservable',
  'goodForGroups',
  'goodForChildren',
  'outdoorSeating',
  'dineIn',
  'liveMusic',
  'allowsDogs',
  'restroom',
].join(',');

/** websiteUri sets Place Details Enterprise. Atmosphere fields are absent on purpose. */
export const PLACES_DETAILS_WEBSITE_FIELD_MASK = 'id,displayName,formattedAddress,websiteUri';

export const PLACES_TEXT_SEARCH_IDS_ONLY_MICRODOLLARS = 0;
export const PLACES_TEXT_SEARCH_PRO_MICRODOLLARS = 32_000;
export const PLACES_TEXT_SEARCH_ENTERPRISE_MICRODOLLARS = 35_000;
export const PLACES_TEXT_SEARCH_ATMOSPHERE_MICRODOLLARS = 40_000;
export const PLACES_DETAILS_ESSENTIALS_MICRODOLLARS = 5_000;
export const PLACES_DETAILS_PRO_MICRODOLLARS = 17_000;
export const PLACES_DETAILS_ENTERPRISE_MICRODOLLARS = 20_000;
export const PLACES_DETAILS_ATMOSPHERE_MICRODOLLARS = 25_000;

const ATMOSPHERE_FIELDS = new Set([
  'allowsDogs',
  'dineIn',
  'goodForChildren',
  'goodForGroups',
  'liveMusic',
  'outdoorSeating',
  'parkingOptions',
  'reservable',
  'restroom',
]);

const ENTERPRISE_FIELDS = new Set(['websiteUri']);

const PRO_FIELDS = new Set([
  'accessibilityOptions',
  'displayName',
  'googleMapsUri',
]);

const ESSENTIALS_FIELDS = new Set(['formattedAddress']);

export type PlacesSku = 'ids_only' | 'essentials' | 'pro' | 'enterprise' | 'atmosphere';

const PLACES_TIMEOUT_MS = 8_000;

export type PlacesFactDraft = {
  field: BriefingField;
  text: string;
  sourceUrl: string;
  supportPassage: string;
};

export type PlacesLookupResult = {
  placeId: string | null;
  placeIdToStore: string | null;
  officialWebsite: string | null;
  facts: PlacesFactDraft[];
  units: Record<string, number>;
  notes: string[];
};

export type PlacesRestaurantQuery = {
  name: string;
  address: string | null;
  googlePlaceId?: string | null;
  lat?: number | null;
  lon?: number | null;
};

type PlacesPurpose = 'facts' | 'website';

const PARKING_TRUE: Array<[string, string]> = [
  ['freeParkingLot', 'a free parking lot'],
  ['paidParkingLot', 'a paid parking lot'],
  ['freeStreetParking', 'free street parking'],
  ['paidStreetParking', 'paid street parking'],
  ['valetParking', 'valet parking'],
  ['freeGarageParking', 'free garage parking'],
  ['paidGarageParking', 'paid garage parking'],
];

const ACCESS_TRUE: Array<[string, string]> = [
  ['wheelchairAccessibleEntrance', 'a wheelchair-accessible entrance'],
  ['wheelchairAccessibleParking', 'wheelchair-accessible parking'],
  ['wheelchairAccessibleRestroom', 'a wheelchair-accessible restroom'],
  ['wheelchairAccessibleSeating', 'wheelchair-accessible seating'],
];

const EXPECT_TRUE: Array<[string, string]> = [
  ['goodForGroups', 'good for groups'],
  ['goodForChildren', 'good for children'],
  ['outdoorSeating', 'outdoor seating'],
  ['dineIn', 'dine-in'],
  ['liveMusic', 'live music'],
  ['allowsDogs', 'dogs allowed'],
  ['restroom', 'a restroom'],
];

function maskFields(mask: string): string[] {
  return mask
    .split(',')
    .map((field) => field.trim().replace(/^places\./, ''))
    .filter(Boolean);
}

export function placesSkuForMask(mask: string): PlacesSku {
  const fields = maskFields(mask);
  if (fields.some((field) => ATMOSPHERE_FIELDS.has(field))) return 'atmosphere';
  if (fields.some((field) => ENTERPRISE_FIELDS.has(field))) return 'enterprise';
  if (fields.some((field) => PRO_FIELDS.has(field))) return 'pro';
  if (fields.some((field) => ESSENTIALS_FIELDS.has(field))) return 'essentials';
  return 'ids_only';
}

export function microdollarsForPlacesUnit(unit: string): number | null {
  switch (unit) {
    case 'places_text_search_ids_only':
      return PLACES_TEXT_SEARCH_IDS_ONLY_MICRODOLLARS;
    case 'places_text_search_pro':
      return PLACES_TEXT_SEARCH_PRO_MICRODOLLARS;
    case 'places_text_search_enterprise':
      return PLACES_TEXT_SEARCH_ENTERPRISE_MICRODOLLARS;
    case 'places_text_search_atmosphere':
      return PLACES_TEXT_SEARCH_ATMOSPHERE_MICRODOLLARS;
    case 'places_details_ids_only':
      return 0;
    case 'places_details_essentials':
      return PLACES_DETAILS_ESSENTIALS_MICRODOLLARS;
    case 'places_details_pro':
      return PLACES_DETAILS_PRO_MICRODOLLARS;
    case 'places_details_enterprise':
      return PLACES_DETAILS_ENTERPRISE_MICRODOLLARS;
    case 'places_details_atmosphere':
      return PLACES_DETAILS_ATMOSPHERE_MICRODOLLARS;
    default:
      return null;
  }
}

export function placesUnitKey(kind: 'text_search' | 'details', sku: PlacesSku): string {
  if (kind === 'text_search') {
    if (sku === 'ids_only') return 'places_text_search_ids_only';
    if (sku === 'enterprise') return 'places_text_search_enterprise';
    if (sku === 'atmosphere') return 'places_text_search_atmosphere';
    if (sku === 'pro' || sku === 'essentials') return 'places_text_search_pro';
    return 'places_text_search_ids_only';
  }
  if (sku === 'atmosphere') return 'places_details_atmosphere';
  if (sku === 'enterprise') return 'places_details_enterprise';
  if (sku === 'pro') return 'places_details_pro';
  if (sku === 'essentials') return 'places_details_essentials';
  return 'places_details_ids_only';
}

export function placesSkuLabel(kind: 'text_search' | 'details', unit: string): string | null {
  if (kind === 'text_search' && unit === 'places_text_search_ids_only') {
    return 'Text Search Essentials (IDs Only)';
  }
  if (unit === 'places_text_search_pro') return 'Text Search Pro';
  if (unit === 'places_text_search_enterprise') return 'Text Search Enterprise';
  if (unit === 'places_text_search_atmosphere') return 'Text Search Enterprise + Atmosphere';
  if (unit === 'places_details_atmosphere') return 'Place Details Enterprise + Atmosphere';
  if (unit === 'places_details_enterprise') return 'Place Details Enterprise';
  if (unit === 'places_details_pro') return 'Place Details Pro';
  if (unit === 'places_details_essentials') return 'Place Details Essentials';
  if (unit === 'places_details_ids_only') return 'Place Details Essentials (IDs Only)';
  return null;
}

function joinPhrases(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function listedSentence(phrases: string[]): string | null {
  if (phrases.length === 0) return null;
  const joined = joinPhrases(phrases);
  const head = joined.charAt(0).toUpperCase() + joined.slice(1);
  const verb = phrases.length === 1 ? 'is listed' : 'are listed';
  const text = `${head} ${verb}.`;
  return text.length <= 400 ? text : null;
}

function listedAs(phrases: string[]): string | null {
  if (phrases.length === 0) return null;
  const text = `Listed as ${joinPhrases(phrases)}.`;
  return text.length <= 400 ? text : null;
}

function truePhrases(value: unknown, pairs: ReadonlyArray<readonly [string, string]>): Array<{ key: string; phrase: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const kept: Array<{ key: string; phrase: string }> = [];
  for (const [key, phrase] of pairs) {
    if (record[key] === true) kept.push({ key, phrase });
  }
  return kept;
}

function trace(prefix: string, keys: readonly string[]): string {
  return keys.map((key) => `${prefix}.${key}=true`).join(' ');
}

function hasAttribution(place: Record<string, unknown>): boolean {
  const value = place.attributions;
  if (!Array.isArray(value)) return false;
  return value.some((item) => {
    if (typeof item === 'string') return item.trim().length > 0;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    const provider = typeof record.provider === 'string' ? record.provider.trim() : '';
    const uri = typeof record.providerUri === 'string' ? record.providerUri.trim() : '';
    return provider.length > 0 || uri.length > 0;
  });
}

function displayNameText(place: Record<string, unknown>): string {
  const value = place.displayName;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const text = (value as { text?: unknown }).text;
    return typeof text === 'string' ? text : '';
  }
  return '';
}

function formattedAddressText(place: Record<string, unknown>): string | null {
  return typeof place.formattedAddress === 'string' ? place.formattedAddress : null;
}

const ADDRESS_STOP = new Set(['texas', 'suite', 'united', 'states', 'mckinney', 'street', 'avenue']);

/** Name token plus a street number when the restaurant address has one. */
export function placeMatchesRestaurant(args: {
  restaurantName: string;
  restaurantAddress: string | null;
  displayName: string;
  formattedAddress: string | null;
}): boolean {
  const tokens = args.restaurantName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && token !== 'the' && token !== 'and');
  if (tokens.length === 0) return false;
  const placeName = args.displayName.toLowerCase();
  if (!tokens.some((token) => placeName.includes(token))) return false;
  const address = args.restaurantAddress?.trim() ?? '';
  if (!address) return true;
  const formatted = args.formattedAddress?.toLowerCase() ?? '';
  if (!formatted) return false;
  const number = address.match(/\d+/)?.[0];
  if (number) return formatted.includes(number);
  const words = address
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 5 && !ADDRESS_STOP.has(token));
  if (words.length === 0) return true;
  return words.some((word) => formatted.includes(word));
}

export function googleMapsPlaceUrl(placeId: string): string | null {
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(placeId)) return null;
  return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`;
}

/**
 * Boolean Places fields become fixed sentences. Prose fields are ignored.
 * A non-empty attributions array blocks every fact so the UI never shows
 * Places content without a provider credit this table cannot store.
 */
export function factsFromPlaceRecord(
  place: unknown,
  sourceUrl: string,
): { facts: PlacesFactDraft[]; attributionBlocked: boolean } {
  if (briefingSourceLabel(sourceUrl) !== 'Google Maps') {
    return { facts: [], attributionBlocked: false };
  }
  if (!place || typeof place !== 'object' || Array.isArray(place)) {
    return { facts: [], attributionBlocked: false };
  }
  const record = place as Record<string, unknown>;
  if (hasAttribution(record)) return { facts: [], attributionBlocked: true };
  const facts: PlacesFactDraft[] = [];
  const parking = truePhrases(record.parkingOptions, PARKING_TRUE);
  const parkingText = listedSentence(parking.map((item) => item.phrase));
  if (parkingText) {
    facts.push({
      field: 'parking',
      text: parkingText,
      sourceUrl,
      supportPassage: trace('parkingOptions', parking.map((item) => item.key)),
    });
  }
  if (typeof record.reservable === 'boolean') {
    facts.push({
      field: 'arrival',
      text: record.reservable ? 'Reservations are accepted.' : 'Reservations are not accepted.',
      sourceUrl,
      supportPassage: `reservable=${record.reservable}`,
    });
  }
  const expect = truePhrases(record, EXPECT_TRUE);
  const expectText = listedAs(expect.map((item) => item.phrase));
  if (expectText) {
    facts.push({
      field: 'what_to_expect',
      text: expectText,
      sourceUrl,
      supportPassage: expect.map((item) => `${item.key}=true`).join(' '),
    });
  }
  const access = truePhrases(record.accessibilityOptions, ACCESS_TRUE);
  const accessText = listedSentence(access.map((item) => item.phrase));
  if (accessText) {
    facts.push({
      field: 'accessibility',
      text: accessText,
      sourceUrl,
      supportPassage: trace('accessibilityOptions', access.map((item) => item.key)),
    });
  }
  return { facts, attributionBlocked: false };
}

function addUnit(units: Record<string, number>, key: string): void {
  units[key] = (units[key] ?? 0) + 1;
}

async function placesRequest(args: {
  fetchImpl: typeof fetch;
  apiKey: string;
  url: string;
  method: 'GET' | 'POST';
  fieldMask: string;
  body?: unknown;
}): Promise<{ status: number; json: unknown } | { status: null; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLACES_TIMEOUT_MS);
  try {
    const response = await args.fetchImpl(args.url, {
      method: args.method,
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': args.apiKey,
        'X-Goog-FieldMask': args.fieldMask,
      },
      body: args.body === undefined ? undefined : JSON.stringify(args.body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let json: unknown = null;
    if (raw.trim()) {
      try {
        json = JSON.parse(raw) as unknown;
      } catch {
        json = null;
      }
    }
    if (!response.ok) {
      return { status: response.status, json };
    }
    return { status: response.status, json };
  } catch {
    return { status: null, reason: 'Places request did not complete' };
  } finally {
    clearTimeout(timer);
  }
}

function textQuery(restaurant: PlacesRestaurantQuery): string {
  return `${restaurant.name} ${restaurant.address ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function textSearchBody(restaurant: PlacesRestaurantQuery): Record<string, unknown> {
  const body: Record<string, unknown> = {
    textQuery: textQuery(restaurant),
    pageSize: 1,
    regionCode: 'US',
  };
  const lat = restaurant.lat;
  const lon = restaurant.lon;
  if (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  ) {
    body.locationBias = {
      circle: {
        center: { latitude: lat, longitude: lon },
        radius: 5000,
      },
    };
  }
  return body;
}

function firstPlaceId(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const places = (body as { places?: unknown }).places;
  if (!Array.isArray(places) || places.length === 0) return null;
  const first = places[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return null;
  const id = (first as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

function placeRecord(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function acceptablePlaceId(id: string): boolean {
  return /^[A-Za-z0-9_-]{8,200}$/.test(id);
}

/**
 * Text Search (name + address) then Place Details.
 * Stores nothing. The caller may keep placeId only.
 * Counts a Places call when an HTTP response arrives, including an error status.
 */
export async function lookupBriefingPlace(args: {
  restaurant: PlacesRestaurantQuery;
  apiKey: string;
  fetchImpl?: typeof fetch;
  outboundDisabled?: boolean;
  purpose: PlacesPurpose;
  normalizeUrl: (raw: string | null | undefined) => string | null;
  acceptWebsite: (url: string) => boolean;
}): Promise<PlacesLookupResult> {
  const empty: PlacesLookupResult = {
    placeId: null,
    placeIdToStore: null,
    officialWebsite: null,
    facts: [],
    units: {},
    notes: [],
  };
  if (args.outboundDisabled) {
    return { ...empty, notes: ['Google Places skipped: outbound Places calls are disabled.'] };
  }
  const apiKey = args.apiKey.trim();
  if (!apiKey) {
    return { ...empty, notes: ['Google Places skipped: GOOGLE_PLACES_API_KEY is not set.'] };
  }
  const fetchImpl = args.fetchImpl ?? fetch;
  const detailsMask = args.purpose === 'facts' ? PLACES_DETAILS_FACT_FIELD_MASK : PLACES_DETAILS_WEBSITE_FIELD_MASK;
  const units: Record<string, number> = {};
  const notes: string[] = [];

  const search = async (): Promise<string | null> => {
    const posted = await placesRequest({
      fetchImpl,
      apiKey,
      url: PLACES_TEXT_SEARCH_URL,
      method: 'POST',
      fieldMask: PLACES_TEXT_SEARCH_FIELD_MASK,
      body: textSearchBody(args.restaurant),
    });
    if (posted.status == null) {
      notes.push(posted.reason);
      return null;
    }
    addUnit(units, placesUnitKey('text_search', placesSkuForMask(PLACES_TEXT_SEARCH_FIELD_MASK)));
    if (posted.status !== 200) {
      notes.push(`Places Text Search failed (HTTP ${posted.status})`);
      return null;
    }
    const id = firstPlaceId(posted.json);
    if (!id) {
      notes.push('Places Text Search returned no place');
      return null;
    }
    if (!acceptablePlaceId(id)) {
      notes.push('Places Text Search returned a place id this run will not use');
      return null;
    }
    return id;
  };

  const detailsFor = async (placeId: string): Promise<Record<string, unknown> | null> => {
    const posted = await placesRequest({
      fetchImpl,
      apiKey,
      url: `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      method: 'GET',
      fieldMask: detailsMask,
    });
    if (posted.status == null) {
      notes.push(posted.reason);
      return null;
    }
    addUnit(units, placesUnitKey('details', placesSkuForMask(detailsMask)));
    if (posted.status === 404) {
      notes.push('Places Place Details returned no place');
      return null;
    }
    if (posted.status !== 200) {
      notes.push(`Places Place Details failed (HTTP ${posted.status})`);
      return null;
    }
    return placeRecord(posted.json);
  };

  const accept = (place: Record<string, unknown>): boolean => {
    return placeMatchesRestaurant({
      restaurantName: args.restaurant.name,
      restaurantAddress: args.restaurant.address,
      displayName: displayNameText(place),
      formattedAddress: formattedAddressText(place),
    });
  };

  let acceptedId: string | null = null;
  let accepted: Record<string, unknown> | null = null;
  const storedId = args.restaurant.googlePlaceId?.trim() ?? '';
  if (storedId && acceptablePlaceId(storedId)) {
    const place = await detailsFor(storedId);
    if (place && accept(place)) {
      acceptedId = storedId;
      accepted = place;
    } else if (place) {
      notes.push('Stored place id did not match this restaurant. The stored id was not changed.');
    } else {
      notes.push('Stored place id was not used. The stored id was not changed.');
    }
  }

  if (!acceptedId) {
    const found = await search();
    if (found && found !== storedId) {
      const place = await detailsFor(found);
      if (place && accept(place)) {
        acceptedId = found;
        accepted = place;
      } else if (place) {
        notes.push('Places result did not match this restaurant name and address');
      }
    }
  }

  if (!acceptedId || !accepted) {
    return { ...empty, units, notes };
  }

  const websiteRaw = typeof accepted.websiteUri === 'string' ? args.normalizeUrl(accepted.websiteUri) : null;
  let officialWebsite: string | null = null;
  if (websiteRaw && args.acceptWebsite(websiteRaw)) officialWebsite = websiteRaw;
  else if (websiteRaw) notes.push(`Places websiteUri is not an official host: ${websiteRaw}`);
  else if (args.purpose === 'website') notes.push('Places did not return an https website');

  const mapsRaw = typeof accepted.googleMapsUri === 'string' ? args.normalizeUrl(accepted.googleMapsUri) : null;
  const mapsUrl = mapsRaw ?? args.normalizeUrl(googleMapsPlaceUrl(acceptedId));
  let facts: PlacesFactDraft[] = [];
  if (args.purpose === 'facts') {
    if (!mapsUrl || briefingSourceLabel(mapsUrl) !== 'Google Maps') {
      notes.push('Places facts were dropped because the Maps link was not https');
    } else {
      const built = factsFromPlaceRecord(accepted, mapsUrl);
      if (built.attributionBlocked) {
        notes.push('Places returned third-party attributions, so no Places facts were kept.');
      }
      facts = built.facts;
    }
  }

  const placeIdToStore = storedId ? null : acceptedId;
  return {
    placeId: acceptedId,
    placeIdToStore,
    officialWebsite,
    facts,
    units,
    notes,
  };
}
