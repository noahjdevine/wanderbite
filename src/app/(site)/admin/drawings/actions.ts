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
import { activateCampaign, closeCampaign } from '@/lib/drawings/campaign-store';
import { drawingsAdminActionsEnabled } from '@/lib/drawings/flag';
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

function storeCode(result: { error?: string; errors?: readonly string[] }): DrawingStoreError | 'unavailable' {
  const found: string[] = [];
  if (typeof result.error === 'string') found.push(result.error);
  if (Array.isArray(result.errors)) found.push(...result.errors);
  for (const code of found) {
    if (isDrawingStoreError(code)) return code;
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
