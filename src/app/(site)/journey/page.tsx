import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { JourneyContent } from '@/components/journey/journey-content';
import { PassportContent } from '@/components/passport/passport-content';
import { parseMyJourneyView } from '@/lib/my-journey-views';

export const dynamic = 'force-dynamic';

type JourneyPageProps = {
  searchParams: Promise<{ view?: string | string[] }>;
};

export async function generateMetadata({ searchParams }: JourneyPageProps): Promise<Metadata> {
  const params = await searchParams;
  const view = parseMyJourneyView(params.view);
  if (view === 'passport') return { title: 'Passport' };
  if (view === 'journal') return { title: 'Journal' };
  if (view === 'map') return { title: 'Map' };
  return { title: 'Progress' };
}

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
      view === 'journal' ? '/journal' : view === 'journey' ? '/journey' : `/journey?view=${view}`;
    redirect(`/signin?redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  if (view === 'journal') {
    redirect('/journal');
  }

  if (view === 'journey') {
    return (
      <Suspense fallback={<HubViewFallback />}>
        <JourneyContent userId={user.id} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<HubViewFallback />}>
      <PassportContent userId={user.id} segment={view === 'map' ? 'map' : 'stamps'} />
    </Suspense>
  );
}
