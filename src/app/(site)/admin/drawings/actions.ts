'use server';

import { revalidatePath } from 'next/cache';
import { assertAdmin } from '@/lib/auth/assert-admin';
import {
  drawingAdminActionMessage,
  drawingAdminRunByLabel,
  isDrawingStoreError,
  type DrawingAdminActionError,
  type DrawingStoreError,
} from '@/lib/drawings/admin-actions';
import { CAMPAIGN_ERROR_CODES } from '@/lib/drawings/campaign';
import {
  campaignEditorMessage,
  isCampaignEditorStoreError,
  isCampaignErrorCode,
  parseCampaignEditorForm,
  type CampaignEditorError,
  type CampaignEditorFieldError,
} from '@/lib/drawings/campaign-editor';
import { activateCampaign, closeCampaign, createCampaign, updateCampaign } from '@/lib/drawings/campaign-store';
import {
  drawingsAdminActionsEnabled,
  drawingsCampaignEditorEnabled,
  drawingsFulfillmentActionsEnabled,
} from '@/lib/drawings/flag';
import { formatDrawingDollars, loadFulfillmentBudget } from '@/lib/drawings/admin-read-model';
import {
  drawingFulfillmentActionMessage,
  isDrawingFulfillmentStoreError,
  parseFulfillmentDollars,
  projectedOverAllowance,
  readFulfillmentNote,
  type DrawingFulfillmentActionError,
} from '@/lib/drawings/fulfillment-admin-actions';
import { createFulfillments, transitionFulfillment } from '@/lib/drawings/fulfillment-store';
import { runSimulatedSelection } from '@/lib/drawings/selection-store';
import { parseUuid } from '@/lib/uuid';

export type DrawingAdminActionResult =
  | { ok: true }
  | { ok: false; error: DrawingAdminActionError; message: string };

type Ready = { ok: true; userId: string; campaignId: string };
type Denied = Exclude<DrawingAdminActionResult, { ok: true }>;

function fail(error: DrawingAdminActionError): Denied {
  return { ok: false, error, message: drawingAdminActionMessage(error) };
}

/**
 * Both flags, then the admin role, then MFA. A miss returns before any
 * drawing store call. Identity comes from the session, not the client.
 */
async function ready(campaignId: string): Promise<Ready | Denied> {
  if (!drawingsAdminActionsEnabled()) return fail('disabled');
  const auth = await assertAdmin();
  if (!auth.ok) {
    if (auth.code === 'unauthenticated' || auth.code === 'not_admin') return fail('forbidden');
    return fail(auth.code);
  }
  if (typeof campaignId !== 'string') return fail('not_found');
  const id = parseUuid(campaignId);
  if (!id) return fail('not_found');
  return { ok: true, userId: auth.userId, campaignId: id };
}

const CAMPAIGN_SETUP_CODES: ReadonlySet<string> = new Set(CAMPAIGN_ERROR_CODES);

/**
 * A store code in `error` or `errors` wins. An `errors` array that has a
 * campaign setup code and no store code is `campaign_invalid`. An empty
 * list, an unrecognized code, or no code is `unavailable`. The caller maps a throw.
 */
function storeCode(
  result: { error?: string; errors?: readonly string[] },
): DrawingStoreError | 'campaign_invalid' {
  const found: string[] = [];
  if (typeof result.error === 'string') found.push(result.error);
  if (Array.isArray(result.errors)) found.push(...result.errors);
  for (const code of found) {
    if (isDrawingStoreError(code)) return code;
  }
  if (Array.isArray(result.errors) && result.errors.some((code) => CAMPAIGN_SETUP_CODES.has(code))) {
    return 'campaign_invalid';
  }
  return 'unavailable';
}

function finish(result: { ok: true } | { ok: false; error?: string; errors?: readonly string[] }): DrawingAdminActionResult {
  if (result.ok) {
    revalidatePath('/admin/drawings');
    return { ok: true };
  }
  return fail(storeCode(result));
}

/** Activates one sample draft. The store rejects a live draft and a closed window. */
export async function activateCampaignAction(campaignId: string): Promise<DrawingAdminActionResult> {
  const prepared = await ready(campaignId);
  if (!prepared.ok) return prepared;
  try {
    return finish(await activateCampaign(prepared.campaignId));
  } catch {
    return fail('unavailable');
  }
}

/** Closes a draft or an active campaign. A second close is invalid_transition. */
export async function closeCampaignAction(campaignId: string): Promise<DrawingAdminActionResult> {
  const prepared = await ready(campaignId);
  if (!prepared.ok) return prepared;
  try {
    return finish(await closeCampaign(prepared.campaignId));
  } catch {
    return fail('unavailable');
  }
}

/**
 * One simulated selection. run_by is admin: plus the first 8 characters
 * of the admin user id. A second call returns the store's already_selected
 * gate. No member is contacted.
 */
export async function runSelectionAction(campaignId: string): Promise<DrawingAdminActionResult> {
  const prepared = await ready(campaignId);
  if (!prepared.ok) return prepared;
  const runBy = drawingAdminRunByLabel(prepared.userId);
  if (!runBy) return fail('invalid_run_by');
  try {
    return finish(await runSimulatedSelection(prepared.campaignId, runBy));
  } catch {
    return fail('unavailable');
  }
}

export type DrawingFulfillmentActionResult =
  | { ok: true }
  | { ok: false; error: DrawingFulfillmentActionError; message: string };

type FulfillmentDenied = Exclude<DrawingFulfillmentActionResult, { ok: true }>;

function failFulfillment(
  error: Exclude<DrawingFulfillmentActionError, 'over_allowance_confirm'>,
): FulfillmentDenied {
  return { ok: false, error, message: drawingFulfillmentActionMessage(error) };
}

/**
 * All three flags, then the admin role, then MFA. A miss returns before
 * any fulfillment read or store call. Identity comes from the session.
 */
async function fulfillmentAuth(): Promise<{ ok: true; userId: string } | FulfillmentDenied> {
  if (!drawingsFulfillmentActionsEnabled()) return failFulfillment('disabled');
  const auth = await assertAdmin();
  if (!auth.ok) {
    if (auth.code === 'unauthenticated' || auth.code === 'not_admin') return failFulfillment('forbidden');
    return failFulfillment(auth.code);
  }
  return { ok: true, userId: auth.userId };
}

function overAllowanceMessage(recordedCostCents: number, newCostCents: number, allowanceCents: number): string {
  return `This cost puts recorded cost above the fulfillment allowance (recorded ${formatDrawingDollars(recordedCostCents)} + this ${formatDrawingDollars(newCostCents)} > allowance ${formatDrawingDollars(allowanceCents)}). Click again to record it anyway.`;
}

/**
 * One fulfillment row per winner of a simulated selection.
 * run_by is admin: plus the first 8 characters of the admin user id.
 * A second call returns the same rows. The store inserts nothing the second time.
 * No member is contacted.
 */
export async function createDrawingFulfillmentsAction(
  selectionId: string,
): Promise<DrawingFulfillmentActionResult> {
  const auth = await fulfillmentAuth();
  if (!auth.ok) return auth;
  const id = typeof selectionId === 'string' ? parseUuid(selectionId) : null;
  if (!id) return failFulfillment('not_found');
  const runBy = drawingAdminRunByLabel(auth.userId);
  if (!runBy) return failFulfillment('invalid_run_by');
  try {
    const result = await createFulfillments(id, runBy);
    if (!result.ok) {
      return failFulfillment(isDrawingFulfillmentStoreError(result.error) ? result.error : 'unavailable');
    }
    revalidatePath('/admin/drawings');
    return { ok: true };
  } catch {
    return failFulfillment('unavailable');
  }
}

export type TransitionDrawingFulfillmentInput = {
  fulfillmentId: string;
  toStatus: string;
  note?: string | null;
  /**
   * Dollar text from the form, such as "12.50" or "0.00".
   * Parsed to integer cents for the store. Ignored unless the move is fulfilled.
   */
  actualCostDollars?: string | null;
  confirmOverAllowance?: boolean;
};

/**
 * Moves one sample fulfillment. A deleted member (no user_profiles row
 * for the winner) can only be forfeited. ready and fulfilled return
 * invalid_transition before a cost is parsed, before the allowance
 * check, and before transitionFulfillment. A failed profile read is
 * unavailable. A cost is sent only for fulfilled, and only after a bad
 * edge, a bad dollar amount, a long note, and an unconfirmed
 * over-allowance warning have all been rejected. The allowance is
 * fulfillment_allowance_cents. Equal to the allowance is not a warning.
 * No member is contacted, and a forfeit does not pick a new winner.
 */
export async function transitionDrawingFulfillmentAction(
  input: TransitionDrawingFulfillmentInput,
): Promise<DrawingFulfillmentActionResult> {
  const auth = await fulfillmentAuth();
  if (!auth.ok) return auth;
  const rawId = input && typeof input === 'object' ? input.fulfillmentId : undefined;
  const fulfillmentId = typeof rawId === 'string' ? parseUuid(rawId) : null;
  if (!fulfillmentId) return failFulfillment('not_found');
  const actor = drawingAdminRunByLabel(auth.userId);
  if (!actor) return failFulfillment('invalid_actor');
  const toStatus = input && typeof input === 'object' && typeof input.toStatus === 'string' ? input.toStatus : '';
  if (toStatus !== 'ready' && toStatus !== 'fulfilled' && toStatus !== 'forfeited') {
    return failFulfillment('invalid_transition');
  }

  let budget: Awaited<ReturnType<typeof loadFulfillmentBudget>>;
  try {
    budget = await loadFulfillmentBudget(fulfillmentId);
  } catch {
    return failFulfillment('unavailable');
  }
  if (!budget.ok) return failFulfillment(budget.error);
  if (budget.memberDeleted && (toStatus === 'ready' || toStatus === 'fulfilled')) {
    return failFulfillment('invalid_transition');
  }
  const allowed =
    (budget.status === 'pending' && (toStatus === 'ready' || toStatus === 'forfeited')) ||
    (budget.status === 'ready' && (toStatus === 'fulfilled' || toStatus === 'forfeited'));
  if (!allowed) return failFulfillment('invalid_transition');

  let cents: number | null = null;
  if (toStatus === 'fulfilled') {
    const parsed = parseFulfillmentDollars(input.actualCostDollars);
    if (!parsed.ok) return failFulfillment(parsed.reason);
    cents = parsed.cents;
  }
  const note = readFulfillmentNote(input.note);
  if (!note.ok) return failFulfillment(note.error);

  if (toStatus === 'fulfilled' && cents !== null) {
    const over = projectedOverAllowance({
      recordedCostCents: budget.recordedCostCents,
      newCostCents: cents,
      allowanceCents: budget.allowanceCents,
    });
    if (over && input.confirmOverAllowance !== true) {
      return {
        ok: false,
        error: 'over_allowance_confirm',
        message: overAllowanceMessage(budget.recordedCostCents, cents, budget.allowanceCents),
      };
    }
  }

  try {
    const result = await transitionFulfillment(
      fulfillmentId,
      toStatus,
      actor,
      toStatus === 'fulfilled' ? { note: note.note, actualCostCents: cents } : { note: note.note },
    );
    if (!result.ok) {
      return failFulfillment(isDrawingFulfillmentStoreError(result.error) ? result.error : 'unavailable');
    }
    revalidatePath('/admin/drawings');
    return { ok: true };
  } catch {
    return failFulfillment('unavailable');
  }
}

export type DrawingCampaignEditorResult =
  | { ok: true }
  | {
      ok: false;
      error: CampaignEditorError;
      message: string;
      fieldErrors?: CampaignEditorFieldError[];
    };

type EditorDenied = Exclude<DrawingCampaignEditorResult, { ok: true }>;

function failEditor(error: CampaignEditorError): EditorDenied {
  return { ok: false, error, message: campaignEditorMessage(error) };
}

/**
 * All three flags, then the admin role, then MFA. A miss returns before
 * the form is parsed and before any campaign store call.
 */
async function editorAuth(): Promise<{ ok: true } | EditorDenied> {
  if (!drawingsCampaignEditorEnabled()) return failEditor('disabled');
  const auth = await assertAdmin();
  if (!auth.ok) {
    if (auth.code === 'unauthenticated' || auth.code === 'not_admin') return failEditor('forbidden');
    return failEditor(auth.code);
  }
  return { ok: true };
}

function fieldFailure(fieldErrors: CampaignEditorFieldError[]): EditorDenied {
  return {
    ok: false,
    error: 'invalid_form',
    message: fieldErrors[0]?.message ?? campaignEditorMessage('invalid_form'),
    fieldErrors,
  };
}

function editorStoreFailure(result: { error?: string; errors?: readonly string[] }): EditorDenied {
  if (typeof result.error === 'string') {
    return failEditor(isCampaignEditorStoreError(result.error) ? result.error : 'unavailable');
  }
  const known = Array.isArray(result.errors) ? result.errors.filter(isCampaignErrorCode) : [];
  if (known.length === 0) return failEditor('unavailable');
  const primary = known.includes('over_budget') ? 'over_budget' : known[0];
  return failEditor(primary);
}

/**
 * Saves one draft sample campaign. Mode, the rules-version token, and the
 * entry source are fixed by the parser. The store derives starts_at and
 * ends_at from the quarter. A rejected draft does not write.
 */
export async function createDrawingCampaignAction(formInput: unknown): Promise<DrawingCampaignEditorResult> {
  const auth = await editorAuth();
  if (!auth.ok) return auth;
  const parsed = parseCampaignEditorForm(formInput);
  if (!parsed.ok) return fieldFailure(parsed.fieldErrors);
  try {
    const result = await createCampaign(parsed.draft);
    if (!result.ok) return editorStoreFailure(result);
    revalidatePath('/admin/drawings');
    return { ok: true };
  } catch {
    return failEditor('unavailable');
  }
}

/**
 * Replaces one draft. An active or closed id returns campaign_locked from
 * the store and does not write. The id is the stored campaign id.
 */
export async function updateDrawingCampaignAction(
  id: string,
  formInput: unknown,
): Promise<DrawingCampaignEditorResult> {
  const auth = await editorAuth();
  if (!auth.ok) return auth;
  const campaignId = typeof id === 'string' ? parseUuid(id) : null;
  if (!campaignId) return failEditor('not_found');
  const parsed = parseCampaignEditorForm(formInput);
  if (!parsed.ok) return fieldFailure(parsed.fieldErrors);
  try {
    const result = await updateCampaign(campaignId, parsed.draft);
    if (!result.ok) return editorStoreFailure(result);
    revalidatePath('/admin/drawings');
    return { ok: true };
  } catch {
    return failEditor('unavailable');
  }
}
