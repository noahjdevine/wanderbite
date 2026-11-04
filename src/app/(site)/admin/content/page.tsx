import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdminMfaGate } from '../admin-mfa-gate';
import { ContentReview } from './content-review';
import { adminPageDecision, assertAdmin } from '@/lib/auth/assert-admin';
import { loadContentReviewModel } from '@/lib/content-pipeline/review-db';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function AdminContentPage() {
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
  if (decision.kind === 'redirect') {
    redirect(decision.href);
  }

  let model;
  try {
    model = await loadContentReviewModel();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Content review failed to load.';
    return (
      <main className="min-h-screen bg-background px-4 py-10">
        <div className="mx-auto max-w-4xl">
          <p className="text-destructive">{message}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary">Content review</h1>
            <p className="text-sm text-muted-foreground">
              Approve, edit, or reject pipeline exceptions. Members do not see this queue.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin">Back to admin</Link>
          </Button>
        </div>
        <ContentReview model={model} />
      </div>
    </main>
  );
}
