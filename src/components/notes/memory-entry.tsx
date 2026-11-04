import Link from 'next/link';
import { memoryActionForStatus, noteEditorHref } from '@/lib/notes/note-rules';
import { cn } from '@/lib/utils';
import type { VisitStatus } from '@/lib/visits/visit-status';

type MemoryEntryLinkProps = {
  status: VisitStatus;
  redemptionId: string;
  returnTo: string;
  className?: string;
};

export function MemoryEntryLink({ status, redemptionId, returnTo, className }: MemoryEntryLinkProps) {
  const action = memoryActionForStatus(status);
  if (!action || !redemptionId) return null;
  const label = action === 'add' ? 'Add memory' : 'Edit memory';
  return (
    <Link
      href={noteEditorHref(redemptionId, returnTo)}
      data-memory-action={action}
      className={cn(
        'inline-block text-sm font-medium underline-offset-2 hover:underline',
        className ?? 'text-[#E85D26]',
      )}
    >
      {label}
    </Link>
  );
}
