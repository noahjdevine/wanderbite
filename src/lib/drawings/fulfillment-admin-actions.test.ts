import { describe, expect, it } from 'vitest';
import {
  FULFILLMENT_COST_CHECK,
  FULFILLMENT_COST_MAX,
  FULFILLMENT_NOTE_CHECK,
  FULFILLMENT_NOTE_MAX,
} from '@/lib/drawings/fulfillment';
import {
  DRAWING_FULFILLMENT_COST_CHECK,
  DRAWING_FULFILLMENT_COST_MAX,
  DRAWING_FULFILLMENT_NOTE_CHECK,
  DRAWING_FULFILLMENT_NOTE_MAX,
  FORFEIT_CONFIRM_NOTE,
  FULFILLED_CONFIRM_NOTE,
  FULFILLMENT_NOTE_MESSAGE,
  drawingFulfillmentActionMessage,
  drawingFulfillmentOffers,
  fulfillmentOfferStatus,
  parseFulfillmentDollars,
  projectedOverAllowance,
  readFulfillmentNote,
} from '@/lib/drawings/fulfillment-admin-actions';

describe('drawingFulfillmentOffers', () => {
  const statuses = [null, '', 'pending', 'ready', 'fulfilled', 'forfeited', 'shipped'] as const;
  const flags = [false, true] as const;

  function expected(state: {
    hasSelection: boolean;
    hasFulfillments: boolean;
    status: string | null;
    memberDeleted: boolean;
  }): string[] {
    if (state.hasSelection && !state.hasFulfillments) return ['create'];
    if (!state.hasFulfillments) return [];
    if (state.memberDeleted && (state.status === 'pending' || state.status === 'ready')) return ['forfeit'];
    if (state.status === 'pending') return ['ready', 'forfeit'];
    if (state.status === 'ready') return ['fulfill', 'forfeit'];
    return [];
  }

  const rows = statuses.flatMap((status) =>
    flags.flatMap((memberDeleted) =>
      flags.flatMap((hasSelection) =>
        flags.map((hasFulfillments) => ({ hasSelection, hasFulfillments, status, memberDeleted })),
      ),
    ),
  );

  it('offers one button set for every status, deleted flag, selection, and fulfillment combination', () => {
    expect(rows).toHaveLength(56);
    for (const row of rows) {
      const offer = drawingFulfillmentOffers(row);
      const label = `${row.status}:deleted=${row.memberDeleted}:sel=${row.hasSelection}:rows=${row.hasFulfillments}`;
      expect(offer.actions.map((action) => action.kind), label).toEqual(expected(row));
      expect(offer.actions.some((action) => action.kind === 'fulfill' && row.status === 'pending'), label).toBe(
        false,
      );
      for (const action of offer.actions) {
        if (action.kind === 'create') {
          expect(action, label).toEqual({
            kind: 'create',
            label: 'Create fulfillment records',
            confirmLabel: 'Yes, create records',
          });
        } else if (action.kind === 'ready') {
          expect(action.label, label).toBe('Mark ready');
          expect(action.confirmLabel, label).toBe('Yes, mark ready');
          expect(action.confirmNote, label).toBeUndefined();
        } else if (action.kind === 'fulfill') {
          expect(action.label, label).toBe('Mark fulfilled');
          expect(action.confirmLabel, label).toBe('Yes, mark fulfilled');
          expect(action.confirmNote, label).toBe(FULFILLED_CONFIRM_NOTE);
        } else {
          expect(action.label, label).toBe('Forfeit');
          expect(action.confirmLabel, label).toBe('Yes, forfeit');
          expect(action.confirmNote, label).toBe(FORFEIT_CONFIRM_NOTE);
        }
      }
      const text = offer.actions
        .flatMap((action) => [action.label, action.confirmLabel, action.confirmNote ?? ''])
        .join(' ');
      expect(text, label).not.toMatch(/email|ship|redraw|@/i);
    }
  });

  it('maps a winner button to the stored status and does not jump pending to fulfilled', () => {
    expect(fulfillmentOfferStatus('ready')).toBe('ready');
    expect(fulfillmentOfferStatus('fulfill')).toBe('fulfilled');
    expect(fulfillmentOfferStatus('forfeit')).toBe('forfeited');
    const pending = drawingFulfillmentOffers({
      hasSelection: true,
      hasFulfillments: true,
      status: 'pending',
      memberDeleted: false,
    });
    expect(pending.actions.map((action) => action.kind)).toEqual(['ready', 'forfeit']);
    expect(pending.actions.map((action) => action.kind)).not.toContain('fulfill');
  });
});

describe('projectedOverAllowance', () => {
  it('is false at and under the allowance, including zero, and true above it', () => {
    expect(
      projectedOverAllowance({ recordedCostCents: 100, newCostCents: 50, allowanceCents: 200 }),
    ).toBe(false);
    expect(
      projectedOverAllowance({ recordedCostCents: 100, newCostCents: 100, allowanceCents: 200 }),
    ).toBe(false);
    expect(
      projectedOverAllowance({ recordedCostCents: 100, newCostCents: 101, allowanceCents: 200 }),
    ).toBe(true);
    expect(projectedOverAllowance({ recordedCostCents: 0, newCostCents: 0, allowanceCents: 0 })).toBe(false);
    expect(projectedOverAllowance({ recordedCostCents: 0, newCostCents: 1, allowanceCents: 0 })).toBe(true);
    expect(
      projectedOverAllowance({ recordedCostCents: 500, newCostCents: 0, allowanceCents: 500 }),
    ).toBe(false);
    expect(
      projectedOverAllowance({ recordedCostCents: 501, newCostCents: 0, allowanceCents: 500 }),
    ).toBe(true);
  });
});

describe('parseFulfillmentDollars', () => {
  it('parses dollar text to integer cents and rejects a bad amount', () => {
    expect(parseFulfillmentDollars('0')).toEqual({ ok: true, cents: 0 });
    expect(parseFulfillmentDollars('0.00')).toEqual({ ok: true, cents: 0 });
    expect(parseFulfillmentDollars('0.0')).toEqual({ ok: true, cents: 0 });
    expect(parseFulfillmentDollars('12.5')).toEqual({ ok: true, cents: 1250 });
    expect(parseFulfillmentDollars('12.50')).toEqual({ ok: true, cents: 1250 });
    expect(parseFulfillmentDollars(' 0.01 ')).toEqual({ ok: true, cents: 1 });
    expect(parseFulfillmentDollars('21474836.47')).toEqual({ ok: true, cents: DRAWING_FULFILLMENT_COST_MAX });
    expect(parseFulfillmentDollars('')).toEqual({ ok: false, reason: 'cost_required' });
    expect(parseFulfillmentDollars('   ')).toEqual({ ok: false, reason: 'cost_required' });
    expect(parseFulfillmentDollars(null)).toEqual({ ok: false, reason: 'cost_required' });
    expect(parseFulfillmentDollars(undefined)).toEqual({ ok: false, reason: 'cost_required' });
    expect(parseFulfillmentDollars('12.345')).toEqual({ ok: false, reason: 'invalid_cost' });
    expect(parseFulfillmentDollars('-1')).toEqual({ ok: false, reason: 'invalid_cost' });
    expect(parseFulfillmentDollars('abc')).toEqual({ ok: false, reason: 'invalid_cost' });
    expect(parseFulfillmentDollars('$1.00')).toEqual({ ok: false, reason: 'invalid_cost' });
    expect(parseFulfillmentDollars('1,000')).toEqual({ ok: false, reason: 'invalid_cost' });
    expect(parseFulfillmentDollars('21474836.48')).toEqual({ ok: false, reason: 'invalid_cost' });
    expect(DRAWING_FULFILLMENT_COST_MAX).toBe(FULFILLMENT_COST_MAX);
    expect(DRAWING_FULFILLMENT_COST_CHECK).toBe(FULFILLMENT_COST_CHECK);
  });
});

describe('readFulfillmentNote', () => {
  it('keeps a note through 500 characters and rejects a longer one', () => {
    expect(DRAWING_FULFILLMENT_NOTE_MAX).toBe(FULFILLMENT_NOTE_MAX);
    expect(DRAWING_FULFILLMENT_NOTE_CHECK).toBe(FULFILLMENT_NOTE_CHECK);
    expect(readFulfillmentNote(undefined)).toEqual({ ok: true, note: null });
    expect(readFulfillmentNote(null)).toEqual({ ok: true, note: null });
    expect(readFulfillmentNote('   ')).toEqual({ ok: true, note: null });
    expect(readFulfillmentNote('packed')).toEqual({ ok: true, note: 'packed' });
    expect(readFulfillmentNote('x'.repeat(500))).toEqual({ ok: true, note: 'x'.repeat(500) });
    expect(readFulfillmentNote('x'.repeat(501))).toEqual({
      ok: false,
      error: DRAWING_FULFILLMENT_NOTE_CHECK,
    });
    expect(readFulfillmentNote(`  ${'x'.repeat(501)}`)).toEqual({
      ok: false,
      error: DRAWING_FULFILLMENT_NOTE_CHECK,
    });
    expect(readFulfillmentNote(12)).toEqual({ ok: false, error: DRAWING_FULFILLMENT_NOTE_CHECK });
    expect(drawingFulfillmentActionMessage(DRAWING_FULFILLMENT_NOTE_CHECK)).toBe(FULFILLMENT_NOTE_MESSAGE);
    expect(FULFILLMENT_NOTE_MESSAGE).not.toContain(DRAWING_FULFILLMENT_NOTE_CHECK);
  });
});
