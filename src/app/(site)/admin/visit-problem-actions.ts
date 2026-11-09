'use server';

import { revalidatePath } from 'next/cache';
import { assertAdmin } from '@/lib/auth/assert-admin';
import { visitProblemsEnabled } from '@/lib/boost/flag';
import { decideVisitProblemReview } from '@/lib/boost/visit-problem';
import { parseVisitProblemCaseRow, reviewVisitProblemCase } from '@/lib/boost/visit-problem-store';
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
