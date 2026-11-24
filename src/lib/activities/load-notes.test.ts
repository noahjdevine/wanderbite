import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from }),
}));

import { loadActivityNotes } from '@/lib/activities/load-notes';
import { resetActivitiesLogs } from '@/lib/activities/flag';

const RESTAURANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTIVITY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BODY =
  'After dinner, you could wander through Chestnut Square Village and let the meal settle while you walk. It is a small detour that keeps the night easy.';

function note(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    restaurant_id: RESTAURANT,
    body: BODY,
    status: 'approved',
    activity_ids: [ACTIVITY],
    is_sample: false,
    ...overrides,
  };
}

function activity(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTIVITY,
    status: 'active',
    is_sample: false,
    source_url: 'https://example.com/chestnut-square',
    valid_from: null,
    valid_until: null,
    last_verified_at: new Date().toISOString(),
    ...overrides,
  };
}

function query(result: { data: unknown; error: { code?: string; message?: string } | null }) {
  const api = {
    select: () => api,
    eq: () => api,
    in: () => api,
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(resolve(result)),
  };
  return api;
}

describe('loadActivityNotes', () => {
  beforeEach(() => {
    from.mockReset();
    delete process.env.E06_ACTIVITIES_ENABLED;
    delete process.env.E06_ACTIVITY_NOTES_ENABLED;
    resetActivitiesLogs();
  });

  it('does not query when either flag is off', async () => {
    process.env.E06_ACTIVITIES_ENABLED = 'true';
    const notesOff = await loadActivityNotes({ restaurantIds: [RESTAURANT] });
    process.env.E06_ACTIVITIES_ENABLED = 'TRUE';
    process.env.E06_ACTIVITY_NOTES_ENABLED = 'true';
    const activitiesOff = await loadActivityNotes({ restaurantIds: [RESTAURANT] });
    expect(notesOff.byRestaurantId).toEqual({});
    expect(activitiesOff.byRestaurantId).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it('returns an approved note whose cited activity is showing', async () => {
    process.env.E06_ACTIVITIES_ENABLED = 'true';
    process.env.E06_ACTIVITY_NOTES_ENABLED = 'true';
    from.mockImplementation((table: string) => {
      if (table === 'restaurant_activity_notes') return query({ data: [note()], error: null });
      return query({ data: [activity()], error: null });
    });
    const loaded = await loadActivityNotes({ restaurantIds: [RESTAURANT] });
    expect(from.mock.calls.map((call) => call[0])).toEqual(['restaurant_activity_notes', 'activities']);
    expect(loaded.byRestaurantId[RESTAURANT]).toBe(BODY);
  });

  it('returns nothing when the cited activity is paused or the table is missing', async () => {
    process.env.E06_ACTIVITIES_ENABLED = 'true';
    process.env.E06_ACTIVITY_NOTES_ENABLED = 'true';
    from.mockImplementation((table: string) => {
      if (table === 'restaurant_activity_notes') return query({ data: [note()], error: null });
      return query({ data: [], error: null });
    });
    const hidden = await loadActivityNotes({ restaurantIds: [RESTAURANT] });
    expect(hidden.byRestaurantId).toEqual({});
    from.mockImplementation(() => query({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }));
    const missing = await loadActivityNotes({ restaurantIds: [RESTAURANT] });
    expect(missing.byRestaurantId).toEqual({});
  });
});
