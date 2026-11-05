import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BriefingRecord } from '@/lib/briefings/types';

const from = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from }),
}));

import { resetBriefingsLogs } from '@/lib/briefings/flag';
import { loadRestaurantBriefings } from '@/lib/briefings/load';

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
    }
  });
});
