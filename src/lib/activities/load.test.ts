import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityRecord } from '@/lib/activities/types';

const from = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from }),
}));

import { loadActivitySuggestions } from '@/lib/activities/load';
import { resetActivitiesLogs } from '@/lib/activities/flag';

const RESTAURANT = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  lat: 33.1972,
  lon: -96.6156,
  address: '1 Sample St, McKinney, TX 75069',
};

function row(): ActivityRecord {
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
    weather_dependent: true,
    booking_required: false,
    last_verified_at: new Date().toISOString(),
    status: 'active',
    is_sample: true,
    version: 1,
  };
}

function query(result: { data: unknown; error: { code?: string; message?: string } | null }) {
  const api = {
    select: () => api,
    eq: () => api,
    then: (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      void reject;
      return Promise.resolve(resolve(result));
    },
  };
  return api;
}

describe('loadActivitySuggestions', () => {
  beforeEach(() => {
    from.mockReset();
    delete process.env.E06_ACTIVITIES_ENABLED;
    resetActivitiesLogs();
  });

  it('does not query when the flag is unset or any value other than true', async () => {
    const unset = await loadActivitySuggestions({
      restaurants: [RESTAURANT],
      distanceBand: '15_mi',
    });
    expect(unset.byRestaurantId).toEqual({});
    process.env.E06_ACTIVITIES_ENABLED = 'TRUE';
    const wrong = await loadActivitySuggestions({
      restaurants: [RESTAURANT],
      distanceBand: '15_mi',
    });
    expect(wrong.byRestaurantId).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it('queries active rows and returns at most the matched suggestions when the flag is on', async () => {
    from.mockImplementation((table: string) => {
      expect(table).toBe('activities');
      return query({ data: [row()], error: null });
    });
    process.env.E06_ACTIVITIES_ENABLED = 'true';
    const loaded = await loadActivitySuggestions({
      restaurants: [RESTAURANT],
      distanceBand: '15_mi',
    });
    expect(from).toHaveBeenCalledTimes(1);
    expect(loaded.byRestaurantId[RESTAURANT.id]?.map((item) => item.name)).toEqual([
      'Sample Square Walk',
    ]);
    expect(loaded.byRestaurantId[RESTAURANT.id]?.[0]?.hoursLabel).toBe('Check hours on their site');
  });

  it('returns nothing when the activities table is missing', async () => {
    from.mockImplementation(() =>
      query({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }),
    );
    process.env.E06_ACTIVITIES_ENABLED = 'true';
    const loaded = await loadActivitySuggestions({
      restaurants: [RESTAURANT],
      distanceBand: '15_mi',
    });
    expect(loaded.byRestaurantId).toEqual({});
  });
});
