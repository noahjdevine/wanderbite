import { DISTANCE_BANDS, type DistanceBand } from '@/lib/onboarding-shared';

export type GeoPoint = { lat: number; lon: number };

export type StructuredAddress = {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export type LaunchAreaState = 'missing_address' | 'ineligible' | 'eligible';

export type DistanceMatch = {
  requestedMiles: number;
  usedMiles: number;
  expanded: boolean;
};

/**
 * Launch city configuration. ZIP centroids are U.S. Census Bureau 2025
 * ZCTA national gazetteer INTPTLAT / INTPTLONG (2025_Gaz_zcta_national).
 */
export const LAUNCH_MARKET = {
  slug: 'mckinney-tx',
  displayName: 'McKinney, Texas',
  state: 'TX',
  cityQuery: 'McKinney TX',
  centroid: { lat: 33.1984, lon: -96.6397 },
  zipCentroids: {
    '75069': { lat: 33.164077, lon: -96.595421 },
    '75070': { lat: 33.154678, lon: -96.696669 },
    '75071': { lat: 33.245816, lon: -96.63072 },
    '75072': { lat: 33.187899, lon: -96.699951 },
  },
} as const;

export const LAUNCH_ZIP_CODES = Object.keys(
  LAUNCH_MARKET.zipCentroids
) as Array<keyof typeof LAUNCH_MARKET.zipCentroids>;

const BAND_MILES: Record<DistanceBand, number> = {
  '5_mi': 5,
  '15_mi': 15,
  '25_mi': 25,
  '40_mi': 40,
};

const NEXT_BAND_MILES: Record<number, number | null> = {
  5: 15,
  15: 25,
  25: 40,
  40: null,
};

const EARTH_RADIUS_MILES = 3958.7613;
const ZIP_PATTERN = /^\d{5}(-\d{4})?$/;

export const CHECKOUT_INELIGIBLE_MESSAGE =
  'Wanderbite is not available at this address yet.';

export const AREA_HOLD_HEADING = 'Not available in your area yet';

export const AREA_HOLD_BODY =
  'The Wanderbite Club currently serves McKinney, Texas. We are not collecting emails or waitlist details.';

export function normalizeZip(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!ZIP_PATTERN.test(trimmed)) return null;
  return trimmed.slice(0, 5);
}

export function isValidCoordinate(
  lat: number | null | undefined,
  lon: number | null | undefined
): boolean {
  if (lat == null || lon == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lon < -180 || lon > 180) return false;
  return true;
}

export function toGeoPoint(
  lat: number | null | undefined,
  lon: number | null | undefined
): GeoPoint | null {
  if (!isValidCoordinate(lat, lon) || lat == null || lon == null) return null;
  return { lat, lon };
}

export function parseCoordinate(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

export function parseDistanceBand(
  value: string | null | undefined
): DistanceBand | null {
  if (!value) return null;
  return DISTANCE_BANDS.includes(value as DistanceBand)
    ? (value as DistanceBand)
    : null;
}

export function milesForDistanceBand(band: DistanceBand): number {
  return BAND_MILES[band];
}

export function nextBandMiles(miles: number): number | null {
  return NEXT_BAND_MILES[miles] ?? null;
}

export function originFromZip(zip: string | null | undefined): GeoPoint | null {
  const normalized = normalizeZip(zip);
  if (!normalized) return null;
  const point =
    LAUNCH_MARKET.zipCentroids[
      normalized as keyof typeof LAUNCH_MARKET.zipCentroids
    ];
  return point ?? null;
}

export function isLaunchEligibleAddress(input: {
  state: string | null | undefined;
  zip: string | null | undefined;
}): boolean {
  const state = input.state?.trim().toUpperCase();
  if (state !== LAUNCH_MARKET.state) return false;
  return originFromZip(input.zip) != null;
}

export function hasStructuredAddress(address: StructuredAddress): boolean {
  return Boolean(
    address.street?.trim() &&
      address.city?.trim() &&
      address.state?.trim() &&
      address.zip?.trim()
  );
}

export function launchAreaState(address: StructuredAddress): LaunchAreaState {
  if (!hasStructuredAddress(address)) return 'missing_address';
  return isLaunchEligibleAddress(address) ? 'eligible' : 'ineligible';
}

export function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function deriveDistanceMatch(args: {
  zip: string | null | undefined;
  distanceBand: string | null | undefined;
  restaurants: Array<{ lat: number | null; lon: number | null }>;
}): DistanceMatch | null {
  const origin = originFromZip(args.zip);
  const band = parseDistanceBand(args.distanceBand);
  if (!origin || !band) return null;
  const requestedMiles = milesForDistanceBand(band);
  const distances = args.restaurants.flatMap((r) => {
    const point = toGeoPoint(r.lat, r.lon);
    return point ? [haversineMiles(origin, point)] : [];
  });
  if (distances.length === 0) return null;
  const usedMiles = Math.max(...distances);
  return {
    requestedMiles,
    usedMiles,
    expanded: distances.some((miles) => miles > requestedMiles),
  };
}

export function distanceMatchCopy(match: DistanceMatch): string {
  const miles = match.expanded ? Math.ceil(match.usedMiles) : match.requestedMiles;
  const about = `about ${miles} miles of your ZIP area`;
  return match.expanded ? `Expanded to ${about}` : `Within ${about}`;
}
