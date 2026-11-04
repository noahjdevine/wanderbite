'use client';

import { NotePrivacyControl } from '@/components/notes/note-privacy';
import { MemoryEntryLink } from '@/components/notes/memory-entry';
import { visitElementId } from '@/lib/notes/note-rules';
import type { VisitStatus } from '@/lib/visits/visit-status';

export type VisitNoteReadModel = {
  id: string;
  note: string | null;
  is_public: boolean;
};

type VisitNoteReadProps = {
  redemptionId: string;
  status: VisitStatus;
  returnTo: string;
  note: VisitNoteReadModel | null;
  /** Popup copies of a visit omit the anchor so the card keeps the only id. */
  anchor?: boolean;
};

export function VisitNoteRead({
  redemptionId,
  status,
  returnTo,
  note,
  anchor = true,
}: VisitNoteReadProps) {
  const anchorId = anchor ? visitElementId(redemptionId) : null;
  return (
    <div
      id={anchorId ?? undefined}
      tabIndex={anchorId ? -1 : undefined}
      className="scroll-mt-24 space-y-2 outline-none"
    >
      {note ? (
        <NotePrivacyControl noteId={note.id} isPublic={note.is_public} />
      ) : null}
      {note ? (
        note.note ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{note.note}</p>
        ) : (
          <p className="text-sm italic text-muted-foreground">No written note</p>
        )
      ) : null}
      <MemoryEntryLink status={status} redemptionId={redemptionId} returnTo={returnTo} />
    </div>
  );
}
