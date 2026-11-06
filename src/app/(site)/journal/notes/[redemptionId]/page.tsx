import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getJournalReflection } from '@/app/actions/journal-reflections';
import { NoteEditor, type NoteEditorNote } from '@/components/notes/note-editor';
import { JournalReflectionSection } from '@/components/notes/reflection-editor';
import { requireUser } from '@/lib/auth/require-user';
import { journalReflectionsEnabled } from '@/lib/notes/flag';
import { redemptionIsVerified, visitElementId } from '@/lib/notes/note-rules';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { unwrapJoin } from '@/lib/supabase/unwrap-join';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ redemptionId: string }>;
  searchParams: Promise<{ return?: string | string[] }>;
};

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function NoteEditorPage({ params, searchParams }: PageProps) {
  const { redemptionId } = await params;
  const query = await searchParams;
  const returnTo = firstParam(query.return);

  const auth = await requireUser();
  if (!auth.ok) {
    const editorPath = visitElementId(redemptionId)
      ? `/journal/notes/${redemptionId}`
      : '/journal';
    redirect(`/signin?redirectTo=${encodeURIComponent(editorPath)}`);
  }

  if (!visitElementId(redemptionId)) {
    return <p className="text-destructive">Redemption not found.</p>;
  }

  const reflectionsOn = journalReflectionsEnabled();
  const admin = getSupabaseAdmin();
  const { data: redemption, error } = await admin
    .from('redemptions')
    .select('id, user_id, status, verified_at, restaurants(name)')
    .eq('id', redemptionId)
    .maybeSingle();

  if (error || !redemption) {
    return <p className="text-destructive">Redemption not found.</p>;
  }

  const row = redemption as {
    id: string;
    user_id: string;
    status?: string | null;
    verified_at?: string | null;
    restaurants: { name: string } | { name: string }[] | null;
  };
  if (row.user_id !== auth.userId) {
    return <p className="text-destructive">You can only add notes to your own visits.</p>;
  }

  const { data: noteRow } = await admin
    .from('bite_notes')
    .select('id, note, rating, is_public')
    .eq('redemption_id', redemptionId)
    .eq('user_id', auth.userId)
    .maybeSingle();

  const existing = noteRow as {
    id: string;
    note: string | null;
    rating: number | null;
    is_public: boolean | null;
  } | null;
  const note: NoteEditorNote | null = existing
    ? {
        id: existing.id,
        note: existing.note,
        rating: existing.rating ?? 0,
        is_public: Boolean(existing.is_public),
      }
    : null;

  const restaurantName = unwrapJoin(row.restaurants)?.name ?? 'Restaurant';

  // Flag off: do not call getJournalReflection and do not render the section.
  let reflection: ReactNode = null;
  if (reflectionsOn) {
    const loaded = await getJournalReflection(redemptionId);
    if (loaded.ok) {
      reflection = (
        <JournalReflectionSection
          enabled
          redemptionId={redemptionId}
          initialReflection={loaded.reflection}
          verified={redemptionIsVerified(row.status, row.verified_at)}
        />
      );
    } else if (loaded.code !== 'disabled') {
      reflection = (
        <p role="alert" className="mx-auto mt-10 max-w-2xl text-sm text-muted-foreground">
          Your private reflection could not be loaded. Your rating and note above are unchanged.
        </p>
      );
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <NoteEditor
        redemptionId={redemptionId}
        note={note}
        returnTo={returnTo}
        restaurantName={restaurantName}
      />
      {reflection}
    </div>
  );
}
