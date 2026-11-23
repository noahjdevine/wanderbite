import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AdminMfaGate } from '../admin-mfa-gate';
import { SiteProblemList, type SiteProblemListItem } from './site-problem-list';
import { adminPageDecision, assertAdmin } from '@/lib/auth/assert-admin';
import { siteProblemReportsEnabled } from '@/lib/site-problems/flag';
import {
  formatChicagoReportTime,
  parseSiteProblemStatus,
  siteProblemWho,
  type SiteProblemStatus,
} from '@/lib/site-problems/report';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

type ReportRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  contact_email: string | null;
  page_path: string | null;
  what_happened: string;
  trying_to_do: string | null;
  status: string;
  admin_note: string | null;
};

function PageFrame({
  loadError,
  reports,
}: {
  loadError: boolean;
  reports: SiteProblemListItem[];
}) {
  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary">Site problems</h1>
            <p className="text-sm text-muted-foreground">
              Reports about the site. Newest first. Times are America/Chicago.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin">Back to admin</Link>
          </Button>
        </div>
        {loadError ? (
          <p className="text-sm text-destructive">Reports could not be loaded.</p>
        ) : (
          <SiteProblemList reports={reports} />
        )}
      </div>
    </main>
  );
}

export default async function SiteProblemsPage() {
  if (!siteProblemReportsEnabled()) notFound();

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

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('site_problem_reports')
    .select(
      'id, created_at, user_id, contact_email, page_path, what_happened, trying_to_do, status, admin_note',
    )
    .order('created_at', { ascending: false })
    .limit(100);

  let reports: SiteProblemListItem[] = [];
  let loadError = Boolean(error);
  if (!error) {
    const rows = (data ?? []) as ReportRow[];
    const userIds = [...new Set(rows.map((row) => row.user_id).filter((id): id is string => Boolean(id)))];
    const { data: profiles, error: profileError } = userIds.length
      ? await admin.from('user_profiles').select('id, email').in('id', userIds)
      : { data: [], error: null };
    if (profileError) loadError = true;
    const emailById = new Map(
      ((profiles ?? []) as { id: string; email: string | null }[]).map((profile) => [
        profile.id,
        profile.email,
      ]),
    );
    reports = rows.flatMap((row) => {
      const status = parseSiteProblemStatus(row.status);
      const createdAtLabel = formatChicagoReportTime(row.created_at);
      if (!status || !createdAtLabel) return [];
      const item: SiteProblemListItem = {
        id: row.id,
        createdAtLabel,
        pagePath: row.page_path,
        whatHappened: row.what_happened,
        tryingToDo: row.trying_to_do,
        who: siteProblemWho({
          userId: row.user_id,
          memberEmail: row.user_id ? (emailById.get(row.user_id) ?? null) : null,
          contactEmail: row.contact_email,
        }),
        status: status satisfies SiteProblemStatus,
        adminNote: row.admin_note,
      };
      return [item];
    });
  }

  return <PageFrame loadError={loadError} reports={reports} />;
}
