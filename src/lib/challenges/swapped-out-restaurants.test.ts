import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { getSupabaseAdmin } from '@/lib/supabase-admin';
import { loadSwappedOutRestaurantIds } from '@/lib/challenges/generate';

const GENERATE_SOURCE = readFileSync(
  path.join(__dirname, 'generate.ts'),
  'utf8',
);

type FilterCall = { op: 'in' | 'eq' | 'gte'; column: string; value: unknown };

function clientFor(rows: { restaurant_id: string }[]) {
  const filters: FilterCall[] = [];
  const selected: string[] = [];
  let fromCalls = 0;
  const supabase = {
    from(table: string) {
      fromCalls += 1;
      expect(table).toBe('challenge_items');
      const chain = {
        select(columns: string) {
          selected.push(columns);
          return chain;
        },
        in(column: string, value: readonly string[]) {
          filters.push({ op: 'in', column, value });
          return chain;
        },
        eq(column: string, value: string) {
          filters.push({ op: 'eq', column, value });
          return chain;
        },
        gte(column: string, value: string) {
          filters.push({ op: 'gte', column, value });
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
  };
  return {
    filters,
    selected,
    fromCalls: () => fromCalls,
    supabase: supabase as unknown as ReturnType<typeof getSupabaseAdmin>,
  };
}

describe('loadSwappedOutRestaurantIds', () => {
  it('filters swapped-out challenge items on assigned_at for the same cutoff', async () => {
    const sinceIso = '2026-08-03T16:01:00.000Z';
    const client = clientFor([
      { restaurant_id: 'rest-a' },
      { restaurant_id: 'rest-a' },
      { restaurant_id: 'rest-b' },
    ]);

    const ids = await loadSwappedOutRestaurantIds(
      client.supabase,
      ['cycle-1', 'cycle-2'],
      sinceIso,
    );

    expect(client.selected).toEqual(['restaurant_id']);
    expect(client.filters).toEqual([
      { op: 'in', column: 'cycle_id', value: ['cycle-1', 'cycle-2'] },
      { op: 'eq', column: 'status', value: 'swapped_out' },
      { op: 'gte', column: 'assigned_at', value: sinceIso },
    ]);
    expect(client.filters.some((filter) => filter.column === 'created_at')).toBe(false);
    expect([...ids]).toEqual(['rest-a', 'rest-b']);
  });

  it('does not query when the member has no cycles', async () => {
    const client = clientFor([]);
    const ids = await loadSwappedOutRestaurantIds(client.supabase, [], '2026-08-03T16:01:00.000Z');
    expect(ids.size).toBe(0);
    expect(client.fromCalls()).toBe(0);
  });

  it('is what the monthly pool uses for the three-month swap window', () => {
    expect(GENERATE_SOURCE).toContain(`const swappedOutRestaurantIds = await loadSwappedOutRestaurantIds(
      supabase,
      cycleIds,
      threeMonthsAgo.toISOString(),
    )`);
    expect(GENERATE_SOURCE).not.toContain(".gte('created_at', threeMonthsAgo");
    const helper = GENERATE_SOURCE.slice(
      GENERATE_SOURCE.indexOf('export async function loadSwappedOutRestaurantIds'),
      GENERATE_SOURCE.indexOf('export type MonthlyChallengePool'),
    );
    expect(helper).toContain(".gte('assigned_at', sinceIso)");
    expect(helper).not.toContain('created_at');
  });
});
