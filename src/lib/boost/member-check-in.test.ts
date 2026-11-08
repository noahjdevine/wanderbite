import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MEMBER_CHECK_IN_MAX_ACCURACY_METERS,
  MEMBER_CHECK_IN_RADIUS_METERS,
  METERS_PER_MILE,
  assessMemberCheckIn,
} from '@/lib/boost/member-check-in';

const ROOT = path.resolve(__dirname, '../../..');
const NOW = new Date('2026-09-19T03:30:00.000Z');
const RESTAURANT = { lat: 33.1984, lon: -96.6397 };
const EARTH_RADIUS_MILES = 3958.7613;

function northOfRestaurant(meters: number): { lat: number; lon: number } {
  const miles = meters / METERS_PER_MILE;
  const delta = miles / ((EARTH_RADIUS_MILES * Math.PI) / 180);
  return { lat: RESTAURANT.lat + delta, lon: RESTAURANT.lon };
}

function reading(
  point: { lat: number; lon: number },
  extras: { accuracy?: unknown; timestamp?: unknown } = {},
) {
  return {
    lat: point.lat,
    lon: point.lon,
    accuracy: extras.accuracy === undefined ? 20 : extras.accuracy,
    timestamp: extras.timestamp === undefined ? NOW.getTime() : extras.timestamp,
  };
}

describe('member check-in geolocation', () => {
  it('accepts a fresh reading inside 100 meters with accuracy at the cap', () => {
    const edge = assessMemberCheckIn({
      member: reading(northOfRestaurant(100), { accuracy: MEMBER_CHECK_IN_MAX_ACCURACY_METERS }),
      restaurant: RESTAURANT,
      now: NOW,
    });
    expect(edge).toEqual({ ok: true });
    const inside = assessMemberCheckIn({
      member: reading(northOfRestaurant(99), { timestamp: NOW.getTime() - 59_000 }),
      restaurant: RESTAURANT,
      now: NOW,
    });
    expect(inside).toEqual({ ok: true });
  });

  it('refuses radius, staleness, accuracy, and missing pins without a distance band', () => {
    expect(
      assessMemberCheckIn({
        member: reading(northOfRestaurant(101)),
        restaurant: RESTAURANT,
        now: NOW,
      }),
    ).toEqual({ ok: false, code: 'out_of_radius' });
    expect(
      assessMemberCheckIn({
        member: reading(RESTAURANT, { timestamp: NOW.getTime() - 61_000 }),
        restaurant: RESTAURANT,
        now: NOW,
      }),
    ).toEqual({ ok: false, code: 'stale_location' });
    expect(
      assessMemberCheckIn({
        member: reading(RESTAURANT, { timestamp: NOW.getTime() + 6_000 }),
        restaurant: RESTAURANT,
        now: NOW,
      }),
    ).toEqual({ ok: false, code: 'stale_location' });
    expect(
      assessMemberCheckIn({
        member: reading(RESTAURANT, { accuracy: 100.1 }),
        restaurant: RESTAURANT,
        now: NOW,
      }),
    ).toEqual({ ok: false, code: 'poor_accuracy' });
    expect(
      assessMemberCheckIn({
        member: {
          lat: RESTAURANT.lat,
          lon: RESTAURANT.lon,
          accuracy: undefined,
          timestamp: NOW.getTime(),
        },
        restaurant: RESTAURANT,
        now: NOW,
      }),
    ).toEqual({ ok: false, code: 'missing_accuracy' });
    expect(
      assessMemberCheckIn({
        member: { lat: null, lon: null, accuracy: 10, timestamp: NOW.getTime() },
        restaurant: RESTAURANT,
        now: NOW,
      }),
    ).toEqual({ ok: false, code: 'missing_coords' });
    expect(
      assessMemberCheckIn({
        member: reading({ lat: 91, lon: 0 }),
        restaurant: RESTAURANT,
        now: NOW,
      }),
    ).toEqual({ ok: false, code: 'invalid_coordinates' });
    expect(
      assessMemberCheckIn({
        member: reading(RESTAURANT),
        restaurant: { lat: null, lon: RESTAURANT.lon },
        now: NOW,
      }),
    ).toEqual({ ok: false, code: 'restaurant_location_unavailable' });

    const source = readFileSync(path.join(ROOT, 'src/lib/boost/member-check-in.ts'), 'utf8');
    expect(source).not.toMatch(/distance_band|milesForDistanceBand/);
    expect(source).toMatch(/haversineMiles/);
    expect(MEMBER_CHECK_IN_RADIUS_METERS).toBe(100);
  });
});
