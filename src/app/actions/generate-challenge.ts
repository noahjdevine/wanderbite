'use server';

import {
  generateMonthlyChallengeForUser,
  getCurrentChallengeForUser,
} from '@/lib/challenges/generate';
import { readWorkflowVersion } from '@/lib/challenges/workflow';
import { requireUser } from '@/lib/auth/require-user';

export type {
  GeneratedChallenge,
  GeneratedChallengeItem,
  GenerateChallengeResult,
  GenerateFailureReason,
} from '@/lib/challenges/generate';

import type { GenerateChallengeResult, GeneratedChallenge } from '@/lib/challenges/generate';

const CREDITS_PENDING_ERROR =
  'Your two credits are waiting. Restaurant selection is not open yet.';

export async function generateMonthlyChallenge(): Promise<GenerateChallengeResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error, reason: 'unauthenticated' };
  if ((await readWorkflowVersion(auth.userId)) === 'credits') {
    return { ok: false, error: CREDITS_PENDING_ERROR, reason: 'credits_pending' };
  }
  return generateMonthlyChallengeForUser(auth.userId);
}

export async function getCurrentChallenge(): Promise<GeneratedChallenge | null> {
  const auth = await requireUser();
  if (!auth.ok) return null;
  return getCurrentChallengeForUser(auth.userId);
}
