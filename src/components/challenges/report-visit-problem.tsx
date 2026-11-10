'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { getOwnVisitProblem, submitVisitProblem } from '@/app/actions/visit-problems';
import {
  VISIT_PROBLEM_CATEGORIES,
  VISIT_PROBLEM_CATEGORY_LABELS,
  VISIT_PROBLEM_TEXT_MAX,
  type MemberVisitProblem,
  type VisitProblemCategory,
} from '@/lib/boost/visit-problem';

const MEMBER_ERRORS: Record<string, string> = {
  forbidden: 'That visit is not yours.',
  not_found: 'That visit could not be found.',
  not_reportable: 'This visit cannot be reported.',
  invalid_redemption: 'That code does not belong to this visit.',
  invalid_category: 'Choose what went wrong.',
  invalid_explanation: `Describe the problem in ${VISIT_PROBLEM_TEXT_MAX} characters or fewer.`,
  already_open: 'This visit already has an open report.',
  unavailable: "We couldn't save that report. Please try again.",
  disabled: 'Reporting a problem is not available right now.',
};

type ReportVisitProblemProps = {
  challengeItemId: string;
  redemptionId?: string | null;
};

export function ReportVisitProblem({ challengeItemId, redemptionId = null }: ReportVisitProblemProps) {
  const [problem, setProblem] = useState<MemberVisitProblem | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<VisitProblemCategory>('check_in_code');
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getOwnVisitProblem(challengeItemId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        if (result.code !== 'disabled') setError(MEMBER_ERRORS[result.code] ?? MEMBER_ERRORS.unavailable);
        return;
      }
      setProblem(result.problem);
    });
    return () => {
      cancelled = true;
    };
  }, [challengeItemId]);

  const openCase = problem?.status === 'submitted' || problem?.status === 'under_review';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (explanation.trim().length < 1) {
      setError('Tell us what happened');
      return;
    }
    setSaving(true);
    setError(null);
    const result = await submitVisitProblem({
      challengeItemId,
      redemptionId,
      category,
      explanation,
    });
    setSaving(false);
    if (!result.ok) {
      setError(MEMBER_ERRORS[result.code] ?? MEMBER_ERRORS.unavailable);
      if (result.code === 'already_open') {
        const current = await getOwnVisitProblem(challengeItemId);
        if (current.ok) setProblem(current.problem);
        setOpen(false);
      }
      return;
    }
    setProblem(result.problem);
    setExplanation('');
    setOpen(false);
  }

  return (
    <section className="space-y-2" data-visit-problem="" aria-labelledby={`visit-problem-${challengeItemId}`}>
      <h4 id={`visit-problem-${challengeItemId}`} className="m-0 text-sm font-semibold text-wb-ink">
        Visit problem
      </h4>
      {loading ? <p className="m-0 text-sm text-wb-muted">Checking this visit…</p> : null}
      {problem ? (
        <div className="rounded-2xl border border-[#e3d9c6] bg-[#f4efe6] px-3 py-3 text-sm">
          <p className="m-0 font-medium text-wb-ink">
            {problem.categoryLabel} · {problem.statusLabel}
          </p>
          <p className="m-0 mt-1 text-wb-ink">{problem.explanation}</p>
          {problem.response ? (
            <p className="m-0 mt-2 text-wb-ink">
              <span className="font-medium">Response: </span>
              {problem.response}
            </p>
          ) : (
            <p className="m-0 mt-2 text-wb-muted">Wanderbite has not posted a response yet.</p>
          )}
        </div>
      ) : null}
      {!loading && !openCase ? (
        open ? (
          <form className="space-y-2" noValidate onSubmit={(event) => void onSubmit(event)}>
            <p className="m-0 text-xs text-wb-muted">
              This sends the problem to Wanderbite for review. It does not change this visit, your savings, or your credits.
            </p>
            <label className="block text-sm font-medium text-wb-ink" htmlFor={`visit-problem-category-${challengeItemId}`}>
              What went wrong
            </label>
            <select
              id={`visit-problem-category-${challengeItemId}`}
              className="w-full rounded-xl border border-[#e3d9c6] bg-white px-3 py-2 text-sm text-wb-ink"
              value={category}
              onChange={(event) => setCategory(event.target.value as VisitProblemCategory)}
            >
              {VISIT_PROBLEM_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {VISIT_PROBLEM_CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
            <label className="block text-sm font-medium text-wb-ink" htmlFor={`visit-problem-explanation-${challengeItemId}`}>
              What happened
            </label>
            <textarea
              id={`visit-problem-explanation-${challengeItemId}`}
              className="min-h-24 w-full rounded-xl border border-[#e3d9c6] bg-white px-3 py-2 text-sm text-wb-ink"
              maxLength={VISIT_PROBLEM_TEXT_MAX}
              aria-invalid={error === 'Tell us what happened' ? true : undefined}
              aria-describedby={
                error === 'Tell us what happened' ? `visit-problem-error-${challengeItemId}` : undefined
              }
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
            />
            <div className="flex gap-2">
              <button
                className="rounded-full bg-wb-plum px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                disabled={saving}
                type="submit"
              >
                {saving ? 'Sending…' : 'Submit report'}
              </button>
              <button
                className="rounded-full px-4 py-2 text-sm font-medium text-wb-plum"
                type="button"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            className="text-sm font-medium text-wb-plum underline-offset-4 hover:underline"
            type="button"
            onClick={() => setOpen(true)}
          >
            Report a problem
          </button>
        )
      ) : null}
      {error ? (
        <p className="m-0 text-sm text-destructive" id={`visit-problem-error-${challengeItemId}`} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
