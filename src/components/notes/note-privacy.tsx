'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toggleNoteVisibility } from '@/app/actions/bite-notes';

type NotePrivacyControlProps = {
  /** Absent until the note row exists. The switch then only updates the editor. */
  noteId?: string;
  isPublic: boolean;
  onChange?: (next: boolean) => void;
  onPendingChange?: (pending: boolean) => void;
  /** List surfaces refresh so the badge matches the saved row. The editor does not. */
  refresh?: boolean;
};

export function NotePrivacyControl({
  noteId,
  isPublic,
  onChange,
  onPendingChange,
  refresh = true,
}: NotePrivacyControlProps) {
  const router = useRouter();
  const [current, setCurrent] = useState(isPublic);
  const [source, setSource] = useState(isPublic);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (source !== isPublic) {
    setSource(isPublic);
    setCurrent(isPublic);
  }

  async function onToggle() {
    const next = !current;
    setError(null);
    if (!noteId) {
      setCurrent(next);
      onChange?.(next);
      return;
    }
    setPending(true);
    onPendingChange?.(true);
    try {
      const res = await toggleNoteVisibility(noteId, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCurrent(next);
      onChange?.(next);
      if (refresh) router.refresh();
    } finally {
      setPending(false);
      onPendingChange?.(false);
    }
  }

  const label = current ? 'Public' : 'Private';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        data-note-visibility={current ? 'public' : 'private'}
        className="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium"
      >
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={current}
        aria-label={current ? 'Public. Make this note private.' : 'Private. Make this note public.'}
        disabled={pending}
        onClick={() => void onToggle()}
        className="text-sm font-medium underline-offset-2 hover:underline disabled:opacity-60"
      >
        {current ? 'Make private' : 'Make public'}
      </button>
      {error ? (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
