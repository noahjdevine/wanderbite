import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn();
const createSupabaseVisitProblemStore = vi.fn();
const assertAdmin = vi.fn();
const getSupabaseAdmin = vi.fn();
const reviewVisitProblemCase = vi.fn();
const correctVisitProblemSavings = vi.fn();
const restoreVisitProblemOpportunity = vi.fn();
const openMakeupVisitItem = vi.fn();
const markMakeupVisitUsed = vi.fn();
const redeemChallengeItem = vi.fn();

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

vi.mock('@/lib/boost/visit-problem-store', () => ({
  createSupabaseVisitProblemStore: (...args: unknown[]) => createSupabaseVisitProblemStore(...args),
  reviewVisitProblemCase: (...args: unknown[]) => reviewVisitProblemCase(...args),
  correctVisitProblemSavings: (...args: unknown[]) => correctVisitProblemSavings(...args),
  restoreVisitProblemOpportunity: (...args: unknown[]) => restoreVisitProblemOpportunity(...args),
  openMakeupVisitItem: (...args: unknown[]) => openMakeupVisitItem(...args),
  markMakeupVisitUsed: (...args: unknown[]) => markMakeupVisitUsed(...args),
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

vi.mock('@/app/actions/redeem-challenge', () => ({
  redeemChallengeItem: (...args: unknown[]) => redeemChallengeItem(...args),
}));

import { getOwnVisitProblem, startMakeupVisit, submitVisitProblem } from '@/app/actions/visit-problems';
import {
  correctVisitSavings,
  restoreVisitOpportunity,
  reviewVisitProblem,
} from '@/app/(site)/admin/visit-problem-actions';

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
    expect(correctVisitProblemSavings).not.toHaveBeenCalled();
    expect(restoreVisitProblemOpportunity).not.toHaveBeenCalled();
    expect(openMakeupVisitItem).not.toHaveBeenCalled();
    expect(markMakeupVisitUsed).not.toHaveBeenCalled();
    expect(redeemChallengeItem).not.toHaveBeenCalled();
  });

  it('does not start a make-up visit when the flag is off', async () => {
    await expect(startMakeupVisit(CASE)).resolves.toEqual({
      ok: false,
      code: 'disabled',
      message: 'This visit is not available right now.',
    });
    expect(requireUser).not.toHaveBeenCalled();
    expect(openMakeupVisitItem).not.toHaveBeenCalled();
    expect(markMakeupVisitUsed).not.toHaveBeenCalled();
    expect(redeemChallengeItem).not.toHaveBeenCalled();
  });

  it('starts a make-up visit through the existing code path and then marks it used', async () => {
    process.env.E07_VISIT_PROBLEMS_ENABLED = 'true';
    requireUser.mockResolvedValue({ ok: true, userId: 'member-1', email: 'member@example.com' });
    openMakeupVisitItem.mockResolvedValue({ ok: true, challengeItemId: ITEM });
    redeemChallengeItem.mockResolvedValue({
      ok: true,
      data: {
        token: 'WB-TEST',
        redeemedAt: '2026-11-09T18:00:00.000Z',
        redemptionId: '66666666-6666-4666-8666-666666666666',
        expiresAt: '2026-11-09T18:15:00.000Z',
      },
    });
    markMakeupVisitUsed.mockResolvedValue({ ok: true, alreadyApplied: false });
    await expect(startMakeupVisit(CASE)).resolves.toEqual({
      ok: true,
      redemptionId: '66666666-6666-4666-8666-666666666666',
      expiresAt: '2026-11-09T18:15:00.000Z',
    });
    expect(redeemChallengeItem).toHaveBeenCalledWith(ITEM);
    expect(markMakeupVisitUsed).toHaveBeenCalledWith({
      opportunityId: CASE,
      userId: 'member-1',
      redemptionId: '66666666-6666-4666-8666-666666666666',
    });
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

  it('does not correct savings for a partner or when the flag is off', async () => {
    await expect(
      correctVisitSavings({ caseId: CASE, correctedCents: '2500', reason: 'Fix the discount.' }),
    ).resolves.toEqual({ ok: false, code: 'disabled' });
    await expect(
      restoreVisitOpportunity({ caseId: CASE, reason: 'Grant a visit.' }),
    ).resolves.toEqual({ ok: false, code: 'disabled' });
    expect(assertAdmin).not.toHaveBeenCalled();
    expect(correctVisitProblemSavings).not.toHaveBeenCalled();
    expect(restoreVisitProblemOpportunity).not.toHaveBeenCalled();

    process.env.E07_VISIT_PROBLEMS_ENABLED = 'true';
    assertAdmin.mockResolvedValue({ ok: false, error: 'Unauthorized', code: 'not_admin' });
    await expect(
      correctVisitSavings({ caseId: CASE, correctedCents: '2500', reason: 'Fix the discount.' }),
    ).resolves.toEqual({ ok: false, code: 'forbidden' });
    await expect(
      restoreVisitOpportunity({ caseId: CASE, reason: 'Grant a visit.' }),
    ).resolves.toEqual({ ok: false, code: 'forbidden' });
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
    expect(correctVisitProblemSavings).not.toHaveBeenCalled();
    expect(restoreVisitProblemOpportunity).not.toHaveBeenCalled();
  });

  it('does not call a correction after the case is resolved or for the wrong category', async () => {
    process.env.E07_VISIT_PROBLEMS_ENABLED = 'true';
    assertAdmin.mockResolvedValue({ ok: true, userId: 'admin-1', email: 'admin@example.com' });
    getSupabaseAdmin.mockReturnValue({
      from: () =>
        caseQuery({
          id: CASE,
          user_id: 'member-1',
          challenge_item_id: ITEM,
          redemption_id: null,
          category: 'wrong_discount',
          explanation: 'The discount was short.',
          status: 'resolved',
          member_response: 'Closed.',
          resolved_at: '2026-11-09T02:00:00.000Z',
          created_at: '2026-11-09T01:00:00.000Z',
          updated_at: '2026-11-09T02:00:00.000Z',
        }),
    });
    await expect(
      correctVisitSavings({ caseId: CASE, correctedCents: '2500', reason: 'Too late.' }),
    ).resolves.toEqual({ ok: false, code: 'terminal' });
    await expect(
      restoreVisitOpportunity({ caseId: CASE, reason: 'Too late.' }),
    ).resolves.toEqual({ ok: false, code: 'terminal' });

    getSupabaseAdmin.mockReturnValue({
      from: () =>
        caseQuery({
          id: CASE,
          user_id: 'member-1',
          challenge_item_id: ITEM,
          redemption_id: null,
          category: 'offer_refused',
          explanation: 'They refused the offer.',
          status: 'submitted',
          member_response: null,
          resolved_at: null,
          created_at: '2026-11-09T01:00:00.000Z',
          updated_at: '2026-11-09T01:00:00.000Z',
        }),
    });
    await expect(
      correctVisitSavings({ caseId: CASE, correctedCents: '2500', reason: 'Wrong category.' }),
    ).resolves.toEqual({ ok: false, code: 'not_allowed' });
    expect(correctVisitProblemSavings).not.toHaveBeenCalled();
    expect(restoreVisitProblemOpportunity).not.toHaveBeenCalled();
  });

  it('sends the signed-in admin id with one savings fix and one make-up grant', async () => {
    process.env.E07_VISIT_PROBLEMS_ENABLED = 'true';
    assertAdmin.mockResolvedValue({ ok: true, userId: 'admin-1', email: 'admin@example.com' });
    const openOther = {
      id: CASE,
      user_id: 'member-1',
      challenge_item_id: ITEM,
      redemption_id: null,
      category: 'other',
      explanation: 'Something else.',
      status: 'under_review',
      member_response: null,
      resolved_at: null,
      created_at: '2026-11-09T01:00:00.000Z',
      updated_at: '2026-11-09T01:00:00.000Z',
    };
    getSupabaseAdmin.mockReturnValue({ from: () => caseQuery(openOther) });
    correctVisitProblemSavings.mockResolvedValue({
      ok: true,
      alreadyApplied: false,
      correctedCents: 2500,
      redemptionId: 'redemption-1',
    });
    restoreVisitProblemOpportunity.mockResolvedValue({
      ok: true,
      alreadyApplied: false,
      opportunityId: 'spot-1',
    });
    await expect(
      correctVisitSavings({ caseId: CASE, correctedCents: '2500', reason: 'Use 2500 cents.' }),
    ).resolves.toEqual({ ok: true });
    await expect(
      restoreVisitOpportunity({ caseId: CASE, reason: 'Grant one visit.' }),
    ).resolves.toEqual({ ok: true });
    expect(correctVisitProblemSavings).toHaveBeenCalledWith({
      caseId: CASE,
      actorUserId: 'admin-1',
      correctedCents: 2500,
      reason: 'Use 2500 cents.',
    });
    expect(restoreVisitProblemOpportunity).toHaveBeenCalledWith({
      caseId: CASE,
      actorUserId: 'admin-1',
      reason: 'Grant one visit.',
    });
  });
});
