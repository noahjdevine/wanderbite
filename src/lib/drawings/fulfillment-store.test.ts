import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FULFILLMENT_COST_CHECK, FULFILLMENT_NOTE_CHECK } from '@/lib/drawings/fulfillment';
import {
  FULFILLMENT_PAGE_SIZE,
  createFulfillments,
  listFulfillments,
  transitionFulfillment,
  type FulfillmentStoreClient,
} from '@/lib/drawings/fulfillment-store';

const ROOT = path.resolve(__dirname, '../../..');
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const SELECTION_ID = '33333333-3333-4333-8333-333333333333';
const PRIZE_ID = '22222222-2222-4222-8222-222222222222';
const FULFILLMENT_ID = '55555555-5555-4555-8555-555555555555';
const WINNER_ID = '44444444-4444-4444-8444-444444444444';
const BEFORE_Q1 = '2027-01-01T05:59:59.000Z';
const AFTER_Q1 = '2027-01-01T00:00:01.000-06:00';

function selectionRow() {
  return { id: SELECTION_ID, simulated: true };
}

function fulfillmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FULFILLMENT_ID,
    winner_id: WINNER_ID,
    selection_id: SELECTION_ID,
    campaign_id: CAMPAIGN_ID,
    prize_id: PRIZE_ID,
    status: 'pending',
    simulated: true,
    actual_cost_cents: null,
    created_at: '2027-03-20T18:00:01.000Z',
    updated_at: '2027-03-20T18:00:01.000Z',
    ...overrides,
  };
}

function client(options: {
  selection?: Record<string, unknown> | null;
  fulfillment?: Record<string, unknown> | null;
  fulfillments?: Record<string, unknown>[];
  rpcData?: unknown;
  rpcError?: { message: string; code?: string } | null;
  throwOnRpc?: boolean;
  throwOnRead?: boolean;
} = {}) {
  const calls: { fn: string; args: unknown }[] = [];
  const ranges: [number, number][] = [];
  const orders: string[] = [];
  const store = {
    async rpc(fn: string, args: unknown) {
      calls.push({ fn, args });
      if (options.throwOnRpc) throw new Error('down');
      if (options.rpcError) return { data: null, error: options.rpcError };
      return { data: options.rpcData ?? null, error: null };
    },
    from(table: string) {
      const rows =
        table === 'drawing_selections'
          ? options.selection === undefined
            ? [selectionRow()]
            : options.selection
              ? [options.selection]
              : []
          : options.fulfillments ??
            (options.fulfillment === undefined
              ? [fulfillmentRow()]
              : options.fulfillment
                ? [options.fulfillment]
                : []);
      if (options.throwOnRead) throw new Error('down');
      const orderedFor = (matched: typeof rows) => {
        const ordered = {
          order(column: string) {
            orders.push(column);
            return ordered;
          },
          range(from: number, to: number) {
            ranges.push([from, to]);
            return Promise.resolve({ data: matched.slice(from, to + 1), error: null });
          },
          then(
            onFulfilled: (value: { data: typeof matched; error: null }) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) {
            return Promise.resolve({ data: matched, error: null }).then(onFulfilled, onRejected);
          },
        };
        return ordered;
      };
      return {
        select() {
          return {
            eq(column: string, value: string) {
              const matched = rows.filter((row) => row[column] === value);
              return {
                maybeSingle: async () => ({ data: matched[0] ?? null, error: null }),
                order: (columnName: string) => orderedFor(matched).order(columnName),
              };
            },
          };
        },
      };
    },
  };
  return { store: store as FulfillmentStoreClient, calls, ranges, orders };
}

describe('createFulfillments', () => {
  it('calls the rpc after the selection exists and returns the pending rows', async () => {
    const row = fulfillmentRow();
    const { store, calls } = client({ rpcData: [row] });
    const result = await createFulfillments(SELECTION_ID, '  clerk  ', store);
    expect(calls).toEqual([
      {
        fn: 'create_drawing_fulfillments',
        args: { p_selection_id: SELECTION_ID, p_run_by: '  clerk  ' },
      },
    ]);
    expect(result).toEqual({
      ok: true,
      fulfillments: [
        {
          id: FULFILLMENT_ID,
          winnerId: WINNER_ID,
          selectionId: SELECTION_ID,
          campaignId: CAMPAIGN_ID,
          prizeId: PRIZE_ID,
          status: 'pending',
          simulated: true,
          actualCostCents: null,
          createdAt: '2027-03-20T18:00:01.000Z',
          updatedAt: '2027-03-20T18:00:01.000Z',
        },
      ],
    });
  });

  it('does not call the rpc when the selection is missing or the label is blank', async () => {
    const missing = client({ selection: null, rpcData: [fulfillmentRow()] });
    expect(await createFulfillments(SELECTION_ID, '   ', missing.store)).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(missing.calls).toEqual([]);

    const blank = client({ rpcData: [fulfillmentRow()] });
    expect(await createFulfillments(SELECTION_ID, '   ', blank.store)).toEqual({
      ok: false,
      error: 'invalid_run_by',
    });
    expect(blank.calls).toEqual([]);
  });

  it('maps the database codes and a thrown client', async () => {
    const notFound = client({ rpcError: { message: 'not_found', code: 'P0002' } });
    expect(await createFulfillments(SELECTION_ID, 'clerk', notFound.store)).toEqual({
      ok: false,
      error: 'not_found',
    });
    const invalid = client({ rpcError: { message: 'invalid_run_by', code: 'P0001' } });
    expect(await createFulfillments(SELECTION_ID, 'clerk', invalid.store)).toEqual({
      ok: false,
      error: 'invalid_run_by',
    });
    const thrown = client({ throwOnRpc: true });
    expect(await createFulfillments(SELECTION_ID, 'clerk', thrown.store)).toEqual({
      ok: false,
      error: 'unavailable',
    });
    const unread = client({ throwOnRead: true });
    expect(await createFulfillments(SELECTION_ID, 'clerk', unread.store)).toEqual({
      ok: false,
      error: 'unavailable',
    });
  });
});

describe('transitionFulfillment', () => {
  it('moves pending to ready and ready to fulfilled with the cost', async () => {
    const ready = client({
      rpcData: fulfillmentRow({ status: 'ready', updated_at: '2027-03-20T18:00:02.000Z' }),
    });
    const moved = await transitionFulfillment(FULFILLMENT_ID, 'ready', '  lead  ', { note: '  packed  ' }, ready.store);
    expect(ready.calls).toEqual([
      {
        fn: 'transition_drawing_fulfillment',
        args: {
          p_fulfillment_id: FULFILLMENT_ID,
          p_to_status: 'ready',
          p_actor: '  lead  ',
          p_note: '  packed  ',
          p_actual_cost_cents: null,
        },
      },
    ]);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.fulfillment.status).toBe('ready');

    const fulfilled = client({
      fulfillment: fulfillmentRow({ status: 'ready' }),
      rpcData: fulfillmentRow({
        status: 'fulfilled',
        actual_cost_cents: 2500,
        updated_at: '2027-03-20T18:00:03.000Z',
      }),
    });
    const done = await transitionFulfillment(
      FULFILLMENT_ID,
      'fulfilled',
      'lead',
      { note: 'sent', actualCostCents: 2500 },
      fulfilled.store,
    );
    expect(fulfilled.calls[0]).toMatchObject({
      fn: 'transition_drawing_fulfillment',
      args: {
        p_to_status: 'fulfilled',
        p_note: 'sent',
        p_actual_cost_cents: 2500,
      },
    });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.fulfillment.actualCostCents).toBe(2500);
    expect(done.fulfillment.status).toBe('fulfilled');
  });

  it('runs the pure check before the rpc', async () => {
    const cases: {
      status: string;
      to: string;
      cost?: number | null;
      note?: string;
      actor?: string;
      error: string;
    }[] = [
      { status: 'pending', to: 'fulfilled', cost: 2500, error: 'invalid_transition' },
      { status: 'fulfilled', to: 'forfeited', error: 'invalid_transition' },
      { status: 'forfeited', to: 'ready', cost: 1, error: 'invalid_transition' },
      { status: 'ready', to: 'fulfilled', cost: null, error: 'cost_required' },
      { status: 'pending', to: 'ready', cost: 0, error: 'cost_not_allowed' },
      { status: 'pending', to: 'ready', cost: -1, error: 'cost_not_allowed' },
      { status: 'ready', to: 'fulfilled', cost: -1, error: FULFILLMENT_COST_CHECK },
      { status: 'ready', to: 'fulfilled', cost: 1.5, error: FULFILLMENT_COST_CHECK },
      { status: 'pending', to: 'ready', note: 'n'.repeat(501), error: FULFILLMENT_NOTE_CHECK },
    ];
    for (const item of cases) {
      const { store, calls } = client({
        fulfillment: fulfillmentRow({ status: item.status }),
        rpcData: fulfillmentRow({ status: item.to }),
      });
      const result = await transitionFulfillment(FULFILLMENT_ID, item.to, item.actor ?? 'lead', {
        note: item.note,
        actualCostCents: item.cost,
      }, store);
      expect(result, `${item.status} -> ${item.to}`).toEqual({ ok: false, error: item.error });
      expect(calls, `${item.status} -> ${item.to}`).toEqual([]);
    }
  });

  it('returns not_found and invalid_actor without calling the rpc', async () => {
    const missing = client({ fulfillment: null });
    expect(await transitionFulfillment(FULFILLMENT_ID, 'ready', '   ', {}, missing.store)).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(missing.calls).toEqual([]);
    const blank = client();
    expect(await transitionFulfillment(FULFILLMENT_ID, 'ready', '   ', {}, blank.store)).toEqual({
      ok: false,
      error: 'invalid_actor',
    });
    expect(blank.calls).toEqual([]);
  });

  it('returns the database invalid_transition when the row moved first', async () => {
    const { store, calls } = client({
      rpcError: { message: 'invalid_transition', code: 'P0001' },
    });
    expect(await transitionFulfillment(FULFILLMENT_ID, 'ready', 'lead', {}, store)).toEqual({
      ok: false,
      error: 'invalid_transition',
    });
    expect(calls).toHaveLength(1);
  });

  it('maps a check failure the pure check did not see, and a thrown client', async () => {
    const checked = client({
      fulfillment: fulfillmentRow({ status: 'ready' }),
      rpcError: {
        message: 'new row violates check constraint "drawing_fulfillments_actual_cost_cents_check"',
        code: '23514',
      },
    });
    expect(
      await transitionFulfillment(FULFILLMENT_ID, 'fulfilled', 'lead', { actualCostCents: 2500 }, checked.store),
    ).toEqual({ ok: false, error: FULFILLMENT_COST_CHECK });
    const thrown = client({ throwOnRpc: true });
    expect(await transitionFulfillment(FULFILLMENT_ID, 'ready', 'lead', {}, thrown.store)).toEqual({
      ok: false,
      error: 'unavailable',
    });
  });
});

describe('listFulfillments', () => {
  it('pages 1001 rows at 1000 and keeps campaign scope', async () => {
    const fulfillments = Array.from({ length: FULFILLMENT_PAGE_SIZE + 1 }, (_, index) =>
      fulfillmentRow({
        id: `55555555-5555-4555-8555-${String(index).padStart(12, '0')}`,
        winner_id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
        created_at: new Date(Date.UTC(2027, 0, 1, 0, 0, index)).toISOString(),
        updated_at: new Date(Date.UTC(2027, 0, 1, 0, 0, index)).toISOString(),
      }),
    );
    const { store, ranges, orders } = client({ fulfillments });
    const result = await listFulfillments(CAMPAIGN_ID, store);
    expect(orders).toEqual(['created_at', 'id', 'created_at', 'id']);
    expect(ranges).toEqual([
      [0, FULFILLMENT_PAGE_SIZE - 1],
      [FULFILLMENT_PAGE_SIZE, FULFILLMENT_PAGE_SIZE * 2 - 1],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fulfillments).toHaveLength(FULFILLMENT_PAGE_SIZE + 1);
    expect(result.fulfillments[0].id.endsWith('000000000000')).toBe(true);
    expect(result.fulfillments.at(-1)?.id.endsWith('000000001000')).toBe(true);
  });

  it('orders a pair that straddles 2027-01-01T06:00:00.000Z by instant, then id', async () => {
    const { store } = client({
      fulfillments: [
        fulfillmentRow({
          id: '55555555-5555-4555-8555-000000000002',
          winner_id: '44444444-4444-4444-8444-000000000002',
          created_at: AFTER_Q1,
        }),
        fulfillmentRow({
          id: '55555555-5555-4555-8555-000000000001',
          winner_id: '44444444-4444-4444-8444-000000000001',
          created_at: BEFORE_Q1,
        }),
        fulfillmentRow({
          id: '55555555-5555-4555-8555-00000000000b',
          winner_id: '44444444-4444-4444-8444-00000000000b',
          created_at: '2027-01-01T00:00:00.000-06:00',
        }),
        fulfillmentRow({
          id: '55555555-5555-4555-8555-00000000000a',
          winner_id: '44444444-4444-4444-8444-00000000000a',
          created_at: '2027-01-01T06:00:00.000Z',
        }),
      ],
    });
    const result = await listFulfillments(CAMPAIGN_ID, store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fulfillments.map((row) => row.id.slice(-1))).toEqual(['1', 'a', 'b', '2']);
  });

  it('returns an empty list and unavailable when the read fails', async () => {
    const empty = client({ fulfillments: [] });
    expect(await listFulfillments(CAMPAIGN_ID, empty.store)).toEqual({ ok: true, fulfillments: [] });
    expect(empty.ranges).toEqual([[0, FULFILLMENT_PAGE_SIZE - 1]]);
    const thrown = client({ throwOnRead: true });
    expect(await listFulfillments(CAMPAIGN_ID, thrown.store)).toEqual({ ok: false, error: 'unavailable' });
  });
});

describe('fulfillment store boundaries under TZ=UTC and TZ=America/Chicago', () => {
  it('keeps instant order, the blocked jump, and the cost total in both process time zones', () => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const probe = 'src/lib/drawings/fulfillment-store.tz-probe.ts';
    const run = (tz: string) => {
      const result = spawnSync(tsx, [probe], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, TZ: tz },
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as {
        order: string[];
        compare: number;
        transition: { ok: boolean; error?: string };
        summary: { totalActualCostCents: number; counts: { fulfilled: number; forfeited: number } };
      };
    };
    const utc = run('UTC');
    const chicago = run('America/Chicago');
    expect(chicago).toEqual(utc);
    expect(utc.order).toEqual(['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
    expect(utc.compare).toBe(-1);
    expect(utc.transition).toEqual({ ok: false, error: 'invalid_transition' });
    expect(utc.summary.totalActualCostCents).toBe(2500);
    expect(utc.summary.counts.fulfilled).toBe(1);
    expect(utc.summary.counts.forfeited).toBe(1);
  }, 20000);
});

describe('fulfillment module boundaries', () => {
  it('is server-only, uses the service-role client, and is not called from the app', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/drawings/fulfillment-store.ts'), 'utf8');
    expect(source.startsWith("import 'server-only';")).toBe(true);
    expect(source).toContain('getSupabaseAdmin');
    expect(source).not.toMatch(/resend|nodemailer|web-push|sendMail|notification/i);
    const skip = new Set([
      path.join(ROOT, 'src/lib/drawings/fulfillment-store.ts'),
      path.join(ROOT, 'src/lib/drawings/fulfillment-store.test.ts'),
      path.join(ROOT, 'src/lib/drawings/fulfillment-store.tz-probe.ts'),
      path.join(ROOT, 'src/lib/drawings/fulfillment.test.ts'),
    ]);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || skip.has(full)) continue;
        const text = readFileSync(full, 'utf8');
        if (
          text.includes("from '@/lib/drawings/fulfillment'") ||
          text.includes("from '@/lib/drawings/fulfillment-store'") ||
          text.includes("from './fulfillment-store'") ||
          text.includes('createFulfillments(') ||
          text.includes('transitionFulfillment(') ||
          text.includes('listFulfillments(')
        ) {
          hits.push(path.relative(ROOT, full));
        }
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(hits).toEqual([]);
  });
});
