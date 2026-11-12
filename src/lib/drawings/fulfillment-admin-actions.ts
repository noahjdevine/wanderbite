/**
 * Which sample-fulfillment buttons an admin may show, and the plain
 * messages for those actions. No database and no clock. The page renders
 * the buttons only when the fulfillment flag is on together with the
 * two drawing flags. A deleted member's prize can be forfeited. It is
 * not marked ready or fulfilled.
 *
 * "Budget" for the warning is the campaign's fulfillment allowance.
 * projectedOverAllowance is the same comparison as the admin note
 * "Recorded cost is above the fulfillment allowance": recorded cost plus
 * the new cost is above fulfillment_allowance_cents. Equal is not above.
 */

/** Matches FULFILLMENT_NOTE_MAX. Trimmed length, same as the table check. */
export const DRAWING_FULFILLMENT_NOTE_MAX = 500;

/** Matches FULFILLMENT_COST_MAX. actual_cost_cents is a Postgres integer. */
export const DRAWING_FULFILLMENT_COST_MAX = 2_147_483_647;

/** Matches FULFILLMENT_COST_CHECK. */
export const DRAWING_FULFILLMENT_COST_CHECK = 'drawing_fulfillments_actual_cost_cents_check';

/** Matches FULFILLMENT_NOTE_CHECK. */
export const DRAWING_FULFILLMENT_NOTE_CHECK = 'drawing_fulfillment_events_note_check';

export const FULFILLMENT_NOTE_MESSAGE = 'A note can be at most 500 characters.';

export const FORFEIT_CONFIRM_NOTE =
  "Forfeiting can't be undone and does not pick a new winner.";

export const FULFILLED_CONFIRM_NOTE = "Fulfilled can't be undone.";

export type DrawingFulfillmentOfferKind = 'create' | 'ready' | 'fulfill' | 'forfeit';

export type DrawingFulfillmentOffer = {
  kind: DrawingFulfillmentOfferKind;
  label: string;
  confirmLabel: string;
  /** Shown beside the confirm and cancel buttons. Omitted when the second click needs no extra sentence. */
  confirmNote?: string;
};

export type DrawingFulfillmentOffers = {
  actions: DrawingFulfillmentOffer[];
};

const CREATE: DrawingFulfillmentOffer = {
  kind: 'create',
  label: 'Create fulfillment records',
  confirmLabel: 'Yes, create records',
};

const READY: DrawingFulfillmentOffer = {
  kind: 'ready',
  label: 'Mark ready',
  confirmLabel: 'Yes, mark ready',
};

const FULFILL: DrawingFulfillmentOffer = {
  kind: 'fulfill',
  label: 'Mark fulfilled',
  confirmLabel: 'Yes, mark fulfilled',
  confirmNote: FULFILLED_CONFIRM_NOTE,
};

const FORFEIT: DrawingFulfillmentOffer = {
  kind: 'forfeit',
  label: 'Forfeit',
  confirmLabel: 'Yes, forfeit',
  confirmNote: FORFEIT_CONFIRM_NOTE,
};

const NONE: DrawingFulfillmentOffers = { actions: [] };

/**
 * A selection with no fulfillment rows offers Create fulfillment records.
 * That is one campaign button, not a button on every winner.
 * Pending offers Mark ready and Forfeit. Ready offers Mark fulfilled and Forfeit.
 * Fulfilled and forfeited offer nothing. pending does not offer fulfilled.
 * A deleted member's pending or ready prize offers Forfeit only.
 */
export function drawingFulfillmentOffers(state: {
  hasSelection: boolean;
  hasFulfillments: boolean;
  status: string | null;
  memberDeleted: boolean;
}): DrawingFulfillmentOffers {
  if (state.hasSelection && !state.hasFulfillments) {
    return { actions: [CREATE] };
  }
  if (!state.hasFulfillments) return NONE;
  if (state.memberDeleted && (state.status === 'pending' || state.status === 'ready')) {
    return { actions: [FORFEIT] };
  }
  if (state.status === 'pending') return { actions: [READY, FORFEIT] };
  if (state.status === 'ready') return { actions: [FULFILL, FORFEIT] };
  return NONE;
}

export const DRAWING_FULFILLMENT_SUCCESS: Record<DrawingFulfillmentOfferKind, string> = {
  create: 'Fulfillment records are stored.',
  ready: 'This prize is marked ready.',
  fulfill: 'This prize is marked fulfilled.',
  forfeit: 'This prize is forfeited. No new winner was picked.',
};

/** Store status for a per-winner button. Create is not a status move. */
export function fulfillmentOfferStatus(
  kind: 'ready' | 'fulfill' | 'forfeit',
): 'ready' | 'fulfilled' | 'forfeited' {
  if (kind === 'ready') return 'ready';
  if (kind === 'fulfill') return 'fulfilled';
  return 'forfeited';
}

/**
 * True when recorded cost plus the new cost is above the allowance.
 * Equal to the allowance is false. This is not a comparison to total_budget_cents.
 */
export function projectedOverAllowance(input: {
  recordedCostCents: number;
  newCostCents: number;
  allowanceCents: number;
}): boolean {
  const { recordedCostCents, newCostCents, allowanceCents } = input;
  if (
    !Number.isFinite(recordedCostCents) ||
    !Number.isFinite(newCostCents) ||
    !Number.isFinite(allowanceCents)
  ) {
    return true;
  }
  return recordedCostCents + newCostCents > allowanceCents;
}

export type ParsedFulfillmentDollars =
  | { ok: true; cents: number }
  | { ok: false; reason: 'cost_required' | 'invalid_cost' };

/**
 * Dollar text from the form, parsed to integer cents.
 * "0", "0.00", and "12.5" are valid. Zero is allowed.
 * Empty is cost_required. A sign, a letter, or more than two decimal places is invalid_cost.
 */
export function parseFulfillmentDollars(input: string | null | undefined): ParsedFulfillmentDollars {
  if (typeof input !== 'string') return { ok: false, reason: 'cost_required' };
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, reason: 'cost_required' };
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return { ok: false, reason: 'invalid_cost' };
  const dollarDigits = match[1].replace(/^0+/, '') || '0';
  if (dollarDigits.length > 8) return { ok: false, reason: 'invalid_cost' };
  const dollars = Number(dollarDigits);
  const fraction = match[2] ?? '';
  const centsPart = Number((fraction + '00').slice(0, 2));
  if (!Number.isInteger(dollars) || !Number.isInteger(centsPart) || centsPart < 0 || centsPart > 99) {
    return { ok: false, reason: 'invalid_cost' };
  }
  const maxDollars = Math.floor(DRAWING_FULFILLMENT_COST_MAX / 100);
  if (dollars > maxDollars) return { ok: false, reason: 'invalid_cost' };
  if (dollars === maxDollars && centsPart > DRAWING_FULFILLMENT_COST_MAX % 100) {
    return { ok: false, reason: 'invalid_cost' };
  }
  return { ok: true, cents: dollars * 100 + centsPart };
}

export type ReadFulfillmentNote =
  | { ok: true; note: string | null }
  | { ok: false; error: typeof DRAWING_FULFILLMENT_NOTE_CHECK };

/** Empty and whitespace become no note. Longer than 500 characters after trim is the table check name. */
export function readFulfillmentNote(note: unknown): ReadFulfillmentNote {
  if (note === undefined || note === null) return { ok: true, note: null };
  if (typeof note !== 'string') return { ok: false, error: DRAWING_FULFILLMENT_NOTE_CHECK };
  if (note.trim().length > DRAWING_FULFILLMENT_NOTE_MAX) {
    return { ok: false, error: DRAWING_FULFILLMENT_NOTE_CHECK };
  }
  if (note.trim() === '') return { ok: true, note: null };
  return { ok: true, note };
}

/** Guard codes, the action's own cost and confirm codes, and the store codes a fulfillment call can return. */
export const DRAWING_FULFILLMENT_ACTION_ERRORS = [
  'disabled',
  'forbidden',
  'mfa_enroll',
  'mfa_challenge',
  'auth_error',
  'role_lookup_failed',
  'not_found',
  'invalid_transition',
  'invalid_run_by',
  'invalid_actor',
  'cost_required',
  'cost_not_allowed',
  'invalid_cost',
  'over_allowance_confirm',
  DRAWING_FULFILLMENT_COST_CHECK,
  DRAWING_FULFILLMENT_NOTE_CHECK,
  'unavailable',
] as const;

export type DrawingFulfillmentActionError = (typeof DRAWING_FULFILLMENT_ACTION_ERRORS)[number];

const STORE_ERRORS = [
  'not_found',
  'invalid_run_by',
  'invalid_actor',
  'invalid_transition',
  'cost_required',
  'cost_not_allowed',
  DRAWING_FULFILLMENT_COST_CHECK,
  DRAWING_FULFILLMENT_NOTE_CHECK,
  'unavailable',
] as const satisfies readonly DrawingFulfillmentActionError[];

export type DrawingFulfillmentStoreError = (typeof STORE_ERRORS)[number];

const STORE_ERROR_SET: ReadonlySet<string> = new Set(STORE_ERRORS);

export function isDrawingFulfillmentStoreError(code: string): code is DrawingFulfillmentStoreError {
  return STORE_ERROR_SET.has(code);
}

const MESSAGES: Record<Exclude<DrawingFulfillmentActionError, 'over_allowance_confirm'>, string> = {
  disabled: 'Drawing fulfillment actions are turned off.',
  forbidden: "You don't have access to drawing actions.",
  mfa_enroll: 'Authenticator setup is required before this action.',
  mfa_challenge: 'Authenticator verification is required before this action.',
  auth_error: 'Authenticator assurance could not be checked.',
  role_lookup_failed: 'Admin permissions could not be checked.',
  not_found: 'That drawing record was not found.',
  invalid_transition: "That status change isn't allowed.",
  invalid_run_by: 'The fulfillment records could not be created.',
  invalid_actor: 'The fulfillment change could not be recorded.',
  cost_required: 'Enter the actual cost in dollars. Zero is allowed.',
  cost_not_allowed: 'A cost is recorded only when a prize is marked fulfilled.',
  invalid_cost: 'Enter a dollar amount with at most two decimal places. Zero is allowed.',
  [DRAWING_FULFILLMENT_COST_CHECK]: "That cost can't be stored.",
  [DRAWING_FULFILLMENT_NOTE_CHECK]: FULFILLMENT_NOTE_MESSAGE,
  unavailable: 'Drawing records are unavailable.',
};

export function drawingFulfillmentActionMessage(
  code: Exclude<DrawingFulfillmentActionError, 'over_allowance_confirm'>,
): string {
  return MESSAGES[code];
}
