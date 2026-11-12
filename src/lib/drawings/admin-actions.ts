/**
 * Which admin drawing buttons a stored campaign may show, and the plain
 * messages for action errors. No database and no clock. The page renders
 * buttons only when the actions flag is on. A live draft can be closed.
 * It cannot be activated until official rules exist. A simulated selection
 * is offered only after a sample campaign was activated and then closed.
 */

export const LIVE_CAMPAIGN_ACTIVATION_NOTE =
  "Live campaigns can't go active until official rules exist.";

export const DRAFT_CLOSE_CONFIRM_NOTE =
  "Closing a draft can't be undone, and it will never run a simulated selection. A new draft for this quarter can still be saved later.";

export const ACTIVE_CLOSE_CONFIRM_NOTE = "Closing can't be undone.";

export const CLOSED_WITHOUT_ACTIVATION_NOTE =
  "This campaign was closed without being activated, so it can't run a simulated selection.";

export type DrawingAdminActionKind = 'activate' | 'close' | 'select';

export type DrawingAdminActionOffer = {
  kind: DrawingAdminActionKind;
  label: string;
  confirmLabel: string;
  /** Shown beside the confirm and cancel buttons. Omitted when the second click needs no extra sentence. */
  confirmNote?: string;
};

export type DrawingAdminActionOffers = {
  actions: DrawingAdminActionOffer[];
  note: string | null;
};

const ACTIVATE: DrawingAdminActionOffer = {
  kind: 'activate',
  label: 'Activate',
  confirmLabel: 'Yes, activate',
};

const CLOSE_DRAFT: DrawingAdminActionOffer = {
  kind: 'close',
  label: 'Close',
  confirmLabel: 'Yes, close without activating',
  confirmNote: DRAFT_CLOSE_CONFIRM_NOTE,
};

const CLOSE_ACTIVE: DrawingAdminActionOffer = {
  kind: 'close',
  label: 'Close',
  confirmLabel: 'Yes, close',
  confirmNote: ACTIVE_CLOSE_CONFIRM_NOTE,
};

const SELECT: DrawingAdminActionOffer = {
  kind: 'select',
  label: 'Run simulated selection',
  confirmLabel: 'Yes, run simulated selection',
};

const NONE: DrawingAdminActionOffers = { actions: [], note: null };

/**
 * draft + sample: Activate and Close.
 * draft + live: Close, plus the official-rules note. No Activate.
 * active: Close.
 * closed + sample, no selection, both activated_at and closed_at set: Run simulated selection.
 * closed + sample, no selection, either timestamp missing: no action, with a note.
 * Anything else: no action.
 *
 * Timestamp flags are presence of the raw values, not the formatted dates.
 */
export function drawingAdminActionOffers(state: {
  status: string;
  mode: string;
  hasSelection: boolean;
  activatedAtSet: boolean;
  closedAtSet: boolean;
}): DrawingAdminActionOffers {
  if (state.status === 'draft' && state.mode === 'sample') {
    return { actions: [ACTIVATE, CLOSE_DRAFT], note: null };
  }
  if (state.status === 'draft' && state.mode === 'live') {
    return { actions: [CLOSE_DRAFT], note: LIVE_CAMPAIGN_ACTIVATION_NOTE };
  }
  if (state.status === 'active') {
    return { actions: [CLOSE_ACTIVE], note: null };
  }
  if (state.status === 'closed' && state.mode === 'sample' && !state.hasSelection) {
    if (state.activatedAtSet && state.closedAtSet) {
      return { actions: [SELECT], note: null };
    }
    return { actions: [], note: CLOSED_WITHOUT_ACTIVATION_NOTE };
  }
  return NONE;
}

export const DRAWING_ADMIN_ACTION_SUCCESS: Record<DrawingAdminActionKind, string> = {
  activate: 'This campaign is active.',
  close: 'This campaign is closed.',
  select: 'The simulated selection is stored.',
};

/**
 * Operator label for select_drawing_winners. The column check is
 * btrim(run_by) <> '' (migration 20261110233322). There is no length cap.
 * The column is not an auth.users id. This is "admin:" plus the first 8
 * characters of the admin user id, lowercased. It is not an email and it
 * is not the full user id.
 */
export function drawingAdminRunByLabel(userId: string): string | null {
  if (typeof userId !== 'string' || userId.length < 9) return null;
  const prefix = userId.slice(0, 8).toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(prefix)) return null;
  return `admin:${prefix}`;
}

/** Guard codes plus the store codes activate, close, and selection can return. */
export const DRAWING_ADMIN_ACTION_ERRORS = [
  'disabled',
  'forbidden',
  'mfa_enroll',
  'mfa_challenge',
  'auth_error',
  'role_lookup_failed',
  'not_found',
  'invalid_transition',
  'live_activation_blocked',
  'campaign_window_ended',
  'no_prizes',
  'over_budget',
  'campaign_invalid',
  'unavailable',
  'quarter_campaign_open',
  'campaign_locked',
  'live_selection_blocked',
  'campaign_not_closed',
  'already_selected',
  'invalid_run_by',
  'invalid_seed',
  'no_eligible_entries',
] as const;

export type DrawingAdminActionError = (typeof DRAWING_ADMIN_ACTION_ERRORS)[number];

const STORE_ERRORS = [
  'not_found',
  'invalid_transition',
  'live_activation_blocked',
  'campaign_window_ended',
  'no_prizes',
  'over_budget',
  'unavailable',
  'quarter_campaign_open',
  'campaign_locked',
  'live_selection_blocked',
  'campaign_not_closed',
  'already_selected',
  'invalid_run_by',
  'invalid_seed',
  'no_eligible_entries',
] as const satisfies readonly DrawingAdminActionError[];

export type DrawingStoreError = (typeof STORE_ERRORS)[number];

const STORE_ERROR_SET: ReadonlySet<string> = new Set(STORE_ERRORS);

export function isDrawingStoreError(code: string): code is DrawingStoreError {
  return STORE_ERROR_SET.has(code);
}

const MESSAGES: Record<DrawingAdminActionError, string> = {
  disabled: 'Drawing actions are turned off.',
  forbidden: "You don't have access to drawing actions.",
  mfa_enroll: 'Authenticator setup is required before this action.',
  mfa_challenge: 'Authenticator verification is required before this action.',
  auth_error: 'Authenticator assurance could not be checked.',
  role_lookup_failed: 'Admin permissions could not be checked.',
  not_found: 'That drawing campaign was not found.',
  invalid_transition: "That status change isn't allowed.",
  live_activation_blocked: LIVE_CAMPAIGN_ACTIVATION_NOTE,
  campaign_window_ended: "This campaign's window has ended, so it can't be activated.",
  no_prizes: "This campaign has no prizes, so it can't be activated.",
  over_budget: 'The prizes and fulfillment allowance are over the campaign budget.',
  campaign_invalid: "This campaign's setup doesn't pass its checks, so its status can't change.",
  unavailable: 'Drawing records are unavailable.',
  quarter_campaign_open: 'Another open campaign already uses this quarter.',
  campaign_locked: "This campaign is locked, so it can't be changed.",
  live_selection_blocked: "A live campaign can't run a simulated selection.",
  campaign_not_closed:
    'A simulated selection runs only after a sample campaign is activated and then closed.',
  already_selected: 'This campaign already has a simulated selection.',
  invalid_run_by: 'The selection could not be recorded.',
  invalid_seed: 'The selection could not be recorded.',
  no_eligible_entries: 'There are no eligible entries for this campaign.',
};

export function drawingAdminActionMessage(code: DrawingAdminActionError): string {
  return MESSAGES[code];
}
