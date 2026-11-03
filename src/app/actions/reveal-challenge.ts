'use server';

import { revealMonthlyChallengeForUser, type RevealBriefInput, type RevealChallengeResult } from '@/lib/challenges/reveal';
import { requireUser } from '@/lib/auth/require-user';

export type { RevealBriefInput, RevealChallengeResult };

/** Member identity comes from the session. Restaurant ids are not a parameter. */
export async function revealMonthlyChallenge(
  brief: RevealBriefInput,
): Promise<RevealChallengeResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error, reason: 'unauthenticated' };
  return revealMonthlyChallengeForUser(auth.userId, brief);
}
