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
    return <JourneyContent userId={user.id} />;
  }

  return <PassportContent userId={user.id} segment={view === 'map' ? 'map' : 'stamps'} />;
}
