'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { updateSiteProblemReport } from '@/app/(site)/admin/site-problem-actions';
import { Button } from '@/components/ui/button';
import type { SiteProblemStatus } from '@/lib/site-problems/report';

export type SiteProblemListItem = {
  id: string;
  createdAtLabel: string;
  pagePath: string | null;
  whatHappened: string;
  tryingToDo: string | null;
  who: string;
  status: SiteProblemStatus;
  adminNote: string | null;
};

const fieldClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20';

const STATUS_LABELS: Record<SiteProblemStatus, string> = {
  new: 'New',
  reviewed: 'Reviewed',
  closed: 'Closed',
};

function ReportCard({ item }: { item: SiteProblemListItem }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updateSiteProblemReport, {
    ok: false,
    code: 'idle',
    message: '',
  });

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <article className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-muted-foreground">{item.createdAtLabel}</p>
        <p className="text-sm font-medium text-foreground">{STATUS_LABELS[item.status]}</p>
      </div>
      <p className="break-all text-sm text-foreground">{item.pagePath ?? 'Page not recorded'}</p>
      <p className="whitespace-pre-wrap text-base text-foreground">{item.whatHappened}</p>
      {item.tryingToDo ? (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.tryingToDo}</p>
      ) : null}
      <p className="text-sm text-foreground">{item.who}</p>
      <form action={formAction} className="space-y-3 border-t border-border pt-3">
        <input type="hidden" name="id" value={item.id} />
        <div>
          <label htmlFor={`status-${item.id}`} className="text-sm font-medium text-foreground">
            Status
          </label>
          <select
            id={`status-${item.id}`}
            name="status"
            defaultValue={item.status}
            className={fieldClass}
          >
            <option value="new">New</option>
            <option value="reviewed">Reviewed</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div>
          <label htmlFor={`note-${item.id}`} className="text-sm font-medium text-foreground">
            Note
          </label>
          <textarea
            id={`note-${item.id}`}
            name="admin_note"
            maxLength={500}
            rows={2}
            defaultValue={item.adminNote ?? ''}
            className={fieldClass}
          />
        </div>
        {state.ok ? (
          <p className="text-sm text-muted-foreground">Saved.</p>
        ) : state.code !== 'idle' && state.message ? (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        ) : null}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Save
        </Button>
      </form>
    </article>
  );
}

export function SiteProblemList({ reports }: { reports: SiteProblemListItem[] }) {
  if (reports.length === 0) {
    return <p className="text-sm text-muted-foreground">No reports yet.</p>;
  }
  return (
    <div className="space-y-4">
      {reports.map((item) => (
        <ReportCard key={`${item.id}:${item.status}:${item.adminNote ?? ''}`} item={item} />
      ))}
    </div>
  );
}
