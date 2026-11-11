import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DRAWING_SELECTION_ALGORITHM,
  compareRanked,
  entryRankHex,
  selectWinners,
} from '@/lib/drawings/selection';
import {
  ENTRY_PAGE_SIZE,
  MILESTONE_IN_CHUNK,
  getSelection,
  runSimulatedSelection,
  verifySelection,
  type SelectionStoreClient,
} from '@/lib/drawings/selection-store';

const ROOT = path.resolve(__dirname, '../../..');
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const SELECTION_ID = '33333333-3333-4333-8333-333333333333';
const PRIZE_ID = '22222222-2222-4222-8222-222222222222';
const ENTRY_ID = 'a1000000-0000-4000-8000-000000000002';
const USER_ID = 'b1000000-0000-4000-8000-000000000002';
const SEED = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const CLOSED = '2027-03-20T18:00:00.000Z';

function campaignRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_ID,
    status: 'closed',
    mode: 'sample',
    quarter_key: '2027-Q1',
    eligible_entry_sources: ['level_milestone'],
    activated_at: '2027-01-02T15:00:00.000Z',
    closed_at: CLOSED,
    ...overrides,
  };
}

function selectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SELECTION_ID,
    campaign_id: CAMPAIGN_ID,
    algorithm_version: DRAWING_SELECTION_ALGORITHM,
    seed: SEED,
    eligible_entry_count: 1,
    eligible_member_count: 1,
    eligible_entry_ids: [ENTRY_ID],
    eligible_user_ids: [USER_ID],
    prize_unit_count: 1,
    unfilled_unit_count: 0,
    simulated: true,
    run_by: 'ops',
    created_at: '2027-03-20T18:00:01.000Z',
    ...overrides,
  };
}

function winnerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    selection_id: SELECTION_ID,
    campaign_id: CAMPAIGN_ID,
    prize_id: PRIZE_ID,
    unit_index: 1,
    entry_id: ENTRY_ID,
    user_id: USER_ID,
    rank: 1,
    created_at: '2027-03-20T18:00:01.000Z',
    ...overrides,
  };
}

function client(options: {
  campaign?: Record<string, unknown> | null;
  selection?: Record<string, unknown> | null;
  winners?: Record<string, unknown>[];
  prizes?: Record<string, unknown>[];
  entries?: Record<string, unknown>[];
  milestones?: Record<string, unknown>[];
  rpcData?: unknown;
  rpcError?: { message: string; code?: string } | null;
  throwOnRpc?: boolean;
  throwOnRead?: boolean;
  onRange?: (from: number, to: number) => void;
  onIn?: (values: readonly string[]) => void;
} = {}) {
  const calls: { p_campaign_id: string; p_run_by: string }[] = [];
  const store = {
    async rpc(_fn: 'select_drawing_winners', args: { p_campaign_id: string; p_run_by: string }) {
      calls.push(args);
      if (options.throwOnRpc) throw new Error('down');
      if (options.rpcError) return { data: null, error: options.rpcError };
      return { data: options.rpcData ?? null, error: null };
    },
    from(table: string) {
      const rows =
        table === 'drawing_campaigns'
          ? options.campaign === undefined
            ? [campaignRow()]
            : options.campaign
              ? [options.campaign]
              : []
          : table === 'drawing_selections'
            ? options.selection === undefined
              ? []
              : options.selection
                ? [options.selection]
                : []
            : table === 'drawing_selection_winners'
              ? (options.winners ?? [winnerRow()])
              : table === 'drawing_campaign_prizes'
                ? (options.prizes ?? [{ id: PRIZE_ID, campaign_id: CAMPAIGN_ID, position: 0, quantity: 1 }])
                : table === 'progression_drawing_entries'
                  ? (options.entries ?? [
                      {
                        id: ENTRY_ID,
                        user_id: USER_ID,
                        quarter_key: '2027-Q1',
                        entry_source: 'level_milestone',
                        milestone_id: 'milestone-1',
                      },
                    ])
                  : (options.milestones ?? [{ id: 'milestone-1', reached_at: '2027-02-01T06:00:00.000Z' }]);
      if (options.throwOnRead) {
        throw new Error('down');
      }
      const pageOf = (data: typeof rows) => ({ data, error: null });
      const ordered = () => ({
        then(onFulfilled: (value: { data: typeof rows; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve(pageOf(rows)).then(onFulfilled, onRejected);
        },
        range: async (from: number, to: number) => {
          options.onRange?.(from, to);
          return pageOf(rows.slice(from, to + 1));
        },
      });
      return {
        select() {
          return {
            eq: () => ({
              maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
              order: () => ordered(),
            }),
            in: async (_column: string, values: readonly string[]) => {
              options.onIn?.(values);
              const wanted = new Set(values);
              return pageOf(
                rows.filter((row) => {
                  const id = row.id;
                  return typeof id === 'string' && wanted.has(id);
                }),
              );
            },
          };
        },
      };
    },
  };
  return { store: store as SelectionStoreClient, calls };
}

const rpcPayload = {
  selection: selectionRow(),
  winners: [winnerRow()],
};

describe('runSimulatedSelection', () => {
  it('calls the rpc for a closed sample campaign and returns the simulated draw', async () => {
    const { store, calls } = client({ rpcData: rpcPayload });
    const result = await runSimulatedSelection(CAMPAIGN_ID, '  ops  ', store);
    expect(calls).toEqual([{ p_campaign_id: CAMPAIGN_ID, p_run_by: '  ops  ' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.simulated).toBe(true);
    expect(result.selection.seed).toBe(SEED);
    expect(result.selection.winners).toHaveLength(1);
    expect(result.selection.winners[0]).toMatchObject({
      entryId: ENTRY_ID,
      userId: USER_ID,
      prizeId: PRIZE_ID,
      unitIndex: 1,
      rank: 1,
    });
  });

  it('does not call the rpc when the campaign state rejects the draw', async () => {
    const cases: { campaign: Record<string, unknown>; error: string }[] = [
      { campaign: campaignRow({ status: 'draft', activated_at: null, closed_at: null }), error: 'campaign_not_closed' },
      { campaign: campaignRow({ status: 'active', closed_at: null }), error: 'campaign_not_closed' },
      { campaign: campaignRow({ status: 'closed', activated_at: null, closed_at: null }), error: 'campaign_not_closed' },
      { campaign: campaignRow({ status: 'closed', activated_at: null }), error: 'campaign_not_closed' },
      { campaign: campaignRow({ mode: 'live', status: 'draft', activated_at: null, closed_at: null }), error: 'live_selection_blocked' },
      { campaign: campaignRow({ mode: 'live' }), error: 'live_selection_blocked' },
    ];
    for (const item of cases) {
      const { store, calls } = client({ campaign: item.campaign, rpcData: rpcPayload });
      const result = await runSimulatedSelection(CAMPAIGN_ID, 'ops', store);
      expect(result).toEqual({ ok: false, error: item.error });
      expect(calls).toEqual([]);
    }
  });

  it('returns already_selected without calling the rpc when a draw exists', async () => {
    const { store, calls } = client({ selection: selectionRow(), rpcData: rpcPayload });
    const result = await runSimulatedSelection(CAMPAIGN_ID, 'ops', store);
    expect(result).toEqual({ ok: false, error: 'already_selected' });
    expect(calls).toEqual([]);
  });

  it('returns invalid_run_by after the campaign gate and does not call the rpc', async () => {
    const { store, calls } = client({ rpcData: rpcPayload });
    expect(await runSimulatedSelection(CAMPAIGN_ID, '   ', store)).toEqual({
      ok: false,
      error: 'invalid_run_by',
    });
    expect(calls).toEqual([]);
    const draft = client({
      campaign: campaignRow({ status: 'draft', activated_at: null, closed_at: null }),
    });
    expect(await runSimulatedSelection(CAMPAIGN_ID, '   ', draft.store)).toEqual({
      ok: false,
      error: 'campaign_not_closed',
    });
    expect(draft.calls).toEqual([]);
  });

  it('maps database codes, including a race that loses to already_selected', async () => {
    const codes = ['no_eligible_entries', 'already_selected', 'invalid_seed', 'not_found'] as const;
    for (const code of codes) {
      const { store } = client({
        rpcError: { message: code, code: code === 'not_found' ? 'P0002' : 'P0001' },
      });
      expect(await runSimulatedSelection(CAMPAIGN_ID, 'ops', store)).toEqual({ ok: false, error: code });
    }
  });

  it('returns not_found when the campaign row is missing and unavailable when the call throws', async () => {
    const missing = client({ campaign: null });
    expect(await runSimulatedSelection(CAMPAIGN_ID, 'ops', missing.store)).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(missing.calls).toEqual([]);
    const down = client({ throwOnRpc: true });
    expect(await runSimulatedSelection(CAMPAIGN_ID, 'ops', down.store)).toEqual({
      ok: false,
      error: 'unavailable',
    });
  });
});

describe('getSelection and verifySelection', () => {
  it('recomputes the stored seed and reports a match', async () => {
    const draw = selectWinners({
      seed: SEED,
      entries: [{ id: ENTRY_ID, userId: USER_ID }],
      prizes: [{ id: PRIZE_ID, position: 0, quantity: 1 }],
      algorithmVersion: DRAWING_SELECTION_ALGORITHM,
    });
    expect(draw.ok).toBe(true);
    if (!draw.ok) return;
    const { store } = client({
      selection: selectionRow({
        eligible_entry_count: draw.eligibleEntryCount,
        eligible_member_count: draw.eligibleMemberCount,
        prize_unit_count: draw.prizeUnitCount,
        unfilled_unit_count: draw.unfilledUnitCount,
      }),
      winners: [
        winnerRow({
          entry_id: draw.winners[0].entryId,
          user_id: draw.winners[0].userId,
          rank: draw.winners[0].rank,
        }),
      ],
      entries: [
        {
          id: ENTRY_ID,
          user_id: USER_ID,
          quarter_key: '2027-Q1',
          entry_source: 'level_milestone',
          milestone_id: 'milestone-1',
        },
        {
          id: 'late',
          user_id: 'other-user',
          quarter_key: '2027-Q1',
          entry_source: 'level_milestone',
          milestone_id: 'milestone-late',
        },
        {
          id: 'other-quarter',
          user_id: 'quarter-user',
          quarter_key: '2026-Q4',
          entry_source: 'level_milestone',
          milestone_id: 'milestone-q4',
        },
      ],
      milestones: [
        { id: 'milestone-1', reached_at: '2027-02-01T06:00:00.000Z' },
        { id: 'milestone-late', reached_at: '2027-03-20T18:00:00.001Z' },
        { id: 'milestone-q4', reached_at: '2027-01-01T05:30:00.000Z' },
      ],
    });
    expect(await verifySelection(CAMPAIGN_ID, store)).toEqual({
      ok: true,
      match: true,
      drift: false,
      selectionId: SELECTION_ID,
    });
  });

  it('keeps match when a later entry changes the current pool and sets drift', async () => {
    const { store } = client({
      selection: selectionRow(),
      entries: [
        {
          id: ENTRY_ID,
          user_id: USER_ID,
          quarter_key: '2027-Q1',
          entry_source: 'level_milestone',
          milestone_id: 'milestone-1',
        },
        {
          id: 'a1000000-0000-4000-8000-000000000009',
          user_id: 'b1000000-0000-4000-8000-000000000009',
          quarter_key: '2027-Q1',
          entry_source: 'level_milestone',
          milestone_id: 'milestone-2',
        },
      ],
      milestones: [
        { id: 'milestone-1', reached_at: '2027-02-01T06:00:00.000Z' },
        { id: 'milestone-2', reached_at: '2027-01-01T06:00:00.000Z' },
      ],
    });
    const result = await verifySelection(CAMPAIGN_ID, store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toEqual({
      ok: true,
      match: true,
      drift: true,
      selectionId: SELECTION_ID,
    });
  });

  it('pages more than 1000 entries and chunks milestone reads', async () => {
    const count = ENTRY_PAGE_SIZE + 1;
    const people = Array.from({ length: count }, (_, index) => ({
      id: `a1000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
      userId: `b1000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
    }));
    const prizes = [{ id: PRIZE_ID, position: 0, quantity: 1 }];
    const draw = selectWinners({
      seed: SEED,
      entries: people,
      prizes,
      algorithmVersion: DRAWING_SELECTION_ALGORITHM,
    });
    expect(draw.ok).toBe(true);
    if (!draw.ok) return;
    const ordered = [...people].sort((left, right) =>
      compareRanked(
        { rankKey: entryRankHex(SEED, left.id), id: left.id },
        { rankKey: entryRankHex(SEED, right.id), id: right.id },
      ),
    );
    const ranges: [number, number][] = [];
    const chunks: number[] = [];
    const { store } = client({
      onRange: (from, to) => ranges.push([from, to]),
      onIn: (values) => chunks.push(values.length),
      selection: selectionRow({
        eligible_entry_count: count,
        eligible_member_count: count,
        eligible_entry_ids: ordered.map((person) => person.id),
        eligible_user_ids: ordered.map((person) => person.userId),
        prize_unit_count: 1,
        unfilled_unit_count: 0,
      }),
      winners: [
        winnerRow({
          entry_id: draw.winners[0].entryId,
          user_id: draw.winners[0].userId,
          rank: draw.winners[0].rank,
        }),
      ],
      entries: people.map((person) => ({
        id: person.id,
        user_id: person.userId,
        quarter_key: '2027-Q1',
        entry_source: 'level_milestone',
        milestone_id: `milestone-${person.id}`,
      })),
      milestones: people.map((person) => ({
        id: `milestone-${person.id}`,
        reached_at: '2027-02-01T06:00:00.000Z',
      })),
    });
    expect(await verifySelection(CAMPAIGN_ID, store)).toEqual({
      ok: true,
      match: true,
      drift: false,
      selectionId: SELECTION_ID,
    });
    expect(ranges).toEqual([
      [0, ENTRY_PAGE_SIZE - 1],
      [ENTRY_PAGE_SIZE, ENTRY_PAGE_SIZE * 2 - 1],
    ]);
    expect(chunks.length).toBe(Math.ceil(count / MILESTONE_IN_CHUNK));
    expect(chunks.every((size) => size <= MILESTONE_IN_CHUNK)).toBe(true);
    expect(chunks.reduce((sum, size) => sum + size, 0)).toBe(count);
  });

  it('returns not_found when no draw is stored', async () => {
    const { store } = client({ selection: null });
    expect(await getSelection(CAMPAIGN_ID, store)).toEqual({ ok: false, error: 'not_found' });
    expect(await verifySelection(CAMPAIGN_ID, store)).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('selection store boundaries under TZ=UTC and TZ=America/Chicago', () => {
  it('keeps the same eligible entries, winner, and verify match in both process time zones', () => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const probe = 'src/lib/drawings/selection-store.tz-probe.ts';
    const run = (tz: string) => {
      const result = spawnSync(tsx, [probe], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, TZ: tz },
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as {
        eligible: string[];
        winner: string;
        verified: { ok: boolean; match: boolean; drift: boolean };
      };
    };
    const utc = run('UTC');
    const chicago = run('America/Chicago');
    expect(chicago).toEqual(utc);
    expect(utc.eligible).toEqual(['just-before', 'q1-start']);
    expect(['just-before', 'q1-start']).toContain(utc.winner);
    expect(utc.verified).toEqual({ ok: true, match: true, drift: false, selectionId: 'selection-1' });
  }, 20000);
});

describe('selection module boundaries', () => {
  it('is server-only, uses the service-role client, and is not called from the app', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/drawings/selection-store.ts'), 'utf8');
    expect(source.startsWith("import 'server-only';")).toBe(true);
    expect(source).toContain('getSupabaseAdmin');
    expect(source).not.toMatch(/resend|nodemailer|web-push|sendMail|notification/i);
    const skip = new Set([
      path.join(ROOT, 'src/lib/drawings/selection-store.ts'),
      path.join(ROOT, 'src/lib/drawings/selection-store.test.ts'),
      path.join(ROOT, 'src/lib/drawings/selection-store.tz-probe.ts'),
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
          text.includes("from '@/lib/drawings/selection-store'") ||
          text.includes("from './selection-store'") ||
          text.includes('runSimulatedSelection(')
        ) {
          hits.push(path.relative(ROOT, full));
        }
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(hits).toEqual([]);
  });
});
