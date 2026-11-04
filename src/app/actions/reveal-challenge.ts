'use server';

import { revealMonthlyChallengeForUser, type RevealBriefInput, type RevealChallengeResult } from '@/lib/challenges/reveal';
import { readWorkflowVersion } from '@/lib/challenges/workflow';
import { requireUser } from '@/lib/auth/require-user';

export type { RevealBriefInput, RevealChallengeResult };

const CREDITS_PENDING_ERROR =
  'Your two credits are waiting. Restaurant selection is not open yet.';

/** Member identity comes from the session. Restaurant ids are not a parameter. */
export async function revealMonthlyChallenge(
  brief: RevealBriefInput,
): Promise<RevealChallengeResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error, reason: 'unauthenticated' };
  if ((await readWorkflowVersion(auth.userId)) === 'credits') {
    return { ok: false, error: CREDITS_PENDING_ERROR, reason: 'credits_pending' };
  }
  return revealMonthlyChallengeForUser(auth.userId, brief);
}
