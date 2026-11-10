'use server';

import { requireUser } from '@/lib/auth/require-user';
import { visitProblemsEnabled } from '@/lib/boost/flag';
import {
  MAKEUP_OFFER_CLOSED,
  MAKEUP_RESTAURANT_CLOSED,
  MAKEUP_WINDOW_CLOSED,
  readOwnedVisitProblem,
  submitOwnedVisitProblem,
  type MemberVisitProblem,
  type SubmitVisitProblemCode,
  type VisitLookupCode,
} from '@/lib/boost/visit-problem';
import {
  createSupabaseVisitProblemStore,
  markMakeupVisitUsed,
  openMakeupVisitItem,
} from '@/lib/boost/visit-problem-store';
import { redeemChallengeItem } from '@/app/actions/redeem-challenge';
import { parseUuid } from '@/lib/uuid';

export type VisitProblemActionResult =
  | { ok: true; problem: MemberVisitProblem }
  | { ok: false; code: SubmitVisitProblemCode | 'disabled' };

export type OwnVisitProblemResult =
  | { ok: true; problem: MemberVisitProblem | null }
  | { ok: false; code: VisitLookupCode | 'disabled' };

function disabled(): { ok: false; code: 'disabled' } {
  return { ok: false, code: 'disabled' };
}

/**
 * File one open problem for the signed-in member's own visit.
 * Unset E07_VISIT_PROBLEMS_ENABLED returns disabled before any read.
 * A redemption code is not required. This does not change the visit.
 */
export async function submitVisitProblem(input: {
  challengeItemId: string;
  redemptionId?: string | null;
  category: string;
  explanation: string;
}): Promise<VisitProblemActionResult> {
  if (!visitProblemsEnabled()) return disabled();
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, code: 'forbidden' };

  const challengeItemId = parseUuid(input?.challengeItemId);
  if (!challengeItemId) return { ok: false, code: 'not_found' };
  let redemptionId: string | null = null;
  if (input.redemptionId != null && input.redemptionId !== '') {
    redemptionId = parseUuid(input.redemptionId);
    if (!redemptionId) return { ok: false, code: 'invalid_redemption' };
  }

  return submitOwnedVisitProblem(createSupabaseVisitProblemStore(), {
    userId: auth.userId,
    challengeItemId,
    redemptionId,
    category: input.category,
    explanation: input.explanation,
  });
}

/**
 * The signed-in member's current case for one of their visits.
 * Unset E07_VISIT_PROBLEMS_ENABLED returns disabled before any read.
 */
export async function getOwnVisitProblem(challengeItemId: string): Promise<OwnVisitProblemResult> {
  if (!visitProblemsEnabled()) return disabled();
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, code: 'forbidden' };
  const id = parseUuid(challengeItemId);
  if (!id) return { ok: false, code: 'not_found' };
  return readOwnedVisitProblem(createSupabaseVisitProblemStore(), {
    userId: auth.userId,
    challengeItemId: id,
  });
}

export type StartMakeupVisitResult =
  | { ok: true; redemptionId: string; expiresAt: string }
  | {
      ok: false;
      code: 'disabled' | 'forbidden' | 'not_found' | 'not_bookable' | 'already_used' | 'unavailable';
      message: string;
    };

function makeupMessage(detail: string | null): string {
  if (detail === 'restaurant') return MAKEUP_RESTAURANT_CLOSED;
  if (detail === 'window') return MAKEUP_WINDOW_CLOSED;
  return MAKEUP_OFFER_CLOSED;
}

/**
 * Start the make-up visit through the existing code path.
 * Unset E07_VISIT_PROBLEMS_ENABLED returns disabled before any read.
 * The original deadline is copied, not extended. A second use is refused.
 */
export async function startMakeupVisit(opportunityId: string): Promise<StartMakeupVisitResult> {
  if (!visitProblemsEnabled()) {
    return { ok: false, code: 'disabled', message: 'This visit is not available right now.' };
  }
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, code: 'forbidden', message: 'Sign in to use this visit.' };

  const id = parseUuid(opportunityId);
  if (!id) return { ok: false, code: 'not_found', message: 'That visit could not be found.' };

  const opened = await openMakeupVisitItem({ opportunityId: id, userId: auth.userId });
  if (!opened.ok) {
    if (opened.code === 'not_bookable') {
      return { ok: false, code: 'not_bookable', message: makeupMessage(opened.detail) };
    }
    if (opened.code === 'already_used') {
      return { ok: false, code: 'already_used', message: 'This extra visit is already used.' };
    }
    if (opened.code === 'forbidden') {
      return { ok: false, code: 'forbidden', message: 'That visit is not yours.' };
    }
    if (opened.code === 'not_found') {
      return { ok: false, code: 'not_found', message: 'That visit could not be found.' };
    }
    return { ok: false, code: 'unavailable', message: "We couldn't start that visit. Please try again." };
  }

  const redeemed = await redeemChallengeItem(opened.challengeItemId);
  if (!redeemed.ok) {
    return { ok: false, code: 'unavailable', message: redeemed.error };
  }

  const used = await markMakeupVisitUsed({
    opportunityId: id,
    userId: auth.userId,
    redemptionId: redeemed.data.redemptionId,
  });
  if (!used.ok && used.code !== 'already_used') {
    if (used.code !== 'unavailable') {
      return { ok: false, code: 'unavailable', message: "We couldn't start that visit. Please try again." };
    }
    return { ok: false, code: 'unavailable', message: "We couldn't start that visit. Please try again." };
  }
  if (!used.ok) {
    return { ok: false, code: 'already_used', message: 'This extra visit is already used.' };
  }

  return {
    ok: true,
    redemptionId: redeemed.data.redemptionId,
    expiresAt: redeemed.data.expiresAt,
  };
}
