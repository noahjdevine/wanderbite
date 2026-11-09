import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn();
const createSupabaseVisitProblemStore = vi.fn();
const assertAdmin = vi.fn();
const getSupabaseAdmin = vi.fn();
const reviewVisitProblemCase = vi.fn();

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

vi.mock('@/lib/boost/visit-problem-store', () => ({
  createSupabaseVisitProblemStore: (...args: unknown[]) => createSupabaseVisitProblemStore(...args),
  reviewVisitProblemCase: (...args: unknown[]) => reviewVisitProblemCase(...args),
  parseVisitProblemCaseRow: (value: {
    id: string;
    user_id: string;
    challenge_item_id: string;
    redemption_id: string | null;
    category: string;
    explanation: string;
    status: string;
    member_response: string | null;
    resolved_at: string | null;
    created_at: string;
    updated_at: string;
  } | null) => value,
}));

vi.mock('@/lib/auth/assert-admin', () => ({
  assertAdmin: (...args: unknown[]) => assertAdmin(...args),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: (...args: unknown[]) => getSupabaseAdmin(...args),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { getOwnVisitProblem, submitVisitProblem } from '@/app/actions/visit-problems';
import { reviewVisitProblem } from '@/app/(site)/admin/visit-problem-actions';

const ITEM = '44444444-4444-4444-8444-444444444444';
const CASE = '55555555-5555-4555-8555-555555555555';

function caseQuery(row: Record<string, unknown> | null) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
  };
  return query;
}

describe('visit problem actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.E07_VISIT_PROBLEMS_ENABLED;
  });

  it('returns disabled before auth or a table read when the flag is off', async () => {
    await expect(
      submitVisitProblem({
        challengeItemId: ITEM,
        category: 'other',
        explanation: 'The visit had a problem.',
      }),
    ).resolves.toEqual({ ok: false, code: 'disabled' });
    await expect(getOwnVisitProblem(ITEM)).resolves.toEqual({ ok: false, code: 'disabled' });
    await expect(
      reviewVisitProblem({
        caseId: CASE,
        status: 'resolved',
        memberResponse: 'We reviewed it.',
        reason: 'Noted.',
      }),
    ).resolves.toEqual({ ok: false, code: 'disabled' });
    expect(requireUser).not.toHaveBeenCalled();
    expect(assertAdmin).not.toHaveBeenCalled();
    expect(createSupabaseVisitProblemStore).not.toHaveBeenCalled();
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
    expect(reviewVisitProblemCase).not.toHaveBeenCalled();
  });

  it('does not read a case for a signed-out member when the flag is on', async () => {
    process.env.E07_VISIT_PROBLEMS_ENABLED = 'true';
    requireUser.mockResolvedValue({ ok: false, error: 'Sign in.' });
    await expect(getOwnVisitProblem(ITEM)).resolves.toEqual({ ok: false, code: 'forbidden' });
    expect(createSupabaseVisitProblemStore).not.toHaveBeenCalled();
  });

  it('does not let a non-admin review a case', async () => {
    process.env.E07_VISIT_PROBLEMS_ENABLED = 'true';
    assertAdmin.mockResolvedValue({ ok: false, error: 'Unauthorized', code: 'not_admin' });
    await expect(
      reviewVisitProblem({
        caseId: CASE,
        status: 'under_review',
        memberResponse: '',
        reason: 'Looking.',
      }),
    ).resolves.toEqual({ ok: false, code: 'forbidden' });
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
    expect(reviewVisitProblemCase).not.toHaveBeenCalled();
  });

  it('does not call the review function without a member-visible resolution', async () => {
    process.env.E07_VISIT_PROBLEMS_ENABLED = 'true';
    assertAdmin.mockResolvedValue({ ok: true, userId: 'admin-1', email: 'admin@example.com' });
    getSupabaseAdmin.mockReturnValue({
      from: () =>
        caseQuery({
          id: CASE,
          user_id: 'member-1',
          challenge_item_id: ITEM,
          redemption_id: null,
          category: 'other',
          explanation: 'Original submission.',
          status: 'submitted',
          member_response: null,
          resolved_at: null,
          created_at: '2026-11-09T01:00:00.000Z',
          updated_at: '2026-11-09T01:00:00.000Z',
        }),
    });
    await expect(
      reviewVisitProblem({
        caseId: CASE,
        status: 'resolved',
        memberResponse: '   ',
        reason: 'Need an explanation.',
      }),
    ).resolves.toEqual({ ok: false, code: 'explanation_required' });
    expect(reviewVisitProblemCase).not.toHaveBeenCalled();
  });

  it('audits the signed-in admin and keeps the caller from choosing the actor', async () => {
    process.env.E07_VISIT_PROBLEMS_ENABLED = 'true';
    assertAdmin.mockResolvedValue({ ok: true, userId: 'admin-1', email: 'admin@example.com' });
    getSupabaseAdmin.mockReturnValue({
      from: () =>
        caseQuery({
          id: CASE,
          user_id: 'member-1',
          challenge_item_id: ITEM,
          redemption_id: null,
          category: 'offer_refused',
          explanation: 'Original submission.',
          status: 'under_review',
          member_response: null,
          resolved_at: null,
          created_at: '2026-11-09T01:00:00.000Z',
          updated_at: '2026-11-09T01:00:00.000Z',
        }),
    });
    reviewVisitProblemCase.mockResolvedValue({
      ok: true,
      status: 'resolved',
      memberResponse: 'The offer stood as shown.',
    });
    await expect(
      reviewVisitProblem({
        caseId: CASE,
        status: 'resolved',
        memberResponse: 'The offer stood as shown.',
        reason: 'No correction in this slice.',
      }),
    ).resolves.toEqual({ ok: true });
    expect(reviewVisitProblemCase).toHaveBeenCalledWith({
      caseId: CASE,
      actorUserId: 'admin-1',
      status: 'resolved',
      memberResponse: 'The offer stood as shown.',
      reason: 'No correction in this slice.',
    });
  });
});
