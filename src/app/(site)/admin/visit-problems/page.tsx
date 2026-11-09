import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AdminMfaGate } from '../admin-mfa-gate';
import { VisitProblemQueue } from './visit-problem-queue';
import { adminPageDecision, assertAdmin } from '@/lib/auth/assert-admin';
import { visitProblemsEnabled } from '@/lib/boost/flag';
import { loadVisitProblemQueue } from '@/lib/boost/visit-problem-store';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function VisitProblemsPage() {
  if (!visitProblemsEnabled()) notFound();

  const auth = await assertAdmin();
  const decision = adminPageDecision(auth);
  if (decision.kind === 'mfa') {
    return (
      <main className="min-h-screen bg-background px-4 py-10">
        <div className="mx-auto max-w-lg">
          <AdminMfaGate mode={decision.mode} />
        </div>
      </main>
    );
  }
  if (decision.kind === 'redirect') redirect(decision.href);

  const queue = await loadVisitProblemQueue();

  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary">Visit problems</h1>
            <p className="text-sm text-muted-foreground">
              Review a member&apos;s report and write a response. Saving does not change the visit, savings, credits, or subscription.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin">Back to admin</Link>
          </Button>
        </div>
        {queue.ok ? (
          <VisitProblemQueue cases={queue.cases} />
        ) : (
          <p className="text-sm text-destructive">The review queue is unavailable.</p>
        )}
      </div>
    </main>
  );
}
