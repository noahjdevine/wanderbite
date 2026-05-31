import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { JourneyContent } from '@/components/journey/journey-content';
import { MyJourneyHub } from '@/components/journey/my-journey-hub';
import { JournalContent } from '@/components/journal/journal-content';
import { PassportContent } from '@/components/passport/passport-content';
import { parseMyJourneyView } from '@/lib/my-journey-views';

export const dynamic = 'force-dynamic';

type JourneyPageProps = {
  searchParams: Promise<{ view?: string | string[] }>;
};

function HubViewFallback() {
  return (
    <div className="mx-auto max-w-2xl animate-pulse space-y-4 py-8">
      <div className="h-8 w-48 rounded-md bg-muted" />
      <div className="h-40 rounded-lg bg-muted" />
    </div>
  );
}

export default async function JourneyPage({ searchParams }: JourneyPageProps) {
  const params = await searchParams;
  const view = parseMyJourneyView(params.view);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const redirectTo =
      view === 'journey' ? '/journey' : `/journey?view=${view}`;
    redirect(`/signin?redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  return (
    <MyJourneyHub activeView={view}>
      <Suspense fallback={<HubViewFallback />}>
        {view === 'journey' ? (
          <JourneyContent userId={user.id} />
        ) : view === 'journal' ? (
          <JournalContent />
        ) : (
          <PassportContent userId={user.id} />
        )}
      </Suspense>
    </MyJourneyHub>
  );
}
