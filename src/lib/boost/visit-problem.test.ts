import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { visitProblemsEnabled } from '@/lib/boost/flag';
import {
  currentMemberCase,
  decideVisitProblemReview,
  parseReviewRpc,
  readOwnedVisitProblem,
  submitOwnedVisitProblem,
  toMemberVisitProblem,
  visitProblemInsertCode,
  type VisitProblemCaseRow,
  type VisitProblemStore,
} from '@/lib/boost/visit-problem';

const root = path.resolve(__dirname, '../../..');

function row(overrides: Partial<VisitProblemCaseRow> = {}): VisitProblemCaseRow {
  return {
    id: 'case-1',
    user_id: 'member-1',
    challenge_item_id: 'item-1',
    redemption_id: null,
    category: 'check_in_code',
    explanation: 'The code would not scan.',
    status: 'submitted',
    member_response: null,
    resolved_at: null,
    created_at: '2026-11-09T01:00:00.000Z',
    updated_at: '2026-11-09T01:00:00.000Z',
    ...overrides,
  };
}

function store(seed?: {
  lookup?: Awaited<ReturnType<VisitProblemStore['lookupOwnedVisit']>>;
  rows?: VisitProblemCaseRow[];
  extraRows?: VisitProblemCaseRow[];
}): VisitProblemStore & { rows: VisitProblemCaseRow[]; inserts: number } {
  const rows = [...(seed?.rows ?? [])];
  const api: VisitProblemStore & { rows: VisitProblemCaseRow[]; inserts: number } = {
    rows,
    inserts: 0,
    async lookupOwnedVisit() {
      return (
        seed?.lookup ?? {
          ok: true,
          visit: { challengeItemId: 'item-1', itemStatus: 'assigned', redemptionId: null },
        }
      );
    },
    async listOwnCases() {
      return { ok: true, rows: [...rows, ...(seed?.extraRows ?? [])] };
    },
    async insertCase(input) {
      api.inserts += 1;
      const open = rows.find(
        (item) =>
          item.challenge_item_id === input.challengeItemId &&
          (item.status === 'submitted' || item.status === 'under_review'),
      );
      if (open) return { ok: false, code: 'already_open' };
      const created = row({
        id: `case-${rows.length + 1}`,
        user_id: input.userId,
        challenge_item_id: input.challengeItemId,
        redemption_id: input.redemptionId,
        category: input.category,
        explanation: input.explanation,
        status: 'submitted',
        member_response: null,
        resolved_at: null,
      });
      rows.push(created);
      return { ok: true, row: created };
    },
  };
  return api;
}

describe('visit problem flag', () => {
  it('is on only for the exact string true', () => {
    expect(visitProblemsEnabled(undefined)).toBe(false);
    expect(visitProblemsEnabled('')).toBe(false);
    expect(visitProblemsEnabled('TRUE')).toBe(false);
    expect(visitProblemsEnabled('1')).toBe(false);
    expect(visitProblemsEnabled(' true')).toBe(false);
    expect(visitProblemsEnabled('true')).toBe(true);
  });
});

describe('visit problem submission', () => {
  const input = {
    userId: 'member-1',
    challengeItemId: 'item-1',
    redemptionId: null,
    category: 'check_in_code',
    explanation: '  The code would not scan.  ',
  };

  it('stores a trimmed report without a redemption and does not invent a response', async () => {
    const saved = store();
    const result = await submitOwnedVisitProblem(saved, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.problem).toMatchObject({
      challengeItemId: 'item-1',
      redemptionId: null,
      category: 'check_in_code',
      explanation: 'The code would not scan.',
      status: 'submitted',
      statusLabel: 'Submitted',
      response: null,
    });
    expect(result.problem).not.toHaveProperty('reason');
    expect(result.problem).not.toHaveProperty('latestReason');
    expect(saved.inserts).toBe(1);
  });

  it('refuses another member before insert', async () => {
    const saved = store({ lookup: { ok: false, code: 'forbidden' } });
    const result = await submitOwnedVisitProblem(saved, input);
    expect(result).toEqual({ ok: false, code: 'forbidden' });
    expect(saved.inserts).toBe(0);
  });

  it('refuses a swapped visit before insert', async () => {
    const saved = store({
      lookup: {
        ok: true,
        visit: { challengeItemId: 'item-1', itemStatus: 'swapped_out', redemptionId: null },
      },
    });
    const result = await submitOwnedVisitProblem(saved, input);
    expect(result).toEqual({ ok: false, code: 'not_reportable' });
    expect(saved.inserts).toBe(0);
  });

  it('refuses a redemption that is not on that visit', async () => {
    const saved = store({ lookup: { ok: false, code: 'invalid_redemption' } });
    const result = await submitOwnedVisitProblem(saved, { ...input, redemptionId: 'other-redemption' });
    expect(result).toEqual({ ok: false, code: 'invalid_redemption' });
    expect(saved.inserts).toBe(0);
  });

  it('keeps the first open explanation when a second submit arrives', async () => {
    const saved = store();
    const first = await submitOwnedVisitProblem(saved, input);
    const second = await submitOwnedVisitProblem(saved, {
      ...input,
      category: 'wrong_discount',
      explanation: 'A different story.',
    });
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, code: 'already_open' });
    expect(saved.rows).toHaveLength(1);
    expect(saved.rows[0]?.explanation).toBe('The code would not scan.');
    expect(saved.rows[0]?.category).toBe('check_in_code');
    expect(saved.inserts).toBe(2);
  });

  it('rejects an empty, oversized, or non-text explanation before insert', async () => {
    const saved = store();
    expect((await submitOwnedVisitProblem(saved, { ...input, explanation: '   ' })).ok).toBe(false);
    expect((await submitOwnedVisitProblem(saved, { ...input, explanation: 'x'.repeat(501) })).ok).toBe(false);
    expect((await submitOwnedVisitProblem(saved, { ...input, explanation: 'line\u0000break' })).ok).toBe(false);
    expect((await submitOwnedVisitProblem(saved, { ...input, category: 'refund' })).ok).toBe(false);
    expect(saved.inserts).toBe(0);
  });

  it('allows an assigned visit that has not generated a code', async () => {
    const saved = store({
      lookup: {
        ok: true,
        visit: { challengeItemId: 'item-1', itemStatus: 'assigned', redemptionId: null },
      },
    });
    const result = await submitOwnedVisitProblem(saved, input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.problem.redemptionId).toBeNull();
  });
});

describe('member visit problem read', () => {
  it('returns the open case and drops another member row', async () => {
    const own = row();
    const saved = store({
      rows: [own],
      extraRows: [row({ id: 'case-2', user_id: 'member-2', explanation: 'Not yours.' })],
    });
    const result = await readOwnedVisitProblem(saved, { userId: 'member-1', challengeItemId: 'item-1' });
    expect(result).toEqual({ ok: true, problem: toMemberVisitProblem(own) });
    if (result.ok && result.problem) {
      expect(Object.keys(result.problem)).not.toContain('latestReason');
      expect(JSON.stringify(result.problem)).not.toContain('Not yours.');
    }
  });

  it('prefers the open case over an older resolution', () => {
    const current = currentMemberCase([
      row({ id: 'old', status: 'resolved', created_at: '2026-11-01T00:00:00.000Z', member_response: 'Done.' }),
      row({ id: 'open', status: 'under_review', created_at: '2026-11-09T00:00:00.000Z' }),
    ]);
    expect(current?.id).toBe('open');
  });

  it('does not read a visit the member does not own', async () => {
    const saved = store({ lookup: { ok: false, code: 'forbidden' } });
    const result = await readOwnedVisitProblem(saved, { userId: 'member-2', challengeItemId: 'item-1' });
    expect(result).toEqual({ ok: false, code: 'forbidden' });
  });
});

describe('admin visit problem review', () => {
  const current = { currentStatus: 'submitted' as const, currentResponse: null };

  it('requires an explanation to resolve and records a review without one', () => {
    expect(
      decideVisitProblemReview({
        ...current,
        nextStatus: 'resolved',
        memberResponse: '   ',
        reason: 'Checked the quote.',
      }),
    ).toEqual({ ok: false, code: 'explanation_required' });

    expect(
      decideVisitProblemReview({
        ...current,
        nextStatus: 'under_review',
        memberResponse: '',
        reason: '  Looking at the code screen.  ',
      }),
    ).toEqual({
      ok: true,
      status: 'under_review',
      memberResponse: null,
      reason: 'Looking at the code screen.',
      action: 'visit_problem.review',
    });
  });

  it('resolves only with a member-visible response and an internal reason', () => {
    expect(
      decideVisitProblemReview({
        currentStatus: 'under_review',
        currentResponse: null,
        nextStatus: 'resolved',
        memberResponse: ' The offer stood as shown. ',
        reason: 'No quote change.',
      }),
    ).toMatchObject({
      ok: true,
      status: 'resolved',
      memberResponse: 'The offer stood as shown.',
      reason: 'No quote change.',
      action: 'visit_problem.resolve',
    });
  });

  it('seals a resolved case and rejects a step backward', () => {
    expect(
      decideVisitProblemReview({
        currentStatus: 'resolved',
        currentResponse: 'Already answered.',
        nextStatus: 'under_review',
        memberResponse: 'Changed.',
        reason: 'Second look.',
      }),
    ).toEqual({ ok: false, code: 'terminal' });
    expect(
      decideVisitProblemReview({
        currentStatus: 'under_review',
        currentResponse: null,
        nextStatus: 'submitted',
        memberResponse: '',
        reason: 'Back.',
      }),
    ).toEqual({ ok: false, code: 'invalid_status' });
  });

  it('rejects a blank, oversized, or unchanged review', () => {
    expect(
      decideVisitProblemReview({ ...current, nextStatus: 'under_review', memberResponse: '', reason: '  ' }),
    ).toEqual({ ok: false, code: 'invalid_reason' });
    expect(
      decideVisitProblemReview({
        ...current,
        nextStatus: 'under_review',
        memberResponse: '',
        reason: 'x'.repeat(501),
      }),
    ).toEqual({ ok: false, code: 'invalid_reason' });
    expect(
      decideVisitProblemReview({
        ...current,
        nextStatus: 'submitted',
        memberResponse: '',
        reason: 'No change.',
      }),
    ).toEqual({ ok: false, code: 'unchanged' });
  });
});

describe('visit problem database result mapping', () => {
  it('treats a unique violation as an open case and does not describe it as a rewrite', () => {
    expect(visitProblemInsertCode({ code: '23505' })).toBe('already_open');
    expect(visitProblemInsertCode({ code: '23514' })).toBe('unavailable');
    expect(visitProblemInsertCode(null)).toBeNull();
  });

  it('drops an internal reason from a review result', () => {
    expect(
      parseReviewRpc({
        ok: true,
        status: 'resolved',
        member_response: 'Shown to the member.',
        reason: 'internal-only',
      }),
    ).toEqual({ ok: false, code: 'unavailable' });
    expect(parseReviewRpc({ ok: false, error: 'not_admin' })).toEqual({ ok: false, code: 'not_admin' });
    expect(parseReviewRpc({ ok: true, status: 'under_review', member_response: null })).toEqual({
      ok: true,
      status: 'under_review',
      memberResponse: null,
    });
  });
});

describe('visit problem boundaries', () => {
  const action = readFileSync(path.join(root, 'src/app/actions/visit-problems.ts'), 'utf8');
  const admin = readFileSync(path.join(root, 'src/app/(site)/admin/visit-problem-actions.ts'), 'utf8');
  const store = readFileSync(path.join(root, 'src/lib/boost/visit-problem-store.ts'), 'utf8');
  const migration = readFileSync(
    path.join(root, 'supabase/migrations/20261109012530_e07_d1_visit_problem_cases.sql'),
    'utf8',
  );

  it('checks the flag before auth and does not correct a visit', () => {
    const submit = action.slice(action.indexOf('export async function submitVisitProblem'));
    const read = action.slice(action.indexOf('export async function getOwnVisitProblem'));
    const review = admin.slice(admin.indexOf('export async function reviewVisitProblem'));
    expect(submit.indexOf('visitProblemsEnabled')).toBeLessThan(submit.indexOf('requireUser'));
    expect(read.indexOf('visitProblemsEnabled')).toBeLessThan(read.indexOf('requireUser'));
    expect(review.indexOf('visitProblemsEnabled')).toBeLessThan(review.indexOf('assertAdmin'));
    expect(review.indexOf('assertAdmin')).toBeLessThan(review.indexOf("from('visit_problem_cases')"));
    for (const source of [action, admin, store, migration]) {
      expect(source).not.toMatch(/entitlement_credits|user_badges|verify_redemption|quoteBoost/);
    }
    expect(store).not.toMatch(/\.update\(/);
    expect(store).not.toMatch(/\.upsert\(/);
    expect(migration).toMatch(/grant select, insert on table public\.visit_problem_cases to service_role/);
    expect(migration).not.toMatch(/grant (update|delete|all) on table public\.visit_problem_cases to service_role/);
  });
});
