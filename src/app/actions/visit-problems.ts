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
  readOwnedMakeupRedemption,
  type OwnedMakeupRedemption,
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

const MAKEUP_START_RETRY = "We couldn't start that visit. Please try again.";

function makeupMessage(detail: string | null): string {
  if (detail === 'restaurant') return MAKEUP_RESTAURANT_CLOSED;
  if (detail === 'window') return MAKEUP_WINDOW_CLOSED;
  return MAKEUP_OFFER_CLOSED;
}

/**
 * Issued and verified rows can be linked as stored, including a code whose
 * expires_at has passed. use_visit_problem_opportunity accepts those statuses
 * and refuses expired, which still has to be rotated in place by redeem.
 */
function linkableMakeupCode(
  redemption: OwnedMakeupRedemption | null,
): { redemptionId: string; expiresAt: string } | null {
  if (!redemption) return null;
  if (redemption.status !== 'issued' && redemption.status !== 'verified') return null;
  return { redemptionId: redemption.id, expiresAt: redemption.expiresAt };
}

/**
 * Start the make-up visit through the existing code path.
 * Unset E07_VISIT_PROBLEMS_ENABLED returns disabled before any read.
 * The original deadline is copied, not extended. A second use is refused.
 * A code already on this make-up item is linked and the spot is marked used.
 * That retry does not issue a second code.
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
    return { ok: false, code: 'unavailable', message: MAKEUP_START_RETRY };
  }

  const found = await readOwnedMakeupRedemption({
    userId: auth.userId,
    challengeItemId: opened.challengeItemId,
  });
  if (!found.ok) {
    return { ok: false, code: 'unavailable', message: MAKEUP_START_RETRY };
  }

  const linked = linkableMakeupCode(found.redemption);
  let redemptionId: string;
  let expiresAt: string;
  if (linked) {
    redemptionId = linked.redemptionId;
    expiresAt = linked.expiresAt;
  } else {
    const redeemed = await redeemChallengeItem(opened.challengeItemId);
    if (!redeemed.ok) {
      return { ok: false, code: 'unavailable', message: redeemed.error };
    }
    redemptionId = redeemed.data.redemptionId;
    expiresAt = redeemed.data.expiresAt;
  }

  const used = await markMakeupVisitUsed({
    opportunityId: id,
    userId: auth.userId,
    redemptionId,
  });
  if (!used.ok) {
    if (used.code === 'already_used') {
      return { ok: false, code: 'already_used', message: 'This extra visit is already used.' };
    }
    return { ok: false, code: 'unavailable', message: MAKEUP_START_RETRY };
  }

  return { ok: true, redemptionId, expiresAt };
}
