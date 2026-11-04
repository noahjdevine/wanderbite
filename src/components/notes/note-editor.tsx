'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveBiteNote } from '@/app/actions/bite-notes';
import { NotePrivacyControl } from '@/components/notes/note-privacy';
import { Button } from '@/components/ui/button';
import { NOTE_MAX, resolveNoteReturnTarget } from '@/lib/notes/note-rules';

export type NoteEditorNote = {
  id: string;
  rating: number;
  note: string | null;
  is_public: boolean;
};

type NoteEditorProps = {
  redemptionId: string;
  note: NoteEditorNote | null;
  /** Raw return query value. Rejected targets fall back to /journal. */
  returnTo: string | null;
  restaurantName: string;
};

export function NoteEditor({ redemptionId, note, returnTo, restaurantName }: NoteEditorProps) {
  const router = useRouter();
  const destination = resolveNoteReturnTarget(returnTo, redemptionId);
  const initialRating =
    note && Number.isInteger(note.rating) && note.rating >= 1 && note.rating <= 5
      ? note.rating
      : null;
  const [rating, setRating] = useState<number | null>(initialRating);
  const [text, setText] = useState(note?.note ?? '');
  const [isPublic, setIsPublic] = useState(note?.is_public ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [visibilityPending, setVisibilityPending] = useState(false);
  const legendId = `rating-legend-${redemptionId}`;

  function goBack() {
    router.push(destination);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rating == null) {
      setError('Pick a rating from 1 to 5 stars.');
      return;
    }
    const trimmed = text.trim();
    if (trimmed.length > NOTE_MAX) {
      setError(`Note must be ${NOTE_MAX} characters or less.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await saveBiteNote(redemptionId, trimmed, rating, isPublic);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(destination);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="mx-auto max-w-2xl space-y-5" noValidate>
      <header className="space-y-1">
        <h1 id="note-editor-title" className="text-2xl font-semibold tracking-tight">
          {note ? 'Edit memory' : 'Add memory'}
        </h1>
        <p className="text-muted-foreground">{restaurantName}</p>
      </header>

      <fieldset className="space-y-2">
        <legend id={legendId} className="text-sm font-medium">
          Rating
        </legend>
        <div role="radiogroup" aria-labelledby={legendId} aria-required="true" className="flex flex-wrap gap-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="inline-flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name={`rating-${redemptionId}`}
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
              />
              {n}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1">
        <label htmlFor={`note-${redemptionId}`} className="text-sm font-medium">
          Note
        </label>
        <textarea
          id={`note-${redemptionId}`}
          value={text}
          maxLength={NOTE_MAX}
          rows={4}
          onChange={(event) => setText(event.target.value.slice(0, NOTE_MAX))}
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <p className="text-right text-xs text-muted-foreground">
          {text.length}/{NOTE_MAX}
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Visibility</legend>
        <NotePrivacyControl
          noteId={note?.id}
          isPublic={isPublic}
          refresh={false}
          onChange={setIsPublic}
          onPendingChange={setVisibilityPending}
        />
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving || visibilityPending}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" disabled={saving || visibilityPending} onClick={goBack}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
