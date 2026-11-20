import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BriefingRecord } from '@/lib/briefings/types';

const from = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from }),
}));

import { resetBriefingsLogs } from '@/lib/briefings/flag';
import { loadDiscoverBriefingFacts, loadRestaurantBriefings } from '@/lib/briefings/load';

const RESTAURANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function row(overrides: Partial<BriefingRecord> = {}): BriefingRecord {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    restaurant_id: RESTAURANT,
    field: 'parking',
    body: 'Sample note: the lot is behind the building.',
    source_url: 'https://example.com/e06-parking',
    last_verified_at: '2026-11-05T05:30:00.000Z',
    status: 'active',
    is_sample: true,
    version: 1,
    ...overrides,
  };
}

function query(result: { data: unknown; error: { code?: string; message?: string } | null }) {
  const calls: unknown[][] = [];
  const api = {
    calls,
    select: () => api,
    eq: (column: string, value: string) => {
      calls.push(['eq', column, value]);
      return api;
    },
    in: (column: string, value: readonly string[]) => {
      calls.push(['in', column, value]);
      return api;
    },
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

describe('loadRestaurantBriefings', () => {
  beforeEach(() => {
    from.mockReset();
    delete process.env.E06_BRIEFINGS_ENABLED;
    resetBriefingsLogs();
  });

  it('does not query when the flag is unset or any value other than true', async () => {
    const unset = await loadRestaurantBriefings({ restaurantIds: [RESTAURANT] });
    expect(unset.byRestaurantId).toEqual({});
    process.env.E06_BRIEFINGS_ENABLED = 'TRUE';
    const wrong = await loadRestaurantBriefings({ restaurantIds: [RESTAURANT] });
    expect(wrong.byRestaurantId).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it('does not query when the flag is on and there are no restaurants', async () => {
    process.env.E06_BRIEFINGS_ENABLED = 'true';
    const loaded = await loadRestaurantBriefings({ restaurantIds: [] });
    expect(loaded.byRestaurantId).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it('orders stored fields and drops paused, unknown, and non-https rows', async () => {
    const api = query({
      data: [
        row({
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          field: 'accessibility',
          body: 'A step-free entrance is marked on the sample page.',
        }),
        row(),
        row({
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          field: 'duration',
          body: 'A paused duration that must stay hidden.',
          status: 'paused',
        }),
        row({
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          field: 'offer',
          body: 'Not a briefing field.',
        }),
        row({
          id: 'abababab-abab-4aba-8aba-abababababab',
          field: 'arrival',
          body: 'Use the side door on the sample page.',
          source_url: 'http://example.com/e06-http',
        }),
        row({
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
          restaurant_id: OTHER,
          field: 'attire',
          body: 'Casual clothes are fine on the sample page.',
          is_sample: false,
        }),
        row({
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccd',
          field: 'vibe',
          body: 'The room is cozy and candlelit.',
        }),
        row({
          id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddde',
          field: 'known_for',
          body: 'Known for brisket and ribs.',
        }),
        row({
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef',
          field: 'good_for',
          body: 'Good for kids.',
        }),
        row({
          id: 'ffffffff-ffff-4fff-8fff-fffffffffff0',
          field: 'seating',
          body: 'Dogs are welcome on the patio.',
        }),
        row({
          id: '11111111-1111-4111-8111-111111111112',
          field: 'reservations',
          body: 'Walk-ins are welcome.',
        }),
      ],
      error: null,
    });
    from.mockImplementation((table: string) => {
      expect(table).toBe('restaurant_briefing_facts');
      return api;
    });
    process.env.E06_BRIEFINGS_ENABLED = 'true';
    const loaded = await loadRestaurantBriefings({ restaurantIds: [RESTAURANT, OTHER] });
    expect(from).toHaveBeenCalledTimes(1);
    expect(api.calls).toContainEqual(['eq', 'status', 'active']);
    expect(api.calls).toContainEqual(['in', 'restaurant_id', [RESTAURANT, OTHER]]);
    expect(loaded.byRestaurantId[RESTAURANT]?.map((fact) => fact.field)).toEqual([
      'parking',
      'accessibility',
    ]);
    expect(loaded.byRestaurantId[RESTAURANT]?.[0]?.sampleLabel).toBe('Sample');
    expect(loaded.byRestaurantId[RESTAURANT]?.[0]?.text).toBe(
      'Sample note: the lot is behind the building.',
    );
    expect(loaded.byRestaurantId[OTHER]?.map((fact) => fact.field)).toEqual(['attire']);
    expect(loaded.byRestaurantId[OTHER]?.[0]?.sampleLabel).toBeNull();
    const shown = JSON.stringify(loaded.byRestaurantId);
    expect(shown).not.toContain('cozy');
    expect(shown).not.toContain('brisket');
    expect(shown).not.toContain('Good for kids');
    expect(shown).not.toContain('patio');
    expect(shown).not.toContain('Walk-ins');
  });

  it('returns nothing when the table is missing', async () => {
    from.mockImplementation(() =>
      query({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }),
    );
    process.env.E06_BRIEFINGS_ENABLED = 'true';
    const loaded = await loadRestaurantBriefings({ restaurantIds: [RESTAURANT] });
    expect(loaded.byRestaurantId).toEqual({});
  });

  it('keeps the challenge page free of a model call', () => {
    const root = path.resolve(__dirname, '../../..');
    const files = [
      'src/lib/briefings/load.ts',
      'src/lib/briefings/flag.ts',
      'src/lib/briefings/types.ts',
      'src/components/briefings/first-visit.tsx',
      'src/app/(site)/challenges/page.tsx',
      'src/app/(site)/dashboard/page.tsx',
    ];
    for (const file of files) {
      const source = readFileSync(path.join(root, file), 'utf8');
      expect(source, file).not.toMatch(/api\.anthropic\.com/);
      expect(source, file).not.toMatch(/ANTHROPIC_API_KEY/);
      if (file !== 'src/lib/briefings/load.ts') {
        expect(source, file).not.toMatch(/loadDiscoverBriefingFacts/);
      }
    }
  });
});

describe('loadDiscoverBriefingFacts', () => {
  beforeEach(() => {
    from.mockReset();
    delete process.env.E06_BRIEFINGS_ENABLED;
    resetBriefingsLogs();
  });

  it('does not query when the flag is unset or any value other than true', async () => {
    const unset = await loadDiscoverBriefingFacts({ restaurantIds: [RESTAURANT] });
    expect(unset.byRestaurantId).toEqual({});
    process.env.E06_BRIEFINGS_ENABLED = 'TRUE';
    const wrong = await loadDiscoverBriefingFacts({ restaurantIds: [RESTAURANT] });
    expect(wrong.byRestaurantId).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it('does not query when the flag is on and there are no restaurants', async () => {
    process.env.E06_BRIEFINGS_ENABLED = 'true';
    const loaded = await loadDiscoverBriefingFacts({ restaurantIds: [] });
    expect(loaded.byRestaurantId).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it('returns pick fields and drops samples, paused rows, bad sources, and empty or overlong bodies', async () => {
    const keptVibe = 'The room is cozy and candlelit.';
    const keptKnown = 'K'.repeat(400);
    const keptSeating = 'Real patio chairs are outside.';
    const api = query({
      data: [
        row({
          id: '11111111-1111-4111-8111-111111111111',
          field: 'vibe',
          body: keptVibe,
          is_sample: false,
          version: 1,
        }),
        row({
          id: '11111111-1111-4111-8111-111111111112',
          field: 'vibe',
          body: 'A newer sample vibe that must not hide the real note.',
          is_sample: true,
          version: 3,
        }),
        row({
          id: '22222222-2222-4222-8222-222222222222',
          field: 'known_for',
          body: keptKnown,
          is_sample: false,
        }),
        row({
          id: '33333333-3333-4333-8333-333333333333',
          field: 'good_for',
          body: 'G'.repeat(401),
          is_sample: false,
        }),
        row({
          id: '44444444-4444-4444-8444-444444444444',
          field: 'seating',
          body: keptSeating,
          is_sample: false,
          version: 1,
        }),
        row({
          id: '44444444-4444-4444-8444-444444444445',
          field: 'seating',
          body: 'Sample patio that must stay hidden.',
          is_sample: true,
          version: 2,
        }),
        row({
          id: '55555555-5555-4555-8555-555555555555',
          field: 'reservations',
          body: 'Walk-ins are welcome.',
          is_sample: false,
        }),
        row({
          id: '66666666-6666-4666-8666-666666666666',
          field: 'parking',
          body: 'The lot is behind the building.',
          is_sample: false,
        }),
        row({
          id: '77777777-7777-4777-8777-777777777777',
          field: 'good_for',
          body: 'A paused note that must stay hidden.',
          status: 'paused',
          is_sample: false,
        }),
        row({
          id: '88888888-8888-4888-8888-888888888888',
          restaurant_id: OTHER,
          field: 'vibe',
          body: '   ',
          is_sample: false,
        }),
        row({
          id: '99999999-9999-4999-8999-999999999999',
          restaurant_id: OTHER,
          field: 'known_for',
          body: 'An unsourced note.',
          source_url: 'http://example.com/e06-http',
          is_sample: false,
        }),
        row({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
          restaurant_id: OTHER,
          field: 'seating',
          body: 'A note with no checked date.',
          last_verified_at: 'not-a-date',
          is_sample: false,
        }),
      ],
      error: null,
    });
    from.mockImplementation((table: string) => {
      expect(table).toBe('restaurant_briefing_facts');
      return api;
    });
    process.env.E06_BRIEFINGS_ENABLED = 'true';
    const loaded = await loadDiscoverBriefingFacts({ restaurantIds: [RESTAURANT, OTHER] });
    expect(from).toHaveBeenCalledTimes(1);
    expect(api.calls).toContainEqual(['eq', 'status', 'active']);
    expect(api.calls).toContainEqual(['in', 'restaurant_id', [RESTAURANT, OTHER]]);
    expect(loaded.byRestaurantId[RESTAURANT]?.map((fact) => fact.field)).toEqual([
      'vibe',
      'known_for',
      'seating',
    ]);
    expect(loaded.byRestaurantId[RESTAURANT]?.map((fact) => fact.text)).toEqual([
      keptVibe,
      keptKnown,
      keptSeating,
    ]);
    expect(loaded.byRestaurantId[RESTAURANT]?.every((fact) => fact.sampleLabel === null)).toBe(true);
    expect(loaded.byRestaurantId[OTHER]).toBeUndefined();
    const shown = JSON.stringify(loaded.byRestaurantId);
    expect(shown).not.toContain('newer sample vibe');
    expect(shown).not.toContain('Sample patio');
    expect(shown).not.toContain('paused note');
    expect(shown).not.toContain('Walk-ins');
    expect(shown).not.toContain('behind the building');
    expect(shown).not.toContain('unsourced');
    expect(shown).not.toContain('no checked date');
    expect(shown).not.toContain('G'.repeat(401));
  });

  it('returns nothing when the read fails', async () => {
    from.mockImplementation(() =>
      query({ data: null, error: { message: 'boom' } }),
    );
    process.env.E06_BRIEFINGS_ENABLED = 'true';
    const loaded = await loadDiscoverBriefingFacts({ restaurantIds: [RESTAURANT] });
    expect(loaded.byRestaurantId).toEqual({});
  });
});
