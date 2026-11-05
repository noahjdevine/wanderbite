'use server';

import { revalidatePath } from 'next/cache';
import { assertAdmin } from '@/lib/auth/assert-admin';
import { contentReviewStore } from '@/lib/content-pipeline/review-db';
import {
  approveActivitySummary as approveActivitySummaryDraft,
  approveOpenException,
  editActivitySummary as editActivitySummaryDraft,
  editOpenException,
  rejectActivitySummary as rejectActivitySummaryDraft,
  rejectOpenException,
  rollbackRecipeDescription,
  setContentSourceRunning,
  type ContentActionResult,
} from '@/lib/content-pipeline/review';
import { parseUuid } from '@/lib/uuid';

async function gate(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const auth = await assertAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  return { ok: true, userId: auth.userId };
}

function refresh() {
  revalidatePath('/admin/content');
  revalidatePath('/admin');
}

export async function approveContentException(exceptionId: string): Promise<ContentActionResult> {
  const auth = await gate();
  if (!auth.ok) return auth;
  const id = parseUuid(exceptionId);
  if (!id) return { ok: false, error: 'Exception not found.' };
  const result = await approveOpenException(contentReviewStore(), {
    exceptionId: id,
    adminId: auth.userId,
  });
  if (result.ok) refresh();
  return result;
}

export async function editContentException(
  exceptionId: string,
  description: string,
): Promise<ContentActionResult> {
  const auth = await gate();
  if (!auth.ok) return auth;
  const id = parseUuid(exceptionId);
  if (!id) return { ok: false, error: 'Exception not found.' };
  const result = await editOpenException(contentReviewStore(), {
    exceptionId: id,
    adminId: auth.userId,
    description,
  });
  if (result.ok) refresh();
  return result;
}

export async function approveActivitySummary(factId: string): Promise<ContentActionResult> {
  const auth = await gate();
  if (!auth.ok) return auth;
  const id = parseUuid(factId);
  if (!id) return { ok: false, error: 'Summary draft not found.' };
  const result = await approveActivitySummaryDraft(contentReviewStore(), {
    factId: id,
    adminId: auth.userId,
  });
  if (result.ok) refresh();
  return result;
}

export async function editActivitySummary(factId: string, text: string): Promise<ContentActionResult> {
  const auth = await gate();
  if (!auth.ok) return auth;
  const id = parseUuid(factId);
  if (!id) return { ok: false, error: 'Summary draft not found.' };
  const result = await editActivitySummaryDraft(contentReviewStore(), {
    factId: id,
    adminId: auth.userId,
    text,
  });
  if (result.ok) refresh();
  return result;
}

export async function rejectActivitySummary(factId: string): Promise<ContentActionResult> {
  const auth = await gate();
  if (!auth.ok) return auth;
  const id = parseUuid(factId);
  if (!id) return { ok: false, error: 'Summary draft not found.' };
  const result = await rejectActivitySummaryDraft(contentReviewStore(), {
    factId: id,
    adminId: auth.userId,
  });
  if (result.ok) refresh();
  return result;
}

export async function rejectContentException(exceptionId: string): Promise<ContentActionResult> {
  const auth = await gate();
  if (!auth.ok) return auth;
  const id = parseUuid(exceptionId);
  if (!id) return { ok: false, error: 'Exception not found.' };
  const result = await rejectOpenException(contentReviewStore(), {
    exceptionId: id,
    adminId: auth.userId,
  });
  if (result.ok) refresh();
  return result;
}

export async function rollbackContentRecipe(recipeId: string): Promise<ContentActionResult> {
  const auth = await gate();
  if (!auth.ok) return auth;
  const id = parseUuid(recipeId);
  if (!id) return { ok: false, error: 'Recipe not found.' };
  const result = await rollbackRecipeDescription(contentReviewStore(), {
    recipeId: id,
    adminId: auth.userId,
  });
  if (result.ok) refresh();
  return result;
}

export async function setContentSourceStatus(
  sourceId: string,
  status: string,
): Promise<ContentActionResult> {
  const auth = await gate();
  if (!auth.ok) return auth;
  const id = parseUuid(sourceId);
  if (!id) return { ok: false, error: 'Source not found.' };
  if (status !== 'active' && status !== 'paused') {
    return { ok: false, error: 'Source status cannot change from this view.' };
  }
  const result = await setContentSourceRunning(contentReviewStore(), {
    sourceId: id,
    adminId: auth.userId,
    status,
  });
  if (result.ok) refresh();
  return result;
}
