'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  MY_JOURNEY_VIEWS,
  MY_JOURNEY_VIEW_LABELS,
  myJourneyHref,
  type MyJourneyView,
} from '@/lib/my-journey-views';

type JourneySectionTabsProps = {
  activeView: MyJourneyView;
};

export function JourneySectionTabs({ activeView }: JourneySectionTabsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function selectView(view: MyJourneyView) {
    if (view === activeView) return;
    startTransition(() => {
      router.replace(myJourneyHref(view), { scroll: false });
    });
  }

  return (
    <div
      className={cn(
        'inline-flex w-full max-w-md rounded-lg border border-wb-line bg-white/70 p-1',
        isPending && 'opacity-60',
      )}
      role="tablist"
      aria-label="Progress sections"
    >
      {MY_JOURNEY_VIEWS.map((view) => {
        const selected = activeView === view;
        return (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => selectView(view)}
            className={cn(
              'flex-1 rounded-md px-3 py-2 text-sm font-medium',
              selected ? 'bg-wb-cream text-wb-ink shadow-sm' : 'text-wb-muted',
            )}
          >
            {MY_JOURNEY_VIEW_LABELS[view]}
          </button>
        );
      })}
    </div>
  );
}
