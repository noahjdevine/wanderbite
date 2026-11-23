'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import {
  submitSiteProblemReport,
  type SiteProblemFormState,
} from '@/app/actions/site-problem-reports';
import { Button } from '@/components/ui/button';

const fieldClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20';

const IDLE: SiteProblemFormState = { ok: false, code: 'idle', message: '' };

export function ReportProblemForm({
  initialPage,
  showEmail,
}: {
  initialPage: string;
  showEmail: boolean;
}) {
  const [state, formAction, pending] = useActionState(submitSiteProblemReport, IDLE);

  if (state.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Thanks — we got it.</h1>
        <p className="text-base text-muted-foreground">We read every report.</p>
        <Link
          href={state.returnPath ?? '/'}
          className="inline-flex text-base font-medium text-primary underline-offset-4 hover:underline"
        >
          {state.returnPath ? 'Back to where you were' : 'Back to Wanderbite'}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="relative space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Report a problem</h1>
        <p className="mt-2 text-base text-muted-foreground">
          Something broken, confusing, or wrong? Tell us what happened. We read every report.
        </p>
      </div>

      {state.code !== 'idle' && state.message ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="company_website">Company website</label>
        <input
          id="company_website"
          name="company_website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <div>
        <label htmlFor="what_happened" className="text-sm font-medium text-foreground">
          What happened?
        </label>
        <textarea
          id="what_happened"
          name="what_happened"
          required
          minLength={10}
          maxLength={2000}
          rows={5}
          className={fieldClass}
        />
      </div>

      <div>
        <label htmlFor="trying_to_do" className="text-sm font-medium text-foreground">
          What were you trying to do?
        </label>
        <p className="text-sm text-muted-foreground">Optional.</p>
        <textarea
          id="trying_to_do"
          name="trying_to_do"
          maxLength={1000}
          rows={3}
          className={fieldClass}
        />
      </div>

      <div>
        <label htmlFor="page_path" className="text-sm font-medium text-foreground">
          Which page?
        </label>
        <p className="text-sm text-muted-foreground">
          We filled this in from the page you came from. Change it if that is not right.
        </p>
        <input
          id="page_path"
          name="page_path"
          type="text"
          maxLength={300}
          defaultValue={initialPage}
          autoComplete="off"
          className={fieldClass}
        />
      </div>

      {showEmail ? (
        <div>
          <label htmlFor="contact_email" className="text-sm font-medium text-foreground">
            Email
          </label>
          <p className="text-sm text-muted-foreground">
            Optional. Add it if you want a reply. Skip it if you don&apos;t.
          </p>
          <input
            id="contact_email"
            name="contact_email"
            type="email"
            maxLength={254}
            autoComplete="email"
            className={fieldClass}
          />
        </div>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {pending ? 'Sending…' : 'Send report'}
      </Button>
    </form>
  );
}
