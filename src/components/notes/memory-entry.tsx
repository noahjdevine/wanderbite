import Link from 'next/link';
import { memoryActionForStatus, noteEditorHref } from '@/lib/notes/note-rules';
import type { VisitStatus } from '@/lib/visits/visit-status';

type MemoryEntryLinkProps = {
  status: VisitStatus;
  redemptionId: string;
  returnTo: string;
};

export function MemoryEntryLink({ status, redemptionId, returnTo }: MemoryEntryLinkProps) {
  const action = memoryActionForStatus(status);
  if (!action || !redemptionId) return null;
  const label = action === 'add' ? 'Add memory' : 'Edit memory';
  return (
    <Link
      href={noteEditorHref(redemptionId, returnTo)}
      data-memory-action={action}
      className="inline-block text-sm font-medium text-[#E85D26] underline-offset-2 hover:underline"
    >
      {label}
    </Link>
  );
}
