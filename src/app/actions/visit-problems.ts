'use server';

import { requireUser } from '@/lib/auth/require-user';
import { visitProblemsEnabled } from '@/lib/boost/flag';
import {
  readOwnedVisitProblem,
  submitOwnedVisitProblem,
  type MemberVisitProblem,
  type SubmitVisitProblemCode,
  type VisitLookupCode,
} from '@/lib/boost/visit-problem';
import { createSupabaseVisitProblemStore } from '@/lib/boost/visit-problem-store';
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
