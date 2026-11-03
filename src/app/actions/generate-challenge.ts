'use server';

import {
  generateMonthlyChallengeForUser,
  getCurrentChallengeForUser,
} from '@/lib/challenges/generate';
import { memberGenerateBlocked, revealInsteadError } from '@/lib/challenges/load-monthly-reveal';
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
  // Cron calls generateMonthlyChallengeForUser directly and is left alone.
  // This member action is the auto path the flag closes. A concurrent cron
  // and reveal still share the profile lock plus unique (user_id, cycle_month)
  // and unique (user_id, period_key) from the #78 RPCs.
  if (await memberGenerateBlocked()) {
    return { ok: false, error: revealInsteadError(), reason: 'monthly_reveal' };
  }
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
