import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DELETED_MEMBER_LABEL,
  DRAWINGS_ADMIN_PAGE_SIZE,
  OVER_ALLOWANCE_NOTE,
  drawingRelationMissing,
  formatChicagoCalendarDate,
  formatDrawingDollars,
  loadDrawingsAdminView,
  summarizeDrawingsAdmin,
  type DrawingsAdminClient,
  type DrawingsAdminSource,
} from '@/lib/drawings/admin-read-model';

const CAMPAIGN_ID = 'c1111111-1111-4111-8111-111111111111';
const PRIZE_A = 'p1111111-1111-4111-8111-111111111111';
const PRIZE_B = 'p2222222-2222-4222-8222-222222222222';
const WINNER_1 = 'w1111111-1111-4111-8111-111111111111';
const WINNER_2 = 'w2222222-2222-4222-8222-222222222222';
const WINNER_3 = 'w3333333-3333-4333-8333-333333333333';
const USER_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_DELETED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SEED = 'ab'.repeat(32);
const MEMBER_EMAIL = 'member@example.com';
const SECRET_NOTE = 'do not show this note';

function sampleSource(allowance = 3_000): DrawingsAdminSource {
  return {
    campaign: {
      id: CAMPAIGN_ID,
      quarterKey: '2027-Q1',
      mode: 'sample',
      status: 'closed',
      totalBudgetCents: 20_000,
      fulfillmentAllowanceCents: allowance,
      activatedAt: '2026-12-15T18:00:00.000Z',
      closedAt: '2027-01-01T05:30:00.000Z',
      prizes: [
        { id: PRIZE_A, label: 'Sample prize: First', quantity: 1, unitValueCents: 5_000, position: 0 },
        { id: PRIZE_B, label: 'Dinner', quantity: 2, unitValueCents: 2_500, position: 1 },
      ],
    },
    selection: {
      seed: SEED,
      eligibleEntryCount: 4,
      unfilledUnitCount: 0,
      runBy: 'clerk',
      createdAt: '2027-01-02T18:00:00.000Z',
      winners: [
        { id: WINNER_3, rank: 3, prizeId: PRIZE_B, userId: USER_DELETED, unitIndex: 2 },
        { id: WINNER_1, rank: 1, prizeId: PRIZE_A, userId: USER_1, unitIndex: 1 },
        { id: WINNER_2, rank: 2, prizeId: PRIZE_B, userId: USER_2, unitIndex: 1 },
      ],
    },
    fulfillments: [
      { id: 'f1', winnerId: WINNER_1, prizeId: PRIZE_A, status: 'fulfilled', actualCostCents: 2_500 },
      { id: 'f2', winnerId: WINNER_2, prizeId: PRIZE_B, status: 'forfeited', actualCostCents: null },
      { id: 'f3', winnerId: WINNER_3, prizeId: PRIZE_B, status: 'pending', actualCostCents: null },
    ],
    events: [
      {
        id: 'e2',
        fulfillmentId: 'f1',
        toStatus: 'fulfilled',
        createdAt: '2027-01-03T18:00:00.000Z',
      },
      {
        id: 'e1',
        fulfillmentId: 'f3',
        toStatus: 'pending',
        createdAt: '2027-01-01T05:30:00.000Z',
      },
    ],
    profileIds: new Set([USER_1, USER_2]),
  };
}

describe('summarizeDrawingsAdmin', () => {
  it('formats the closed sample campaign, rank order, counts, and dollars', () => {
    const view = summarizeDrawingsAdmin(sampleSource());
    expect(view).not.toBeNull();
    if (!view) return;
    expect(view.mode).toBe('sample');
    expect(view.status).toBe('closed');
    expect(view.modeLabel).toBe('Sample');
    expect(view.statusLabel).toBe('Closed');
    expect(view.quarterKey).toBe('2027-Q1');
    expect(view.prizes.map((prize) => prize.label)).toEqual([
      'Sample prize: First',
      'Sample prize: Dinner',
    ]);
    expect(view.prizes.every((prize) => prize.label.startsWith('Sample prize'))).toBe(true);
    expect(view.budgetLabel).toBe('Committed $130.00 of $200.00');
    expect(view.closedOn).toBe('Dec 31, 2026');
    expect(view.activatedOn).toBe('Dec 15, 2026');
    expect(view.selection).toMatchObject({
      seedPreview: 'abababab…',
      eligibleEntryCount: 4,
      unfilledUnitCount: 0,
      runBy: 'clerk',
      ranOn: 'Jan 2, 2027',
    });
    expect(view.winners.map((winner) => winner.rank)).toEqual([1, 2, 3]);
    expect(view.winners.map((winner) => winner.memberLabel)).toEqual([
      'aaaaaaaa',
      'bbbbbbbb',
      DELETED_MEMBER_LABEL,
    ]);
    expect(view.winners.map((winner) => winner.fulfillmentLabel)).toEqual([
      'Fulfilled · $25.00',
      'Forfeited',
      'Pending',
    ]);
    expect(view.countsLabel).toBe('Pending 1 · Ready 0 · Fulfilled 1 · Forfeited 1');
    expect(view.costLabel).toBe('Recorded cost $25.00 · Allowance $30.00');
    expect(view.note).toBeNull();
    expect(view.events).toEqual([
      { on: 'Dec 31, 2026', label: 'Pending' },
      { on: 'Jan 3, 2027', label: 'Fulfilled' },
    ]);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(SEED);
    expect(serialized).not.toContain(USER_1);
    expect(serialized).not.toContain(USER_2);
    expect(serialized).not.toContain(USER_DELETED);
    expect(serialized).not.toContain(MEMBER_EMAIL);
    expect(serialized).not.toContain(SECRET_NOTE);
  });

  it('notes a recorded cost above the allowance and stays quiet when the cost is not above it', () => {
    const above = summarizeDrawingsAdmin(sampleSource(2_000));
    expect(above?.note).toBe(OVER_ALLOWANCE_NOTE);
    expect(above?.costLabel).toBe('Recorded cost $25.00 · Allowance $20.00');
    const equal = summarizeDrawingsAdmin(sampleSource(2_500));
    expect(equal?.note).toBeNull();
    expect(equal?.costLabel).toBe('Recorded cost $25.00 · Allowance $25.00');
  });

  it('keeps a live label unchanged and does not prefix Sample prize', () => {
    const source = sampleSource();
    source.campaign.mode = 'live';
    source.campaign.prizes = [
      { id: PRIZE_A, label: 'Dinner', quantity: 1, unitValueCents: 5_000, position: 0 },
    ];
    const view = summarizeDrawingsAdmin(source);
    expect(view?.modeLabel).toBe('Live');
    expect(view?.prizes[0]?.label).toBe('Dinner');
    expect(JSON.stringify(view)).not.toMatch(/live promotion/i);
  });

  it('formats Chicago calendar dates and dollars without using the process zone', () => {
    expect(formatChicagoCalendarDate('2027-01-01T05:30:00.000Z')).toBe('Dec 31, 2026');
    expect(formatChicagoCalendarDate('2027-01-01T06:00:00.000Z')).toBe('Jan 1, 2027');
    expect(formatChicagoCalendarDate(null)).toBeNull();
    expect(formatChicagoCalendarDate('not-a-date')).toBeNull();
    expect(formatDrawingDollars(2_500)).toBe('$25.00');
    expect(formatDrawingDollars(0)).toBe('$0.00');
    expect(formatDrawingDollars(130_00)).toBe('$130.00');
    expect(formatDrawingDollars(100_000)).toBe('$1,000.00');
  });
});

describe('drawingRelationMissing', () => {
  it('matches a missing table or column and ignores a permission error', () => {
    expect(drawingRelationMissing({ code: '42P01', message: 'relation "drawing_campaigns" does not exist' })).toBe(
      true,
    );
    expect(
      drawingRelationMissing({
        code: 'PGRST205',
        message: "Could not find the table 'public.drawing_campaigns' in the schema cache",
      }),
    ).toBe(true);
    expect(drawingRelationMissing({ code: '42703', message: 'column activated_at does not exist' })).toBe(true);
    expect(drawingRelationMissing({ code: 'PGRST204', message: 'schema cache' })).toBe(true);
    expect(
      drawingRelationMissing({
        message: "Could not find the table 'public.drawing_selections' in the schema cache",
      }),
    ).toBe(true);
    expect(drawingRelationMissing({ code: '42501', message: 'permission denied for table drawing_campaigns' })).toBe(
      false,
    );
    expect(drawingRelationMissing(null)).toBe(false);
    expect(drawingRelationMissing({ message: 'network down' })).toBe(false);
  });
});

type StoredCall = {
  table: string;
  select: string;
  range: [number, number];
  inValues: string[] | null;
};

function fakeClient(
  handler: (call: StoredCall) => { data: unknown; error: { code?: string; message: string } | null },
): { client: DrawingsAdminClient; calls: StoredCall[] } {
  const calls: StoredCall[] = [];
  const client: DrawingsAdminClient = {
    from(table) {
      const current: StoredCall = { table, select: '', range: [0, 0], inValues: null };
      const filter = {
        eq() {
          return filter;
        },
        in(_column: string, values: readonly string[]) {
          current.inValues = [...values];
          return filter;
        },
        order() {
          return filter;
        },
        range(from: number, to: number) {
          const call: StoredCall = {
            table: current.table,
            select: current.select,
            range: [from, to],
            inValues: current.inValues ? [...current.inValues] : null,
          };
          calls.push(call);
          return Promise.resolve(handler(call));
        },
      };
      return {
        select(columns: string) {
          current.select = columns;
          return filter;
        },
      };
    },
  };
  return { client, calls };
}

const campaignRow = {
  id: CAMPAIGN_ID,
  quarter_key: '2027-Q1',
  mode: 'sample',
  status: 'closed',
  total_budget_cents: 20_000,
  fulfillment_allowance_cents: 3_000,
  activated_at: '2026-12-15T18:00:00.000Z',
  closed_at: '2027-01-01T05:30:00.000Z',
};

const prizeRows = [
  {
    id: PRIZE_A,
    campaign_id: CAMPAIGN_ID,
    label: 'Sample prize: First',
    quantity: 1,
    unit_value_cents: 5_000,
    position: 0,
  },
  {
    id: PRIZE_B,
    campaign_id: CAMPAIGN_ID,
    label: 'Dinner',
    quantity: 2,
    unit_value_cents: 2_500,
    position: 1,
  },
];

describe('loadDrawingsAdminView', () => {
  it('returns not_set_up for a missing campaigns table and does not read selections or fulfillments', async () => {
    for (const error of [
      { code: 'PGRST205', message: "Could not find the table 'public.drawing_campaigns' in the schema cache" },
      { code: '42P01', message: 'relation "public.drawing_campaigns" does not exist' },
    ]) {
      const loadSelection = vi.fn();
      const loadFulfillments = vi.fn();
      const { client, calls } = fakeClient(() => ({ data: null, error }));
      await expect(
        loadDrawingsAdminView({ client, loadSelection, loadFulfillments }),
      ).resolves.toEqual({ ok: false, reason: 'not_set_up' });
      expect(loadSelection).not.toHaveBeenCalled();
      expect(loadFulfillments).not.toHaveBeenCalled();
      expect(calls.map((call) => call.table)).toEqual(['drawing_campaigns']);
    }
  });

  it('returns unavailable for a permission error and does not call it not set up', async () => {
    const { client } = fakeClient(() => ({
      data: null,
      error: { code: '42501', message: 'permission denied for table drawing_campaigns' },
    }));
    await expect(loadDrawingsAdminView({ client, loadSelection: vi.fn(), loadFulfillments: vi.fn() })).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('returns an empty list without reading prizes when no campaign is stored', async () => {
    const loadSelection = vi.fn();
    const { client, calls } = fakeClient(() => ({ data: [], error: null }));
    await expect(loadDrawingsAdminView({ client, loadSelection, loadFulfillments: vi.fn() })).resolves.toEqual({
      ok: true,
      campaigns: [],
    });
    expect(calls.map((call) => call.table)).toEqual(['drawing_campaigns']);
    expect(loadSelection).not.toHaveBeenCalled();
  });

  it('pages the campaign read and stops before a selection read when a row will not parse', async () => {
    const loadSelection = vi.fn();
    const { client, calls } = fakeClient((call) => {
      if (call.range[0] === 0) {
        return { data: Array.from({ length: DRAWINGS_ADMIN_PAGE_SIZE }, () => ({})), error: null };
      }
      return { data: [{}], error: null };
    });
    await expect(loadDrawingsAdminView({ client, loadSelection, loadFulfillments: vi.fn() })).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(calls.map((call) => call.range)).toEqual([
      [0, DRAWINGS_ADMIN_PAGE_SIZE - 1],
      [DRAWINGS_ADMIN_PAGE_SIZE, DRAWINGS_ADMIN_PAGE_SIZE * 2 - 1],
    ]);
    expect(loadSelection).not.toHaveBeenCalled();
  });

  it('loads the sample campaign and drops emails, the full seed, notes, and full member ids', async () => {
    const loadSelection = vi.fn(async () => ({
      ok: true as const,
      selection: {
        seed: SEED,
        eligibleEntryCount: 4,
        unfilledUnitCount: 0,
        runBy: 'clerk',
        createdAt: '2027-01-02T18:00:00.000Z',
        email: MEMBER_EMAIL,
        winners: [
          { id: WINNER_3, rank: 3, prizeId: PRIZE_B, userId: USER_DELETED, unitIndex: 2 },
          { id: WINNER_1, rank: 1, prizeId: PRIZE_A, userId: USER_1, unitIndex: 1 },
          { id: WINNER_2, rank: 2, prizeId: PRIZE_B, userId: USER_2, unitIndex: 1 },
        ],
      },
    }));
    const loadFulfillments = vi.fn(async () => ({
      ok: true as const,
      fulfillments: sampleSource().fulfillments,
    }));
    const { client, calls } = fakeClient((call) => {
      if (call.table === 'drawing_campaigns') return { data: [campaignRow], error: null };
      if (call.table === 'drawing_campaign_prizes') return { data: prizeRows, error: null };
      if (call.table === 'drawing_fulfillment_events') {
        return {
          data: [
            {
              id: 'e1',
              fulfillment_id: 'f3',
              to_status: 'pending',
              created_at: '2027-01-01T05:30:00.000Z',
              note: SECRET_NOTE,
              actor: 'clerk',
            },
          ],
          error: null,
        };
      }
      if (call.table === 'user_profiles') {
        return {
          data: [
            { id: USER_1, email: MEMBER_EMAIL },
            { id: USER_2, email: 'second@example.com' },
          ],
          error: null,
        };
      }
      throw new Error(`unexpected ${call.table}`);
    });
    const view = await loadDrawingsAdminView({ client, loadSelection, loadFulfillments });
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.campaigns).toHaveLength(1);
    expect(view.campaigns[0]?.countsLabel).toBe('Pending 1 · Ready 0 · Fulfilled 1 · Forfeited 1');
    expect(view.campaigns[0]?.winners[2]?.memberLabel).toBe(DELETED_MEMBER_LABEL);
    expect(view.campaigns[0]?.closedOn).toBe('Dec 31, 2026');
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(SEED);
    expect(serialized).not.toContain(USER_1);
    expect(serialized).not.toContain(USER_DELETED);
    expect(serialized).not.toContain(MEMBER_EMAIL);
    expect(serialized).not.toContain('second@example.com');
    expect(serialized).not.toContain(SECRET_NOTE);
    expect(calls.find((call) => call.table === 'user_profiles')?.select).toBe('id');
    expect(calls.find((call) => call.table === 'drawing_fulfillment_events')?.select).toBe(
      'id, fulfillment_id, to_status, created_at',
    );
    expect(loadSelection).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(loadFulfillments).toHaveBeenCalledWith(CAMPAIGN_ID);
  });

  it('does not label every winner deleted when the profile read fails', async () => {
    const { client } = fakeClient((call) => {
      if (call.table === 'drawing_campaigns') return { data: [campaignRow], error: null };
      if (call.table === 'drawing_campaign_prizes') return { data: prizeRows, error: null };
      if (call.table === 'drawing_fulfillment_events') return { data: [], error: null };
      if (call.table === 'user_profiles') return { data: null, error: { message: 'network down' } };
      throw new Error(`unexpected ${call.table}`);
    });
    const view = await loadDrawingsAdminView({
      client,
      loadSelection: async () => ({
        ok: true,
        selection: {
          seed: SEED,
          eligibleEntryCount: 1,
          unfilledUnitCount: 0,
          runBy: 'clerk',
          createdAt: '2027-01-02T18:00:00.000Z',
          winners: [{ id: WINNER_1, rank: 1, prizeId: PRIZE_A, userId: USER_1, unitIndex: 1 }],
        },
      }),
      loadFulfillments: async () => ({ ok: true, fulfillments: [] }),
    });
    expect(view).toEqual({ ok: false, reason: 'unavailable' });
    expect(JSON.stringify(view)).not.toContain(DELETED_MEMBER_LABEL);
  });

  it('returns not_set_up when the selection table is missing after campaigns load', async () => {
    const { client, calls } = fakeClient((call) => {
      if (call.table === 'drawing_campaigns') return { data: [campaignRow], error: null };
      if (call.table === 'drawing_campaign_prizes') return { data: prizeRows, error: null };
      if (call.table === 'drawing_selections') {
        return {
          data: null,
          error: { code: 'PGRST205', message: "Could not find the table 'public.drawing_selections' in the schema cache" },
        };
      }
      throw new Error(`unexpected ${call.table}`);
    });
    await expect(
      loadDrawingsAdminView({
        client,
        loadSelection: async () => ({ ok: false, error: 'unavailable' }),
        loadFulfillments: async () => ({ ok: true, fulfillments: [] }),
      }),
    ).resolves.toEqual({ ok: false, reason: 'not_set_up' });
    expect(calls.some((call) => call.table === 'drawing_selections')).toBe(true);
  });
});

describe('admin drawings summary under TZ=UTC and TZ=America/Chicago', () => {
  it('keeps the Chicago calendar date, the cost, and the deleted-member label', () => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const probe = 'src/lib/drawings/admin-read-model.tz-probe.ts';
    const run = (tz: string) => {
      const result = spawnSync(tsx, [probe], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, TZ: tz },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain(SEED);
      expect(result.stdout).not.toContain(USER_DELETED);
      return JSON.parse(result.stdout) as {
        closedOn: string;
        viewClosedOn: string;
        eventOn: string;
        costLabel: string;
        note: string;
        expectedNote: string;
        member: string;
        seedPreview: string;
      };
    };
    const utc = run('UTC');
    const chicago = run('America/Chicago');
    expect(chicago).toEqual(utc);
    expect(utc.closedOn).toBe('Dec 31, 2026');
    expect(utc.viewClosedOn).toBe('Dec 31, 2026');
    expect(utc.eventOn).toBe('Dec 31, 2026');
    expect(utc.costLabel).toBe('Recorded cost $25.00 · Allowance $20.00');
    expect(utc.note).toBe(OVER_ALLOWANCE_NOTE);
    expect(utc.note).toBe(utc.expectedNote);
    expect(utc.member).toBe(DELETED_MEMBER_LABEL);
    expect(utc.seedPreview).toBe('abababab…');
  }, 20000);
});
