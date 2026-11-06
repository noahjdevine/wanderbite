import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { JournalContent } from '@/components/journal/journal-content';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Journal',
};

function JournalFallback() {
  return (
    <div className="mx-auto max-w-2xl animate-pulse space-y-4 py-8">
      <div className="h-8 w-48 rounded-md bg-muted" />
      <div className="h-40 rounded-lg bg-muted" />
    </div>
  );
}

export default async function JournalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/signin?redirectTo=${encodeURIComponent('/journal')}`);
  }

  return (
    <Suspense fallback={<JournalFallback />}>
      <JournalContent />
    </Suspense>
  );
}
