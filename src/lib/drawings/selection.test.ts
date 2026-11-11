import { describe, expect, it } from 'vitest';
import {
  DRAWING_SELECTION_ALGORITHM,
  checkSelectionAllowed,
  compareRanked,
  entryRankHex,
  explainSelectionMatch,
  filterEligibleEntries,
  instantMicros,
  selectWinners,
  type EligibleEntry,
  type SelectionPrize,
} from '@/lib/drawings/selection';

const SEED = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const ENTRY = {
  a: 'a1000000-0000-4000-8000-000000000001',
  b: 'a1000000-0000-4000-8000-000000000002',
  c: 'a1000000-0000-4000-8000-000000000003',
  d: 'a1000000-0000-4000-8000-000000000004',
  e: 'a1000000-0000-4000-8000-000000000005',
  extra: 'a1000000-0000-4000-8000-000000000006',
} as const;

const USER = {
  a: 'b1000000-0000-4000-8000-000000000001',
  b: 'b1000000-0000-4000-8000-000000000002',
  c: 'b1000000-0000-4000-8000-000000000003',
  d: 'b1000000-0000-4000-8000-000000000004',
  e: 'b1000000-0000-4000-8000-000000000005',
} as const;

const PRIZE_A = 'c1000000-0000-4000-8000-00000000000a';
const PRIZE_B = 'c1000000-0000-4000-8000-00000000000b';

const CLOSED = '2027-03-20T18:00:00.000Z';
const Q1_START = '2027-01-01T06:00:00.000Z';

function fiveEntries() {
  return [
    { id: ENTRY.a, userId: USER.a },
    { id: ENTRY.b, userId: USER.b },
    { id: ENTRY.c, userId: USER.c },
    { id: ENTRY.d, userId: USER.d },
    { id: ENTRY.e, userId: USER.e },
  ];
}

function twoPrizes(): SelectionPrize[] {
  return [
    { id: PRIZE_B, position: 1, quantity: 1 },
    { id: PRIZE_A, position: 0, quantity: 2 },
  ];
}

function entry(partial: Partial<EligibleEntry> & Pick<EligibleEntry, 'id' | 'reachedAt'>): EligibleEntry {
  return {
    userId: USER.a,
    quarterKey: '2027-Q1',
    entrySource: 'level_milestone',
    ...partial,
  };
}

describe('selectWinners', () => {
  it('hashes seed || entry id as lowercase sha256 hex', () => {
    expect(entryRankHex(SEED, ENTRY.a)).toBe(
      '92b859efd3efd3fd18788e57e3105d18cc64c7bda83f8d22aee070558d67be4a',
    );
  });

  it('orders five entries by that hash and fills prize units in prize order', () => {
    const result = selectWinners({
      seed: SEED,
      entries: fiveEntries().reverse(),
      prizes: twoPrizes(),
      algorithmVersion: DRAWING_SELECTION_ALGORITHM,
    });
    expect(result).toEqual({
      ok: true,
      eligibleEntryCount: 5,
      eligibleMemberCount: 5,
      prizeUnitCount: 3,
      unfilledUnitCount: 0,
      winners: [
        { prizeId: PRIZE_A, unitIndex: 1, entryId: ENTRY.b, userId: USER.b, rank: 1 },
        { prizeId: PRIZE_A, unitIndex: 2, entryId: ENTRY.c, userId: USER.c, rank: 2 },
        { prizeId: PRIZE_B, unitIndex: 1, entryId: ENTRY.d, userId: USER.d, rank: 3 },
      ],
    });
  });

  it('breaks equal rank keys by entry id', () => {
    expect(compareRanked({ rankKey: 'aa', id: 'b' }, { rankKey: 'aa', id: 'a' })).toBe(1);
    expect(compareRanked({ rankKey: 'aa', id: 'a' }, { rankKey: 'ab', id: 'a' })).toBe(-1);
  });

  it('gives one member at most one prize and leaves the rest unfilled', () => {
    const result = selectWinners({
      seed: SEED,
      entries: [
        { id: ENTRY.a, userId: USER.a },
        { id: ENTRY.b, userId: USER.a },
        { id: ENTRY.c, userId: USER.a },
      ],
      prizes: [{ id: PRIZE_A, position: 0, quantity: 3 }],
      algorithmVersion: DRAWING_SELECTION_ALGORITHM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].userId).toBe(USER.a);
    expect(result.unfilledUnitCount).toBe(2);
    expect(new Set(result.winners.map((winner) => winner.userId)).size).toBe(1);
  });

  it('fills every member once when there are fewer members than units', () => {
    const result = selectWinners({
      seed: SEED,
      entries: [
        { id: ENTRY.a, userId: USER.a },
        { id: ENTRY.b, userId: USER.b },
      ],
      prizes: [{ id: PRIZE_A, position: 0, quantity: 4 }],
      algorithmVersion: DRAWING_SELECTION_ALGORITHM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.winners.map((winner) => winner.userId).sort()).toEqual([USER.a, USER.b].sort());
    expect(result.unfilledUnitCount).toBe(2);
    expect(result.prizeUnitCount).toBe(4);
  });

  it('shows an extra entry changes who wins', () => {
    const without = selectWinners({
      seed: SEED,
      entries: fiveEntries(),
      prizes: [{ id: PRIZE_A, position: 0, quantity: 3 }],
      algorithmVersion: DRAWING_SELECTION_ALGORITHM,
    });
    const withExtra = selectWinners({
      seed: SEED,
      entries: [...fiveEntries(), { id: ENTRY.extra, userId: USER.e }],
      prizes: [{ id: PRIZE_A, position: 0, quantity: 3 }],
      algorithmVersion: DRAWING_SELECTION_ALGORITHM,
    });
    expect(without.ok && withExtra.ok).toBe(true);
    if (!without.ok || !withExtra.ok) return;
    expect(without.winners.map((winner) => winner.entryId)).toEqual([ENTRY.b, ENTRY.c, ENTRY.d]);
    expect(withExtra.winners).toEqual([
      { prizeId: PRIZE_A, unitIndex: 1, entryId: ENTRY.b, userId: USER.b, rank: 1 },
      { prizeId: PRIZE_A, unitIndex: 2, entryId: ENTRY.extra, userId: USER.e, rank: 2 },
      { prizeId: PRIZE_A, unitIndex: 3, entryId: ENTRY.c, userId: USER.c, rank: 3 },
    ]);
    expect(withExtra.winners.some((winner) => winner.userId === USER.e)).toBe(true);
    expect(without.winners.some((winner) => winner.userId === USER.e)).toBe(false);
    expect(withExtra.winners.filter((winner) => winner.userId === USER.e)).toHaveLength(1);
  });

  it('orders tied prize positions by prize id', () => {
    const result = selectWinners({
      seed: SEED,
      entries: [
        { id: ENTRY.a, userId: USER.a },
        { id: ENTRY.b, userId: USER.b },
      ],
      prizes: [
        { id: PRIZE_B, position: 0, quantity: 1 },
        { id: PRIZE_A, position: 0, quantity: 1 },
      ],
      algorithmVersion: DRAWING_SELECTION_ALGORITHM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.winners.map((winner) => winner.prizeId)).toEqual([PRIZE_A, PRIZE_B]);
  });

  it('rejects an unknown algorithm and a seed that is not 64 lowercase hex chars', () => {
    expect(
      selectWinners({
        seed: SEED,
        entries: [],
        prizes: [],
        algorithmVersion: 'v2',
      }),
    ).toEqual({ ok: false, error: 'unknown_algorithm' });
    expect(
      selectWinners({
        seed: SEED.toUpperCase(),
        entries: [],
        prizes: [],
        algorithmVersion: DRAWING_SELECTION_ALGORITHM,
      }),
    ).toEqual({ ok: false, error: 'invalid_seed' });
  });
});

describe('filterEligibleEntries', () => {
  const gate = {
    quarterKey: '2027-Q1',
    eligibleEntrySources: ['level_milestone'],
    closedAt: CLOSED,
  };

  it('keeps a reached_at just before close and the 2027-Q1 start, and drops the rest', () => {
    const rows = [
      entry({ id: 'just-before', reachedAt: '2027-03-20T17:59:59.999Z' }),
      entry({ id: 'at-close', reachedAt: CLOSED }),
      entry({ id: 'just-after', reachedAt: '2027-03-20T18:00:00.001Z' }),
      entry({ id: 'q1-start', reachedAt: Q1_START }),
      entry({ id: 'q4-instant', quarterKey: '2026-Q4', reachedAt: '2027-01-01T05:30:00.000Z' }),
      entry({ id: 'other-quarter', quarterKey: '2027-Q2', reachedAt: '2027-02-01T00:00:00.000Z' }),
      entry({ id: 'other-source', entrySource: 'recipe', reachedAt: '2027-02-01T00:00:00.000Z' }),
    ];
    expect(filterEligibleEntries(rows, gate).map((row) => row.id)).toEqual(['just-before', 'q1-start']);
  });

  it('treats Z and an explicit zero offset as the same instant', () => {
    expect(instantMicros(Q1_START)).toBe(instantMicros('2027-01-01T06:00:00.000+00:00'));
    expect(instantMicros('2027-03-20T12:00:00.000-05:00')).toBe(instantMicros('2027-03-20T17:00:00.000Z'));
    const rows = [entry({ id: 'offset', reachedAt: '2027-03-20T11:59:59.999000-05:00' })];
    expect(filterEligibleEntries(rows, { ...gate, closedAt: '2027-03-20T17:00:00.000Z' }).map((row) => row.id)).toEqual([
      'offset',
    ]);
    expect(filterEligibleEntries(rows, { ...gate, closedAt: '2027-03-20T16:59:59.999Z' })).toEqual([]);
  });
});

describe('checkSelectionAllowed', () => {
  const closed = {
    status: 'closed',
    mode: 'sample',
    activatedAt: '2027-01-02T00:00:00.000Z',
    closedAt: CLOSED,
  };

  it('matches the database codes for the campaign states', () => {
    expect(checkSelectionAllowed(null, null)).toEqual({ ok: false, error: 'not_found' });
    expect(checkSelectionAllowed({ ...closed, mode: 'live' }, null)).toEqual({
      ok: false,
      error: 'live_selection_blocked',
    });
    expect(checkSelectionAllowed({ ...closed, status: 'draft', activatedAt: null, closedAt: null }, null)).toEqual({
      ok: false,
      error: 'campaign_not_closed',
    });
    expect(checkSelectionAllowed({ ...closed, status: 'active', closedAt: null }, null)).toEqual({
      ok: false,
      error: 'campaign_not_closed',
    });
    expect(checkSelectionAllowed({ ...closed, activatedAt: null, closedAt: null }, null)).toEqual({
      ok: false,
      error: 'campaign_not_closed',
    });
    expect(checkSelectionAllowed({ ...closed, activatedAt: null }, null)).toEqual({
      ok: false,
      error: 'campaign_not_closed',
    });
    expect(checkSelectionAllowed({ ...closed, mode: 'live', status: 'draft', activatedAt: null, closedAt: null }, null)).toEqual({
      ok: false,
      error: 'live_selection_blocked',
    });
    expect(checkSelectionAllowed(closed, { id: 'sel' })).toEqual({ ok: false, error: 'already_selected' });
    expect(checkSelectionAllowed(closed, null)).toEqual({ ok: true });
  });
});

describe('explainSelectionMatch', () => {
  it('matches an identical recompute and reports a count change', () => {
    const result = selectWinners({
      seed: SEED,
      entries: fiveEntries(),
      prizes: twoPrizes(),
      algorithmVersion: DRAWING_SELECTION_ALGORITHM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(explainSelectionMatch(result, result)).toEqual({ match: true });
    expect(
      explainSelectionMatch(
        { ...result, eligibleEntryCount: result.eligibleEntryCount + 1 },
        result,
      ),
    ).toEqual({ match: false, reason: 'eligible_entry_count' });
  });
});
