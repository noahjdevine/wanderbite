'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { reviewVisitProblem } from '@/app/(site)/admin/visit-problem-actions';
import {
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

function CaseReview({ item }: { item: AdminVisitProblem }) {
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
    </li>
  );
}

export function VisitProblemQueue({ cases }: { cases: AdminVisitProblem[] }) {
  if (cases.length === 0) {
    return <p className="text-sm text-muted-foreground">No visit problems yet.</p>;
  }
  return (
    <ul className="space-y-4">
      {cases.map((item) => (
        <CaseReview key={item.id} item={item} />
      ))}
    </ul>
  );
}
