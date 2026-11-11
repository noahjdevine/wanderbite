import { describe, expect, it } from 'vitest';
import {
  FULFILLMENT_COST_CHECK,
  FULFILLMENT_COST_MAX,
  FULFILLMENT_EDGES,
  FULFILLMENT_NOTE_CHECK,
  FULFILLMENT_NOTE_MAX,
  FULFILLMENT_STATUSES,
  checkFulfillmentTransition,
  compareCreatedAt,
  isBlankOperator,
  summarizeFulfillment,
  type FulfillmentStatus,
} from '@/lib/drawings/fulfillment';

const PRIZE_A = 'c1000000-0000-4000-8000-00000000000a';
const PRIZE_B = 'c1000000-0000-4000-8000-00000000000b';

const BEFORE_Q1 = '2027-01-01T05:59:59.000Z';
const AFTER_Q1 = '2027-01-01T00:00:01.000-06:00';
const Q1_START_Z = '2027-01-01T06:00:00.000Z';
const Q1_START_CHICAGO = '2027-01-01T00:00:00.000-06:00';

describe('checkFulfillmentTransition', () => {
  it('allows the four edges and rejects every other pair', () => {
    const extras = ['shipped', 'pending', ''];
    for (const current of FULFILLMENT_STATUSES) {
      for (const to of [...FULFILLMENT_STATUSES, ...extras]) {
        const allowed = (FULFILLMENT_EDGES[current] as readonly string[]).includes(to);
        const cost = to === 'fulfilled' ? 2500 : null;
        const result = checkFulfillmentTransition(current, to, { actualCostCents: cost });
        if (allowed) {
          expect(result, `${current} -> ${to}`).toEqual({ ok: true });
        } else {
          expect(result, `${current} -> ${to}`).toEqual({ ok: false, error: 'invalid_transition' });
        }
      }
    }
  });

  it('rejects a direct pending to fulfilled, including when a cost is supplied', () => {
    expect(checkFulfillmentTransition('pending', 'fulfilled', { actualCostCents: null })).toEqual({
      ok: false,
      error: 'invalid_transition',
    });
    expect(checkFulfillmentTransition('pending', 'fulfilled', { actualCostCents: 2500 })).toEqual({
      ok: false,
      error: 'invalid_transition',
    });
    expect(checkFulfillmentTransition('pending', 'fulfilled', { actualCostCents: -1 })).toEqual({
      ok: false,
      error: 'invalid_transition',
    });
  });

  it('rejects every move out of a final status before it looks at the cost', () => {
    for (const current of ['fulfilled', 'forfeited'] as const) {
      for (const to of [...FULFILLMENT_STATUSES, 'shipped']) {
        expect(checkFulfillmentTransition(current, to, { actualCostCents: null })).toEqual({
          ok: false,
          error: 'invalid_transition',
        });
        expect(checkFulfillmentTransition(current, to, { actualCostCents: 2500 })).toEqual({
          ok: false,
          error: 'invalid_transition',
        });
        expect(checkFulfillmentTransition(current, to, { actualCostCents: -1 })).toEqual({
          ok: false,
          error: 'invalid_transition',
        });
      }
    }
  });

  it('requires a cost only on the move to fulfilled, and allows 0', () => {
    expect(checkFulfillmentTransition('ready', 'fulfilled', {})).toEqual({
      ok: false,
      error: 'cost_required',
    });
    expect(checkFulfillmentTransition('ready', 'fulfilled', { actualCostCents: null })).toEqual({
      ok: false,
      error: 'cost_required',
    });
    expect(checkFulfillmentTransition('ready', 'fulfilled', { actualCostCents: 0 })).toEqual({ ok: true });
    expect(checkFulfillmentTransition('ready', 'fulfilled', { actualCostCents: 2500 })).toEqual({ ok: true });
    expect(checkFulfillmentTransition('ready', 'fulfilled', { actualCostCents: FULFILLMENT_COST_MAX })).toEqual({
      ok: true,
    });
  });

  it('rejects a cost on every move that is not to fulfilled', () => {
    const moves: [FulfillmentStatus, FulfillmentStatus][] = [
      ['pending', 'ready'],
      ['pending', 'forfeited'],
      ['ready', 'forfeited'],
    ];
    for (const [current, to] of moves) {
      expect(checkFulfillmentTransition(current, to, { actualCostCents: 0 })).toEqual({
        ok: false,
        error: 'cost_not_allowed',
      });
      expect(checkFulfillmentTransition(current, to, { actualCostCents: 2500 })).toEqual({
        ok: false,
        error: 'cost_not_allowed',
      });
      expect(checkFulfillmentTransition(current, to, { actualCostCents: -1 })).toEqual({
        ok: false,
        error: 'cost_not_allowed',
      });
      expect(checkFulfillmentTransition(current, to, { actualCostCents: null })).toEqual({ ok: true });
    }
  });

  it('reports a negative or non-integer fulfilled cost as the table check', () => {
    for (const cost of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, FULFILLMENT_COST_MAX + 1]) {
      expect(checkFulfillmentTransition('ready', 'fulfilled', { actualCostCents: cost })).toEqual({
        ok: false,
        error: FULFILLMENT_COST_CHECK,
      });
    }
  });

  it('caps a note at 500 characters after trim', () => {
    const max = 'n'.repeat(FULFILLMENT_NOTE_MAX);
    const over = 'n'.repeat(FULFILLMENT_NOTE_MAX + 1);
    expect(checkFulfillmentTransition('pending', 'ready', { note: max })).toEqual({ ok: true });
    expect(checkFulfillmentTransition('pending', 'ready', { note: `  ${max}  ` })).toEqual({ ok: true });
    expect(checkFulfillmentTransition('pending', 'ready', { note: '   ' })).toEqual({ ok: true });
    expect(checkFulfillmentTransition('pending', 'ready', { note: null })).toEqual({ ok: true });
    expect(checkFulfillmentTransition('pending', 'ready', { note: over })).toEqual({
      ok: false,
      error: FULFILLMENT_NOTE_CHECK,
    });
    expect(checkFulfillmentTransition('ready', 'fulfilled', { actualCostCents: 2500, note: over })).toEqual({
      ok: false,
      error: FULFILLMENT_NOTE_CHECK,
    });
    expect(checkFulfillmentTransition('pending', 'fulfilled', { note: over })).toEqual({
      ok: false,
      error: 'invalid_transition',
    });
  });
});

describe('isBlankOperator', () => {
  it('matches a missing or whitespace label', () => {
    expect(isBlankOperator('')).toBe(true);
    expect(isBlankOperator('   ')).toBe(true);
    expect(isBlankOperator('  lead  ')).toBe(false);
  });
});

describe('summarizeFulfillment', () => {
  const prizes = [
    { id: PRIZE_A, unitValueCents: 1000 },
    { id: PRIZE_B, unitValueCents: 0 },
  ];

  it('counts each status and sums recorded costs without adding unit values', () => {
    const summary = summarizeFulfillment(
      [
        { status: 'pending', prizeId: PRIZE_A, actualCostCents: null },
        { status: 'ready', prizeId: PRIZE_A, actualCostCents: null },
        { status: 'fulfilled', prizeId: PRIZE_A, actualCostCents: 2500 },
        { status: 'fulfilled', prizeId: PRIZE_B, actualCostCents: 0 },
        { status: 'forfeited', prizeId: PRIZE_B, actualCostCents: null },
      ],
      prizes,
    );
    expect(summary).toEqual({
      counts: { pending: 1, ready: 1, fulfilled: 2, forfeited: 1 },
      totalActualCostCents: 2500,
    });
  });

  it('leaves out a row whose prize is not in the list, and an unknown status', () => {
    const summary = summarizeFulfillment(
      [
        { status: 'fulfilled', prizeId: 'missing', actualCostCents: 9000 },
        { status: 'shipped', prizeId: PRIZE_A, actualCostCents: 400 },
        { status: 'pending', prizeId: PRIZE_A, actualCostCents: null },
      ],
      prizes,
    );
    expect(summary).toEqual({
      counts: { pending: 1, ready: 0, fulfilled: 0, forfeited: 0 },
      totalActualCostCents: 0,
    });
  });

  it('returns zeros for no rows and ignores a prize with a negative unit value', () => {
    expect(summarizeFulfillment([], prizes)).toEqual({
      counts: { pending: 0, ready: 0, fulfilled: 0, forfeited: 0 },
      totalActualCostCents: 0,
    });
    expect(
      summarizeFulfillment(
        [{ status: 'fulfilled', prizeId: PRIZE_A, actualCostCents: 2500 }],
        [{ id: PRIZE_A, unitValueCents: -1 }],
      ),
    ).toEqual({
      counts: { pending: 0, ready: 0, fulfilled: 0, forfeited: 0 },
      totalActualCostCents: 0,
    });
  });
});

describe('compareCreatedAt', () => {
  it('orders a pair that straddles 2027-01-01T06:00:00.000Z by instant', () => {
    expect(BEFORE_Q1 < AFTER_Q1).toBe(false);
    expect(compareCreatedAt(BEFORE_Q1, AFTER_Q1)).toBe(-1);
    expect(compareCreatedAt(AFTER_Q1, BEFORE_Q1)).toBe(1);
    expect(compareCreatedAt(Q1_START_Z, Q1_START_CHICAGO)).toBe(0);
    expect(compareCreatedAt(BEFORE_Q1, Q1_START_Z)).toBe(-1);
    expect(compareCreatedAt(Q1_START_CHICAGO, AFTER_Q1)).toBe(-1);
  });
});
