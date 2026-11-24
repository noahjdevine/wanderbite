import { describe, expect, it } from 'vitest';
import { haversineMiles } from '@/lib/launch-market';
import { ACTIVITY_NOTE_WALKABLE_MILES } from '@/lib/activities/note-copy';
import {
  ACTIVITY_NOTE_CANDIDATE_CAP,
  ACTIVITY_NOTE_DESSERT_CAP,
  eligibleNoteActivities,
  type NoteSourceActivity,
  type NoteSourceRestaurant,
} from '@/lib/activities/note-eligible';

const NOW = new Date('2026-11-04T18:00:00.000Z');
const VERIFIED = '2026-11-02T18:00:00.000Z';

function restaurant(overrides: Partial<NoteSourceRestaurant> = {}): NoteSourceRestaurant {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Hutchins BBQ',
    cuisineTags: ['bbq'],
    lat: 33.1972,
    lon: -96.6156,
    ...overrides,
  };
}

function activity(overrides: Partial<NoteSourceActivity> = {}): NoteSourceActivity {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Chestnut Square Village',
    category: 'landmark',
    source_url: 'https://example.com/chestnut-square',
    lat: 33.198,
    lon: -96.616,
    valid_from: null,
    valid_until: null,
    last_verified_at: VERIFIED,
    status: 'active',
    is_sample: false,
    kids_oriented: false,
    cost_category: 'free',
    ...overrides,
  };
}

describe('eligible note activities', () => {
  it('keeps a nearby showing place and skips kids, paused, stale, and restaurant names', () => {
    const names = eligibleNoteActivities({
      restaurant: restaurant(),
      restaurantNames: ['Hutchins BBQ', 'North Grill'],
      now: NOW,
      activities: [
        activity(),
        activity({
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          name: 'Comedy Arena',
          category: 'comedy',
          lat: 33.21,
        }),
        activity({
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          name: 'Kids Museum',
          kids_oriented: true,
        }),
        activity({
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          name: 'Paused Hall',
          status: 'paused',
        }),
        activity({
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          name: 'Stale Walk',
          last_verified_at: '2026-09-01T18:00:00.000Z',
        }),
        activity({
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          name: 'North Grill',
        }),
        activity({
          id: '12121212-1212-4121-8121-121212121212',
          name: 'Far Landmark',
          lat: 33.5,
        }),
      ],
    }).map((row) => row.name);
    expect(names).toEqual(['Chestnut Square Village', 'Comedy Arena']);
  });

  it('keeps a far comedy ahead of extra dessert and caps dessert at two', () => {
    expect(ACTIVITY_NOTE_CANDIDATE_CAP).toBeGreaterThanOrEqual(10);
    expect(ACTIVITY_NOTE_CANDIDATE_CAP).toBeLessThanOrEqual(12);
    expect(ACTIVITY_NOTE_DESSERT_CAP).toBe(2);
    const rows = eligibleNoteActivities({
      restaurant: restaurant(),
      restaurantNames: ['Hutchins BBQ', 'North Grill'],
      now: NOW,
      activities: [
        at(0.2, 'Near Scoop', 'dessert'),
        at(0.4, 'Second Scoop', 'dessert'),
        at(0.8, 'Third Scoop', 'dessert'),
        at(1.2, 'Fourth Scoop', 'dessert'),
        at(4.2, 'The Comedy Arena', 'comedy'),
        at(3.8, 'Chestnut Square Village', 'landmark'),
        at(0.1, 'Kids Play', 'comedy', { kids_oriented: true }),
        at(0.1, 'Paused Hall', 'museum', { status: 'paused' }),
        at(0.1, 'Stale Walk', 'walk', { last_verified_at: '2026-09-01T18:00:00.000Z' }),
        at(0.1, 'North Grill', 'landmark'),
        at(6, 'Far Landmark', 'landmark'),
      ],
    });
    expect(rows.map((row) => row.name)).toEqual([
      'Chestnut Square Village',
      'The Comedy Arena',
      'Near Scoop',
      'Second Scoop',
    ]);
    expect(rows.filter((row) => row.category === 'dessert')).toHaveLength(ACTIVITY_NOTE_DESSERT_CAP);
    const origin = { lat: 33.1972, lon: -96.6156 };
    const comedy = rows.find((row) => row.name === 'The Comedy Arena');
    const scoop = rows.find((row) => row.name === 'Near Scoop');
    expect(comedy?.walkable).toBe(false);
    expect(scoop?.walkable).toBe(true);
    expect(scoop && haversineMiles(origin, { lat: latAtMiles(0.2), lon: origin.lon })).toBeLessThanOrEqual(
      ACTIVITY_NOTE_WALKABLE_MILES,
    );
  });

  it('spreads categories, then breaks ties by distance', () => {
    const categories = ['museum', 'walk', 'class', 'sports', 'arts', 'comedy', 'theater', 'live_music', 'games', 'landmark'] as const;
    const rows = eligibleNoteActivities({
      restaurant: restaurant(),
      restaurantNames: ['Hutchins BBQ'],
      now: NOW,
      activities: [
        ...categories.map((category, index) => at(4.4 + index * 0.01, `Far ${category}`, category)),
        ...Array.from({ length: 8 }, (_, index) => at(0.3 + index * 0.08, `Close Landmark ${index + 1}`, 'landmark')),
        at(0.15, 'Scoop A', 'dessert'),
        at(0.25, 'Scoop B', 'dessert'),
        at(0.35, 'Scoop C', 'dessert'),
        at(0.05, 'Kids Museum', 'museum', { kids_oriented: true }),
      ],
    });
    expect(rows).toHaveLength(ACTIVITY_NOTE_CANDIDATE_CAP);
    expect(rows.filter((row) => row.category === 'dessert').map((row) => row.name)).toEqual(['Scoop A', 'Scoop B']);
    expect(rows.some((row) => row.name === 'Far comedy')).toBe(true);
    expect(rows.some((row) => row.name === 'Close Landmark 8')).toBe(false);
    expect(rows.some((row) => row.name === 'Kids Museum')).toBe(false);
    expect(rows.findIndex((row) => row.category === 'dessert')).toBeGreaterThan(
      rows.findIndex((row) => row.category === 'comedy'),
    );
    const sharedLat = latAtMiles(1);
    const tied = eligibleNoteActivities({
      restaurant: restaurant(),
      restaurantNames: ['Hutchins BBQ'],
      now: NOW,
      activities: [
        activity({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Beta Walk', category: 'walk', lat: sharedLat, lon: -96.6156 }),
        activity({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Alpha Walk', category: 'walk', lat: sharedLat, lon: -96.6156 }),
      ],
    });
    expect(tied.map((row) => row.name)).toEqual(['Alpha Walk', 'Beta Walk']);
  });

  it('rounds miles and marks only a half mile or less as walkable', () => {
    const under = at(0.46, 'Close Walk', 'walk');
    const over = at(0.54, 'Farther Walk', 'walk');
    const rows = eligibleNoteActivities({
      restaurant: restaurant(),
      restaurantNames: ['Hutchins BBQ'],
      now: NOW,
      activities: [under, over],
    });
    const origin = { lat: 33.1972, lon: -96.6156 };
    for (const source of [under, over]) {
      const actual = haversineMiles(origin, { lat: source.lat ?? 0, lon: source.lon ?? 0 });
      const row = rows.find((item) => item.id === source.id);
      expect(row?.miles).toBe(Math.round(actual * 10) / 10);
      expect(row?.walkable).toBe(actual <= ACTIVITY_NOTE_WALKABLE_MILES);
    }
    expect(rows.find((row) => row.name === 'Close Walk')?.walkable).toBe(true);
    expect(rows.find((row) => row.name === 'Farther Walk')?.walkable).toBe(false);
    expect(rows.find((row) => row.name === 'Close Walk')?.miles).toBe(0.5);
    expect(rows.find((row) => row.name === 'Farther Walk')?.miles).toBe(0.5);
    const handel = eligibleNoteActivities({
      restaurant: restaurant(),
      restaurantNames: ['Hutchins BBQ'],
      now: NOW,
      activities: [activity({
        name: 'Handel\u2019s Homemade Ice Cream \u2013 McKinney',
        category: 'dessert',
      })],
    });
    expect(handel[0]?.name).toBe('Handel\u2019s Homemade Ice Cream \u2013 McKinney');
    expect(handel[0]?.displayName).toBe("Handel's Homemade Ice Cream");
  });
});

const ORIGIN_LAT = 33.1972;
const ORIGIN_LON = -96.6156;
let placeSeq = 0;

function latAtMiles(miles: number): number {
  let low = ORIGIN_LAT;
  let high = ORIGIN_LAT + 1;
  const origin = { lat: ORIGIN_LAT, lon: ORIGIN_LON };
  for (let step = 0; step < 50; step += 1) {
    const mid = (low + high) / 2;
    const found = haversineMiles(origin, { lat: mid, lon: ORIGIN_LON });
    if (found < miles) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function at(
  miles: number,
  name: string,
  category: string,
  overrides: Partial<NoteSourceActivity> = {},
): NoteSourceActivity {
  placeSeq += 1;
  return activity({
    id: `00000000-0000-4000-8000-${String(placeSeq).padStart(12, '0')}`,
    name,
    category,
    lat: latAtMiles(miles),
    lon: ORIGIN_LON,
    ...overrides,
  });
}
