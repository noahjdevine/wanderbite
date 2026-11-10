'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  correctVisitSavings,
  restoreVisitOpportunity,
  reviewVisitProblem,
} from '@/app/(site)/admin/visit-problem-actions';
import {
  allowedVisitProblemFixes,
  VISIT_PROBLEM_TEXT_MAX,
  type AdminVisitProblem,
  type VisitProblemStatus,
} from '@/lib/boost/visit-problem';
import { Button } from '@/components/ui/button';

const ERRORS: Record<string, string> = {
  forbidden: 'Admin review is required.',
  not_admin: 'Admin review is required.',
  not_found: 'That case could not be found.',
  terminal: 'This case is already resolved.',
  invalid_reason: 'Enter an internal reason of 500 characters or fewer.',
  invalid_status: 'That status is not available for this case.',
  invalid_response: 'The member-visible response must be 500 characters or fewer.',
  explanation_required: 'A resolution needs a member-visible explanation.',
  unchanged: 'Change the status or the member-visible response before saving.',
  unavailable: 'The review could not be saved. Please try again.',
  disabled: 'Visit problem review is not available.',
  not_allowed: 'This report does not allow that correction.',
  invalid_amount: 'Enter the corrected savings in whole cents.',
  already_applied: 'That correction was already saved.',
  no_redemption: 'This report has no verified visit to correct.',
  not_verified: 'The visit is not verified, so savings stay as they are.',
  mfa_enroll: 'Authenticator setup is required before admin access.',
  mfa_challenge: 'Authenticator verification is required before admin access.',
  auth_error: 'Admin access could not be checked.',
  role_lookup_failed: 'Admin access could not be checked.',
};

function statusChoices(current: VisitProblemStatus): VisitProblemStatus[] {
  if (current === 'resolved') return ['resolved'];
  if (current === 'under_review') return ['under_review', 'resolved'];
  return ['submitted', 'under_review', 'resolved'];
}

const STATUS_LABELS: Record<VisitProblemStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  resolved: 'Resolved',
};

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function CaseCorrections({
  item,
  unavailable,
}: {
  item: AdminVisitProblem;
  unavailable: boolean;
}) {
  const router = useRouter();
  const fixes = allowedVisitProblemFixes(item.category);
  const open = item.status !== 'resolved';
  const [cents, setCents] = useState('');
  const [savingsReason, setSavingsReason] = useState('');
  const [restoreReason, setRestoreReason] = useState('');
  const [savingsError, setSavingsError] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [savingSavings, setSavingSavings] = useState(false);
  const [savingRestore, setSavingRestore] = useState(false);

  if (unavailable) {
    return <p className="text-sm text-muted-foreground">Corrections are unavailable right now.</p>;
  }

  async function onSavings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingSavings(true);
    setSavingsError(null);
    const result = await correctVisitSavings({
      caseId: item.id,
      correctedCents: cents,
      reason: savingsReason,
    });
    setSavingSavings(false);
    if (!result.ok) {
      setSavingsError(ERRORS[result.code] ?? ERRORS.unavailable);
      return;
    }
    router.refresh();
  }

  async function onRestore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingRestore(true);
    setRestoreError(null);
    const result = await restoreVisitOpportunity({
      caseId: item.id,
      reason: restoreReason,
    });
    setSavingRestore(false);
    if (!result.ok) {
      setRestoreError(ERRORS[result.code] ?? ERRORS.unavailable);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3 border-t pt-3">
      {fixes.savings ? (
        item.savingsCorrectionCents != null ? (
          <p className="text-sm text-foreground">
            Savings corrected to {formatCents(item.savingsCorrectionCents)}. The original settlement is unchanged.
          </p>
        ) : open ? (
          <form className="space-y-2" onSubmit={(event) => void onSavings(event)}>
            <p className="text-sm font-medium">Correct savings</p>
            <p className="text-xs text-muted-foreground">
              Enter the amount Progress should show, in cents. This does not change the original settlement.
            </p>
            <label className="block text-sm font-medium" htmlFor={`cents-${item.id}`}>
              Corrected savings in cents
            </label>
            <input
              id={`cents-${item.id}`}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              inputMode="numeric"
              value={cents}
              onChange={(event) => setCents(event.target.value)}
            />
            <label className="block text-sm font-medium" htmlFor={`savings-reason-${item.id}`}>
              Internal reason
            </label>
            <textarea
              id={`savings-reason-${item.id}`}
              className="min-h-16 w-full rounded-md border bg-background px-3 py-2 text-sm"
              maxLength={VISIT_PROBLEM_TEXT_MAX}
              required
              value={savingsReason}
              onChange={(event) => setSavingsReason(event.target.value)}
            />
            <Button disabled={savingSavings} type="submit">
              {savingSavings ? 'Saving…' : 'Correct savings'}
            </Button>
            {savingsError ? (
              <p className="text-sm text-destructive" role="alert">
                {savingsError}
              </p>
            ) : null}
          </form>
        ) : null
      ) : null}
      {fixes.restore ? (
        item.makeupGranted ? (
          <p className="text-sm text-foreground">
            Make-up challenge granted. The original visit stays on the member&apos;s record.
          </p>
        ) : open ? (
          <form className="space-y-2" onSubmit={(event) => void onRestore(event)}>
            <p className="text-sm font-medium">Make-up challenge</p>
            <p className="text-xs text-muted-foreground">
              Grants one extra visit. It does not undo the original visit or add a credit.
            </p>
            <label className="block text-sm font-medium" htmlFor={`restore-reason-${item.id}`}>
              Internal reason
            </label>
            <textarea
              id={`restore-reason-${item.id}`}
              className="min-h-16 w-full rounded-md border bg-background px-3 py-2 text-sm"
              maxLength={VISIT_PROBLEM_TEXT_MAX}
              required
              value={restoreReason}
              onChange={(event) => setRestoreReason(event.target.value)}
            />
            <Button disabled={savingRestore} type="submit">
              {savingRestore ? 'Saving…' : 'Grant make-up challenge'}
            </Button>
            {restoreError ? (
              <p className="text-sm text-destructive" role="alert">
                {restoreError}
              </p>
            ) : null}
          </form>
        ) : null
      ) : null}
    </div>
  );
}

function CaseReview({ item, correctionsUnavailable }: { item: AdminVisitProblem; correctionsUnavailable: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<VisitProblemStatus>(item.status);
  const [response, setResponse] = useState(item.response ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const sealed = item.status === 'resolved';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const result = await reviewVisitProblem({
      caseId: item.id,
      status,
      memberResponse: response,
      reason,
    });
    setSaving(false);
    if (!result.ok) {
      setError(ERRORS[result.code] ?? ERRORS.unavailable);
      return;
    }
    router.refresh();
  }

  return (
    <li className="space-y-3 rounded-lg border p-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">
          {item.restaurantName} · {item.categoryLabel} · {item.statusLabel}
        </p>
        <p className="text-xs text-muted-foreground">
          {item.email ?? item.userId} · {new Date(item.createdAt).toLocaleString('en-US')}
        </p>
        <p className="text-sm text-foreground">{item.explanation}</p>
        {item.response ? <p className="text-sm text-foreground">Shown to the member: {item.response}</p> : null}
        {item.latestReason ? (
          <p className="text-sm text-muted-foreground">Internal reason on file: {item.latestReason}</p>
        ) : null}
      </div>
      {sealed ? (
        <p className="text-sm text-muted-foreground">Resolved cases stay as they were submitted.</p>
      ) : (
        <form className="space-y-3" onSubmit={(event) => void onSubmit(event)}>
          <label className="block text-sm font-medium" htmlFor={`status-${item.id}`}>
            Status
          </label>
          <select
            id={`status-${item.id}`}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value as VisitProblemStatus)}
          >
            {statusChoices(item.status).map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
          <label className="block text-sm font-medium" htmlFor={`response-${item.id}`}>
            Member-visible response
          </label>
          <textarea
            id={`response-${item.id}`}
            className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
            maxLength={VISIT_PROBLEM_TEXT_MAX}
            value={response}
            onChange={(event) => setResponse(event.target.value)}
          />
          <p className="text-xs text-muted-foreground" id={`reason-help-${item.id}`}>
            The member sees the response. The reason stays in the admin audit log.
          </p>
          <label className="block text-sm font-medium" htmlFor={`reason-${item.id}`}>
            Internal reason
          </label>
          <textarea
            id={`reason-${item.id}`}
            aria-describedby={`reason-help-${item.id}`}
            className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
            maxLength={VISIT_PROBLEM_TEXT_MAX}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button disabled={saving} type="submit">
            {saving ? 'Saving…' : 'Save review'}
          </Button>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      )}
      <CaseCorrections item={item} unavailable={correctionsUnavailable} />
    </li>
  );
}

export function VisitProblemQueue({
  cases,
  correctionsUnavailable = false,
}: {
  cases: AdminVisitProblem[];
  correctionsUnavailable?: boolean;
}) {
  if (cases.length === 0) {
    return <p className="text-sm text-muted-foreground">No visit problems yet.</p>;
  }
  return (
    <ul className="space-y-4">
      {cases.map((item) => (
        <CaseReview key={item.id} item={item} correctionsUnavailable={correctionsUnavailable} />
      ))}
    </ul>
  );
}
