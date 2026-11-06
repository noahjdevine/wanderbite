import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { JournalContent } from '@/components/journal/journal-content';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Journal',
};

export default async function JournalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/signin?redirectTo=${encodeURIComponent('/journal')}`);
  }

  return <JournalContent />;
}
