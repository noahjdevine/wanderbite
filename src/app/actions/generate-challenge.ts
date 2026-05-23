'use server';

import {
  generateMonthlyChallenge as generateMonthlyChallengeImpl,
  getCurrentChallenge as getCurrentChallengeImpl,
} from '@/lib/challenges/generate';

export type {
  GeneratedChallenge,
  GeneratedChallengeItem,
  GenerateChallengeResult,
} from '@/lib/challenges/generate';

export async function generateMonthlyChallenge(userId: string, marketId: string) {
  return generateMonthlyChallengeImpl(userId, marketId);
}

export async function getCurrentChallenge(userId: string) {
  return getCurrentChallengeImpl(userId);
}
