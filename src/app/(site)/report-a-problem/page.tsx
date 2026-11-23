import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ReportProblemForm } from './report-problem-form';
import { siteProblemReportsEnabled } from '@/lib/site-problems/flag';
import { sanitizeReportPagePath } from '@/lib/site-problems/report';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Report a problem',
  robots: { index: false, follow: false },
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReportProblemPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  if (!siteProblemReportsEnabled()) notFound();

  const params = await searchParams;
  const initialPage = sanitizeReportPagePath(firstParam(params.from)) ?? '';

  let showEmail = true;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    showEmail = !user;
  } catch {
    showEmail = true;
  }

  return (
    <main className="report-problem-page min-h-screen bg-background px-4 pb-24 pt-24 md:pt-28">
      <div className="mx-auto w-full max-w-lg">
        <ReportProblemForm initialPage={initialPage} showEmail={showEmail} />
      </div>
    </main>
  );
}
