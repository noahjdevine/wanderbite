import { describe, expect, it } from 'vitest';
import { eligibleNoteActivities, type NoteSourceActivity, type NoteSourceRestaurant } from '@/lib/activities/note-eligible';

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
});
