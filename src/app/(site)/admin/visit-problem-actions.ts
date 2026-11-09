'use server';

import { revalidatePath } from 'next/cache';
import { assertAdmin } from '@/lib/auth/assert-admin';
import { visitProblemsEnabled } from '@/lib/boost/flag';
import { decideRestoreCorrection, decideSavingsCorrection, decideVisitProblemReview } from '@/lib/boost/visit-problem';
import {
  correctVisitProblemSavings,
  parseVisitProblemCaseRow,
  restoreVisitProblemOpportunity,
  reviewVisitProblemCase,
} from '@/lib/boost/visit-problem-store';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { parseUuid } from '@/lib/uuid';

export type ReviewVisitProblemResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'disabled'
        | 'forbidden'
        | 'not_admin'
        | 'not_found'
        | 'terminal'
        | 'invalid_reason'
        | 'invalid_status'
        | 'invalid_response'
        | 'explanation_required'
        | 'unchanged'
        | 'unavailable'
        | 'mfa_enroll'
        | 'mfa_challenge'
        | 'auth_error'
        | 'role_lookup_failed';
    };

export type CorrectVisitProblemResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'disabled'
        | 'forbidden'
        | 'not_admin'
        | 'not_found'
        | 'terminal'
        | 'not_allowed'
        | 'invalid_reason'
        | 'invalid_amount'
        | 'already_applied'
        | 'no_redemption'
        | 'not_verified'
        | 'unavailable'
        | 'mfa_enroll'
        | 'mfa_challenge'
        | 'auth_error'
        | 'role_lookup_failed';
    };

/**
 * Admin review of one member visit problem.
 * Unset E07_VISIT_PROBLEMS_ENABLED returns disabled before any read.
 * The actor is the signed-in admin. The reason is stored in the audit log
 * and is not returned to the member.
 */
export async function reviewVisitProblem(input: {
  caseId: string;
  status: string;
  memberResponse: string;
  reason: string;
}): Promise<ReviewVisitProblemResult> {
  if (!visitProblemsEnabled()) return { ok: false, code: 'disabled' };
  const auth = await assertAdmin();
  if (!auth.ok) {
    if (auth.code === 'not_admin' || auth.code === 'unauthenticated') {
      return { ok: false, code: 'forbidden' };
    }
    return { ok: false, code: auth.code };
  }

  const caseId = parseUuid(input?.caseId);
  if (!caseId) return { ok: false, code: 'not_found' };

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('visit_problem_cases')
    .select(
      'id, user_id, challenge_item_id, redemption_id, category, explanation, status, member_response, resolved_at, created_at, updated_at',
    )
    .eq('id', caseId)
    .maybeSingle();
  if (error) return { ok: false, code: 'unavailable' };
  const current = parseVisitProblemCaseRow(data);
  if (!current) return { ok: false, code: 'not_found' };

  const decision = decideVisitProblemReview({
    currentStatus: current.status,
    currentResponse: current.member_response,
    nextStatus: input.status,
    memberResponse: input.memberResponse,
    reason: input.reason,
  });
  if (!decision.ok) return decision;

  const reviewed = await reviewVisitProblemCase({
    caseId,
    actorUserId: auth.userId,
    status: decision.status,
    memberResponse: decision.memberResponse,
    reason: decision.reason,
  });
  if (!reviewed.ok) return reviewed;
  revalidatePath('/admin/visit-problems');
  return { ok: true };
}

async function adminActor(): Promise<
  { ok: true; userId: string } | Exclude<CorrectVisitProblemResult, { ok: true }>
> {
  const auth = await assertAdmin();
  if (!auth.ok) {
    if (auth.code === 'not_admin' || auth.code === 'unauthenticated') {
      return { ok: false, code: 'forbidden' };
    }
    return { ok: false, code: auth.code };
  }
  return { ok: true, userId: auth.userId };
}

/**
 * Correct the savings Progress shows for one open visit problem.
 * The actor is the signed-in admin. The original settlement is not rewritten.
 */
export async function correctVisitSavings(input: {
  caseId: string;
  correctedCents: string;
  reason: string;
}): Promise<CorrectVisitProblemResult> {
  if (!visitProblemsEnabled()) return { ok: false, code: 'disabled' };
  const auth = await adminActor();
  if (!auth.ok) return auth;

  const caseId = parseUuid(input?.caseId);
  if (!caseId) return { ok: false, code: 'not_found' };
  const current = await loadOpenCase(caseId);
  if (!current.ok) return current;

  const decision = decideSavingsCorrection({
    category: current.row.category,
    status: current.row.status,
    correctedCents: input.correctedCents,
    reason: input.reason,
  });
  if (!decision.ok) return decision;

  const corrected = await correctVisitProblemSavings({
    caseId,
    actorUserId: auth.userId,
    correctedCents: decision.correctedCents,
    reason: decision.reason,
  });
  if (!corrected.ok) return corrected;
  revalidatePath('/admin/visit-problems');
  revalidatePath('/journey');
  revalidatePath('/challenges');
  return { ok: true };
}

/**
 * Grant one make-up challenge opportunity for an open visit problem.
 * The original visit stays recorded. Partners have no path to this action.
 */
export async function restoreVisitOpportunity(input: {
  caseId: string;
  reason: string;
}): Promise<CorrectVisitProblemResult> {
  if (!visitProblemsEnabled()) return { ok: false, code: 'disabled' };
  const auth = await adminActor();
  if (!auth.ok) return auth;

  const caseId = parseUuid(input?.caseId);
  if (!caseId) return { ok: false, code: 'not_found' };
  const current = await loadOpenCase(caseId);
  if (!current.ok) return current;

  const decision = decideRestoreCorrection({
    category: current.row.category,
    status: current.row.status,
    reason: input.reason,
  });
  if (!decision.ok) return decision;

  const restored = await restoreVisitProblemOpportunity({
    caseId,
    actorUserId: auth.userId,
    reason: decision.reason,
  });
  if (!restored.ok) return restored;
  revalidatePath('/admin/visit-problems');
  revalidatePath('/challenges');
  return { ok: true };
}

async function loadOpenCase(caseId: string): Promise<
  | { ok: true; row: NonNullable<ReturnType<typeof parseVisitProblemCaseRow>> }
  | { ok: false; code: 'not_found' | 'unavailable' }
> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('visit_problem_cases')
    .select(
      'id, user_id, challenge_item_id, redemption_id, category, explanation, status, member_response, resolved_at, created_at, updated_at',
    )
    .eq('id', caseId)
    .maybeSingle();
  if (error) return { ok: false, code: 'unavailable' };
  const row = parseVisitProblemCaseRow(data);
  if (!row) return { ok: false, code: 'not_found' };
  return { ok: true, row };
}
