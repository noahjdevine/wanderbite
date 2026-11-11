/**
 * Pure sample-fulfillment checks.
 *
 * This is the same status graph as transition_drawing_fulfillment
 * (E09-B6). pending goes to ready or forfeited. ready goes to fulfilled
 * or forfeited. fulfilled and forfeited do not move. pending does not
 * jump to fulfilled. A move to fulfilled requires a cost, and 0 is
 * allowed. A cost on any other move is cost_not_allowed. A negative
 * cost, or a cost that is not a 32-bit integer, is the same check the
 * table raises (drawing_fulfillments_actual_cost_cents_check). A note
 * longer than 500 characters after trim is
 * drawing_fulfillment_events_note_check.
 *
 * summarizeFulfillment counts rows and sums recorded costs. It does not
 * add prize unit values, and it does not compare the sum to a
 * campaign's fulfillment allowance. No clock and no database.
 */

import { instantMicros } from '@/lib/drawings/selection';

/** Stored on drawing_fulfillments.status. */
export const FULFILLMENT_STATUSES = ['pending', 'ready', 'fulfilled', 'forfeited'] as const;

export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

/** drawing_fulfillment_events.note, after trim. Matches the table check. */
export const FULFILLMENT_NOTE_MAX = 500;

/** Postgres integer upper bound. actual_cost_cents is integer, not numeric. */
export const FULFILLMENT_COST_MAX = 2_147_483_647;

/** Name of the table check a negative or non-integer cost hits. */
export const FULFILLMENT_COST_CHECK = 'drawing_fulfillments_actual_cost_cents_check';

/** Name of the table check an over-long note hits. */
export const FULFILLMENT_NOTE_CHECK = 'drawing_fulfillment_events_note_check';

/**
 * Stable rejection codes shared with the fulfillment RPCs.
 * not_found and invalid_run_by belong to create_drawing_fulfillments.
 * not_found and invalid_actor belong to transition_drawing_fulfillment,
 * ahead of the codes checkFulfillmentTransition returns.
 * The two check names are the constraint names in the SQLSTATE 23514
 * message. The store uses the same strings.
 */
export const FULFILLMENT_ERROR_CODES = [
  'not_found',
  'invalid_run_by',
  'invalid_actor',
  'invalid_transition',
  'cost_required',
  'cost_not_allowed',
  FULFILLMENT_COST_CHECK,
  FULFILLMENT_NOTE_CHECK,
] as const;

export type FulfillmentErrorCode = (typeof FULFILLMENT_ERROR_CODES)[number];

export type FulfillmentTransitionError =
  | 'invalid_transition'
  | 'cost_required'
  | 'cost_not_allowed'
  | typeof FULFILLMENT_COST_CHECK
  | typeof FULFILLMENT_NOTE_CHECK;

/** Allowed edges. Final statuses map to an empty list. */
export const FULFILLMENT_EDGES: Readonly<Record<FulfillmentStatus, readonly FulfillmentStatus[]>> = {
  pending: ['ready', 'forfeited'],
  ready: ['fulfilled', 'forfeited'],
  fulfilled: [],
  forfeited: [],
};

export type FulfillmentTransitionOptions = {
  /** Omitted and null both mean no cost. 0 is a cost. */
  actualCostCents?: number | null;
  /** Omitted and null both mean no note. Trimmed length is what is stored. */
  note?: string | null;
};

export type FulfillmentTransitionResult =
  | { ok: true }
  | { ok: false; error: FulfillmentTransitionError };

export type FulfillmentSummaryRow = {
  status: string;
  prizeId: string;
  actualCostCents: number | null;
};

export type FulfillmentSummaryPrize = {
  id: string;
  /** Budgeted prize value. Not added into totalActualCostCents. */
  unitValueCents: number;
};

export type FulfillmentSummary = {
  counts: Record<FulfillmentStatus, number>;
  totalActualCostCents: number;
};

/** True when the operator label is missing or only whitespace. The database trims with btrim too. */
export function isBlankOperator(value: string): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

/**
 * Same order as transition_drawing_fulfillment after the row is locked
 * and the actor is accepted: the edge, then a missing cost, then a cost
 * on any other move, then the integer cost check, then the note length.
 * A bad edge wins over a cost problem, including a move out of fulfilled
 * or forfeited and a direct pending -> fulfilled.
 */
export function checkFulfillmentTransition(
  current: string,
  to: string,
  options: FulfillmentTransitionOptions,
): FulfillmentTransitionResult {
  const allowed = isFulfillmentStatus(current) ? FULFILLMENT_EDGES[current] : null;
  if (allowed === null || !allowed.includes(to as FulfillmentStatus)) {
    return { ok: false, error: 'invalid_transition' };
  }
  const cost = options.actualCostCents;
  const costProvided = cost !== null && cost !== undefined;
  if (to === 'fulfilled' && !costProvided) {
    return { ok: false, error: 'cost_required' };
  }
  if (to !== 'fulfilled' && costProvided) {
    return { ok: false, error: 'cost_not_allowed' };
  }
  if (to === 'fulfilled' && !isStoredCost(cost)) {
    return { ok: false, error: FULFILLMENT_COST_CHECK };
  }
  if (!isStoredNote(options.note)) {
    return { ok: false, error: FULFILLMENT_NOTE_CHECK };
  }
  return { ok: true };
}

/**
 * Counts by status and sums actual_cost_cents.
 * A row counts only when its prizeId is in `prizes`. Pass the campaign's
 * prizes. A prize whose unitValueCents is not a non-negative integer is
 * not a scope key, and that value is never added to the cost total.
 * This does not compare the total to fulfillment_allowance_cents.
 */
export function summarizeFulfillment(
  rows: readonly FulfillmentSummaryRow[],
  prizes: readonly FulfillmentSummaryPrize[],
): FulfillmentSummary {
  const counts: Record<FulfillmentStatus, number> = {
    pending: 0,
    ready: 0,
    fulfilled: 0,
    forfeited: 0,
  };
  const known = new Set<string>();
  for (const prize of prizes) {
    if (!prize || typeof prize.id !== 'string' || prize.id.length === 0) continue;
    if (!isStoredCost(prize.unitValueCents)) continue;
    known.add(prize.id);
  }
  let totalActualCostCents = 0;
  for (const row of rows) {
    if (!row || typeof row.prizeId !== 'string' || !known.has(row.prizeId)) continue;
    if (!isFulfillmentStatus(row.status)) continue;
    counts[row.status] += 1;
    if (isStoredCost(row.actualCostCents)) {
      totalActualCostCents += row.actualCostCents;
    }
  }
  return { counts, totalActualCostCents };
}

/**
 * Earlier instant first. Strings are compared as instants, so an offset
 * form and a Z form of the same moment tie. A value with no zone sorts
 * last. The process time zone is not used.
 */
export function compareCreatedAt(left: string, right: string): number {
  const a = instantMicros(left);
  const b = instantMicros(right);
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function isFulfillmentStatus(value: string): value is FulfillmentStatus {
  return (FULFILLMENT_STATUSES as readonly string[]).includes(value);
}

function isStoredCost(cost: number | null | undefined): cost is number {
  return (
    typeof cost === 'number' &&
    Number.isSafeInteger(cost) &&
    cost >= 0 &&
    cost <= FULFILLMENT_COST_MAX
  );
}

function isStoredNote(note: string | null | undefined): boolean {
  if (note === null || note === undefined) return true;
  if (typeof note !== 'string') return false;
  return note.trim().length <= FULFILLMENT_NOTE_MAX;
}
