import { describe, expect, it } from 'vitest';
import type { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  CAPACITY_RESTAURANT_ID_CHUNK,
  chunkCapacityRestaurantIds,
  loadReservedCapacityCounts,
} from '@/lib/challenges/generate';

type ReservationRow = { id: string; restaurant_id: string; bucket_start: string };

function clientFor(args: {
  rows: ReservationRow[];
  failOnChunk?: number;
}) {
  const calls: string[][] = [];
  let chunkIndex = 0;
  const supabase = {
    from(table: string) {
      expect(table).toBe('capacity_reservations');
      const state: { ids: string[] } = { ids: [] };
      const chain = {
        select() {
          return chain;
        },
        in(column: string, values: string[]) {
          if (column === 'restaurant_id') state.ids = values;
          return chain;
        },
        order() {
          return chain;
        },
        range(from: number, to: number) {
          const ids = [...state.ids];
          calls.push(ids);
          const current = chunkIndex;
          chunkIndex += 1;
          if (args.failOnChunk === current) {
            return Promise.resolve({ data: null, error: { message: 'boom' } });
          }
          const matched = args.rows.filter((row) => ids.includes(row.restaurant_id));
          return Promise.resolve({ data: matched.slice(from, to + 1), error: null });
        },
      };
      return chain;
    },
  };
  return {
    calls,
    supabase: supabase as unknown as ReturnType<typeof getSupabaseAdmin>,
  };
}

describe('capacity reservation id chunks', () => {
  it('splits restaurant ids into chunks of 100', () => {
    const ids = Array.from({ length: 250 }, (_, index) => `rest-${index}`);
    const chunks = chunkCapacityRestaurantIds(ids);
    expect(CAPACITY_RESTAURANT_ID_CHUNK).toBe(100);
    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
    expect(chunks.flat()).toEqual(ids);
  });

  it('merges chunked reads and keeps the load_failed message on a chunk error', async () => {
    const ids = Array.from({ length: 150 }, (_, index) => `rest-${index}`);
    const rows: ReservationRow[] = [
      { id: 'a', restaurant_id: 'rest-0', bucket_start: '2026-06-01T00:00:00+00' },
      { id: 'b', restaurant_id: 'rest-0', bucket_start: '2026-06-01' },
      { id: 'c', restaurant_id: 'rest-120', bucket_start: '2026-07-01T00:00:00+00' },
    ];
    const happy = clientFor({ rows });
    const loaded = await loadReservedCapacityCounts(happy.supabase, ids, ['2026-06-01', '2026-07-01']);
    expect(happy.calls.map((call) => call.length)).toEqual([100, 50]);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.counts.get('rest-0')?.get('2026-06-01')).toBe(2);
    expect(loaded.counts.get('rest-120')?.get('2026-07-01')).toBe(1);

    const failing = clientFor({ rows, failOnChunk: 1 });
    const failed = await loadReservedCapacityCounts(failing.supabase, ids, ['2026-06-01']);
    expect(failed).toEqual({
      ok: false,
      message: 'Failed to load capacity reservations: boom',
    });
  });
});
