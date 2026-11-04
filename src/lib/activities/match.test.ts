import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { zipFromAddress } from '@/lib/catalog/import';
import {
  activityBoundMiles,
  chicagoCalendarDate,
  matchActivities,
  restaurantZip,
  shiftCalendarDate,
} from '@/lib/activities/match';
import {
  ACTIVITY_STALE_AFTER_MS,
  CHECK_HOURS_LABEL,
  type ActivityRecord,
  type ActivityRestaurant,
} from '@/lib/activities/types';

const NOW = new Date('2026-11-04T18:00:00.000Z');
const VERIFIED = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
const ORIGIN = { lat: 33.1972, lon: -96.6156 };

function activity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Sample Square Walk',
    category: 'walk',
    source_url: 'https://example.com/sample-square-walk',
    lat: 33.198,
    lon: -96.616,
    zip: '75069',
    typical_duration_minutes: 40,
    cost_category: 'free',
    hours_note: null,
    valid_from: null,
    valid_until: null,
    weather_dependent: false,
    booking_required: false,
    last_verified_at: VERIFIED,
    status: 'active',
    is_sample: true,
    version: 1,
    ...overrides,
  };
}

function place(overrides: Partial<ActivityRestaurant> = {}): ActivityRestaurant {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    lat: ORIGIN.lat,
    lon: ORIGIN.lon,
    address: '1 Sample St, McKinney, TX 75069',
    ...overrides,
  };
}

function match(activities: ActivityRecord[], restaurant = place(), distanceBand: string | null = '15_mi', now = NOW) {
  return matchActivities({
    restaurant,
    activities,
    distanceBand,
    now,
    nodeEnv: 'production',
  });
}

describe('activity matching', () => {
  it('reads a restaurant ZIP the same way as the catalog importer', () => {
    const address = '1301 N Tennessee St, McKinney, TX 75069';
    expect(restaurantZip(address)).toBe(zipFromAddress(address));
    expect(restaurantZip(address)).toBe('75069');
    expect(restaurantZip(null)).toBeNull();
  });

  it('uses the saved distance band and 15 miles when it is missing', () => {
    expect(activityBoundMiles('5_mi')).toBe(5);
    expect(activityBoundMiles('40_mi')).toBe(40);
    expect(activityBoundMiles(null)).toBe(15);
    expect(activityBoundMiles('worth_trip')).toBe(15);
  });

  it('returns at most two, closer coordinates first, then name and id', () => {
    const rows = [
      activity({ id: '00000000-0000-4000-8000-000000000003', name: 'Far Lot', lat: 33.25, lon: -96.616 }),
      activity({ id: '00000000-0000-4000-8000-000000000002', name: 'Near B', lat: 33.205, lon: -96.616 }),
      activity({ id: '00000000-0000-4000-8000-000000000001', name: 'Near A', lat: 33.198, lon: -96.616 }),
    ];
    const first = match(rows);
    const second = match([...rows].reverse());
    expect(first.map((row) => row.name)).toEqual(['Near A', 'Near B']);
    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));
    expect(first).toHaveLength(2);
  });

  it('keeps a coordinate match inside the band and drops one outside it', () => {
    const near = activity({ id: '00000000-0000-4000-8000-000000000011', name: 'Near', lat: 33.2 });
    const outside = activity({ id: '00000000-0000-4000-8000-000000000012', name: 'Outside', lat: 33.5 });
    expect(match([near, outside], place(), '5_mi').map((row) => row.name)).toEqual(['Near']);
    expect(match([outside], place(), '15_mi')).toEqual([]);
    expect(match([outside], place(), '40_mi').map((row) => row.name)).toEqual(['Outside']);
  });

  it('uses same ZIP then an adjacent launch ZIP and does not call that a drive', () => {
    const restaurant = place({ lat: null, lon: null, address: '1 Sample St, McKinney, TX 75069' });
    const rows = [
      activity({
        id: '00000000-0000-4000-8000-000000000021',
        name: 'Other City',
        lat: null,
        lon: null,
        zip: '90210',
      }),
      activity({
        id: '00000000-0000-4000-8000-000000000022',
        name: 'Adjacent Lot',
        lat: null,
        lon: null,
        zip: '75070',
      }),
      activity({
        id: '00000000-0000-4000-8000-000000000023',
        name: 'Same Lot',
        lat: null,
        lon: null,
        zip: '75069',
      }),
    ];
    const suggestions = match(rows, restaurant);
    expect(suggestions.map((row) => row.name)).toEqual(['Same Lot', 'Adjacent Lot']);
    expect(suggestions.every((row) => row.locationMethod === 'zip')).toBe(true);
    const copy = JSON.stringify(suggestions);
    expect(copy.toLowerCase()).not.toContain('drive');
    expect(copy.toLowerCase()).not.toContain('miles');
  });

  it('does not turn a far coordinate pair into a same-ZIP match', () => {
    const far = activity({ name: 'Far Same ZIP', lat: 34.2, lon: -96.616, zip: '75069' });
    expect(match([far], place(), '5_mi')).toEqual([]);
  });

  it('hides an event whose Chicago valid_until was yesterday, including 11:30 PM and 12:30 AM', () => {
    const evening = new Date('2026-11-05T05:30:00.000Z');
    const afterMidnight = new Date('2026-11-05T06:30:00.000Z');
    expect(chicagoCalendarDate(evening)).toBe('2026-11-04');
    expect(chicagoCalendarDate(afterMidnight)).toBe('2026-11-05');
    const yesterday = activity({
      id: '00000000-0000-4000-8000-000000000031',
      name: 'Ended',
      valid_until: '2026-11-03',
    });
    const throughEvening = activity({
      id: '00000000-0000-4000-8000-000000000032',
      name: 'Through evening',
      valid_until: '2026-11-04',
    });
    expect(match([yesterday, throughEvening], place(), '15_mi', evening).map((row) => row.name)).toEqual([
      'Through evening',
    ]);
    expect(match([yesterday, throughEvening], place(), '15_mi', afterMidnight)).toEqual([]);
    expect(match([activity({ valid_from: '2026-11-05' })], place(), '15_mi', evening)).toEqual([]);
    expect(match([activity({ valid_from: '2026-11-04', valid_until: '2026-11-04' })], place(), '15_mi', evening)).toHaveLength(1);
  });

  it('drops a stale verification, a missing verification, and a missing official URL', () => {
    const stale = activity({
      last_verified_at: new Date(NOW.getTime() - ACTIVITY_STALE_AFTER_MS - 1).toISOString(),
    });
    const exactly = activity({
      id: '00000000-0000-4000-8000-000000000041',
      name: 'Just fresh',
      last_verified_at: new Date(NOW.getTime() - ACTIVITY_STALE_AFTER_MS).toISOString(),
    });
    expect(match([stale])).toEqual([]);
    expect(match([exactly]).map((row) => row.name)).toEqual(['Just fresh']);
    expect(match([activity({ last_verified_at: null })])).toEqual([]);
    expect(match([activity({ source_url: null })])).toEqual([]);
    expect(match([activity({ source_url: 'http://example.com/sample' })])).toEqual([]);
  });

  it('shows unknown hours with the check-hours line and no clock time', () => {
    const [suggestion] = match([activity({ hours_note: null })]);
    expect(suggestion?.hoursKnown).toBe(false);
    expect(suggestion?.hoursLabel).toBe(CHECK_HOURS_LABEL);
    expect(suggestion?.hoursLabel).not.toMatch(/\d{1,2}:\d{2}/);
    const noted = match([activity({ hours_note: 'Afternoons on the sample listing' })])[0];
    expect(noted?.hoursKnown).toBe(true);
    expect(noted?.hoursLabel).toBe('Afternoons on the sample listing');
  });

  it('skips paused and expired rows and labels a sample only when asked', () => {
    expect(match([activity({ status: 'paused' })])).toEqual([]);
    expect(match([activity({ status: 'expired' })])).toEqual([]);
    expect(match([activity({ is_sample: true })])[0]?.sampleLabel).toBe('Sample');
    expect(match([activity({ is_sample: false })])[0]?.sampleLabel).toBeNull();
    const dev = matchActivities({
      restaurant: place(),
      activities: [activity({ is_sample: false })],
      distanceBand: '15_mi',
      now: NOW,
      nodeEnv: 'development',
    });
    expect(dev[0]?.sampleLabel).toBe('Sample');
  });

  it('shifts calendar dates without using the process time zone', () => {
    expect(shiftCalendarDate('2026-11-04', 14)).toBe('2026-11-18');
    expect(shiftCalendarDate('2026-11-04', -1)).toBe('2026-11-03');
  });
});

describe('activity dates under TZ=UTC and TZ=America/Chicago', () => {
  it('keeps the Chicago boundary identical in both process time zones', () => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const run = (tz: string) => {
      const result = spawnSync(tsx, ['src/lib/activities/match.tz-probe.ts'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, TZ: tz },
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as {
        eveningDate: string;
        morningDate: string;
        eveningIds: string[];
        morningIds: string[];
      };
    };
    const utc = run('UTC');
    const chicago = run('America/Chicago');
    expect(chicago).toEqual(utc);
    expect(utc.eveningDate).toBe('2026-11-04');
    expect(utc.morningDate).toBe('2026-11-05');
    expect(utc.eveningIds).toEqual(['through-evening']);
    expect(utc.morningIds).toEqual([]);
  }, 20000);
});
