'use server';

import {
  generateMonthlyChallengeForUser,
  getCurrentChallengeForUser,
} from '@/lib/challenges/generate';
import { requireUser } from '@/lib/auth/require-user';

export type {
  GeneratedChallenge,
  GeneratedChallengeItem,
  GenerateChallengeResult,
  GenerateFailureReason,
} from '@/lib/challenges/generate';

import type { GenerateChallengeResult, GeneratedChallenge } from '@/lib/challenges/generate';

export async function generateMonthlyChallenge(): Promise<GenerateChallengeResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error, reason: 'unauthenticated' };
  return generateMonthlyChallengeForUser(auth.userId);
}

export async function getCurrentChallenge(): Promise<GeneratedChallenge | null> {
  const auth = await requireUser();
  if (!auth.ok) return null;
  return getCurrentChallengeForUser(auth.userId);
}
