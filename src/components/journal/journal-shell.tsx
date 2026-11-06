import type { ReactNode } from 'react';
import { FocusVisitFromHash } from '@/components/notes/focus-visit';

type JournalShellProps = {
  children: ReactNode;
  /** Route-level loading shell. The title stays Journal. */
  pending?: boolean;
};

export function JournalShell({ children, pending = false }: JournalShellProps) {
  return (
    <div
      className="bg-wb-cream text-wb-ink"
      aria-busy={pending || undefined}
      data-surface={pending ? 'journal' : undefined}
    >
      <FocusVisitFromHash />
      <header className="wb-dark relative overflow-hidden">
        <div
          aria-hidden="true"
          className="wb-aurora pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(251,113,133,0.4) 0%, rgba(251,113,133,0) 70%)' }}
        />
        <div
          aria-hidden="true"
          className="wb-aurora-2 pointer-events-none absolute -left-28 top-36 h-80 w-80 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.55) 0%, rgba(139,92,246,0) 70%)' }}
        />
        <div className="relative mx-auto flex max-w-5xl flex-col gap-3 px-5 pb-16 pt-4 sm:px-8">
          <h1 className="wb-display m-0 text-[40px] text-white sm:text-[52px]">
            <em>Journal</em>
          </h1>
          <p className="m-0 max-w-md text-sm text-wb-lavender-2">
            Your dining memories. You choose which ones to share.
          </p>
          {pending ? (
            <p className="sr-only" role="status">
              Loading Journal
            </p>
          ) : null}
        </div>
      </header>
      <div className="wb-sheet wb-on-cream">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 pb-16 pt-7 sm:px-8">{children}</div>
      </div>
    </div>
  );
}
