import { haversineMiles, toGeoPoint } from '@/lib/launch-market';

/**
 * Noah 2026-11-07. No earlier radius constant exists in the repo.
 * Distance is haversine miles times the international mile, not a home distance band.
 * 3958.7613 miles * 1609.344 m/mile is the mean Earth radius used by haversineMiles.
 */
export const METERS_PER_MILE = 1609.344;
export const MEMBER_CHECK_IN_RADIUS_METERS = 100;
export const MEMBER_CHECK_IN_MAX_AGE_MS = 60_000;
export const MEMBER_CHECK_IN_MAX_ACCURACY_METERS = 100;
/** Phone clocks can sit a few seconds ahead of the server. */
export const MEMBER_CHECK_IN_FUTURE_SKEW_MS = 5_000;

export const MEMBER_GEO_REFUSAL_CODES = [
  'missing_coords',
  'invalid_coordinates',
  'restaurant_location_unavailable',
  'out_of_radius',
  'stale_location',
  'poor_accuracy',
  'missing_accuracy',
] as const;

export type MemberGeoRefusalCode = (typeof MEMBER_GEO_REFUSAL_CODES)[number];

export type MemberGeoResult = { ok: true } | { ok: false; code: MemberGeoRefusalCode };

export type MemberLocationReading = {
  lat: unknown;
  lon: unknown;
  accuracy: unknown;
  timestamp: unknown;
};

function present(value: unknown): boolean {
  return value != null && value !== '';
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

/**
 * Live geolocation gate. No database write.
 * Accuracy is required: a successful GeolocationPosition always carries
 * GeolocationCoordinates.accuracy in meters. Omission is missing_accuracy.
 * A finite accuracy above 100 meters is poor_accuracy.
 * First failure wins: restaurant pin, member coordinates, accuracy, freshness, radius.
 */
export function assessMemberCheckIn(input: {
  member: MemberLocationReading;
  restaurant: { lat: number | null; lon: number | null };
  now: Date;
}): MemberGeoResult {
  const restaurant = toGeoPoint(input.restaurant.lat, input.restaurant.lon);
  if (!restaurant) return { ok: false, code: 'restaurant_location_unavailable' };

  if (!present(input.member.lat) || !present(input.member.lon)) {
    return { ok: false, code: 'missing_coords' };
  }
  const memberLat = finiteNumber(input.member.lat);
  const memberLon = finiteNumber(input.member.lon);
  const member = memberLat == null || memberLon == null ? null : toGeoPoint(memberLat, memberLon);
  if (!member) return { ok: false, code: 'invalid_coordinates' };

  if (!present(input.member.accuracy)) return { ok: false, code: 'missing_accuracy' };
  const accuracy = finiteNumber(input.member.accuracy);
  if (accuracy == null || accuracy < 0) return { ok: false, code: 'missing_accuracy' };
  if (accuracy > MEMBER_CHECK_IN_MAX_ACCURACY_METERS) return { ok: false, code: 'poor_accuracy' };

  if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime())) {
    return { ok: false, code: 'stale_location' };
  }
  const timestamp = finiteNumber(input.member.timestamp);
  if (timestamp == null) return { ok: false, code: 'stale_location' };
  const ageMs = input.now.getTime() - timestamp;
  if (ageMs > MEMBER_CHECK_IN_MAX_AGE_MS || ageMs < -MEMBER_CHECK_IN_FUTURE_SKEW_MS) {
    return { ok: false, code: 'stale_location' };
  }

  const meters = haversineMiles(member, restaurant) * METERS_PER_MILE;
  if (meters > MEMBER_CHECK_IN_RADIUS_METERS) return { ok: false, code: 'out_of_radius' };
  return { ok: true };
}
