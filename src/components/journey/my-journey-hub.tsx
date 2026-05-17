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

type MyJourneyHubProps = {
  activeView: MyJourneyView;
  children: React.ReactNode;
};

export function MyJourneyHub({ activeView, children }: MyJourneyHubProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function selectView(view: MyJourneyView) {
    if (view === activeView) return;
    startTransition(() => {
      router.replace(myJourneyHref(view), { scroll: false });
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:px-6 md:py-10">
        <header className="space-y-4">
          <h1 className="text-3xl font-bold tracking-tight">My Journey</h1>
          <div
            className="inline-flex w-full max-w-md rounded-lg border border-input bg-muted/40 p-1"
            role="tablist"
            aria-label="My Journey sections"
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
                    'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    selected
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {MY_JOURNEY_VIEW_LABELS[view]}
                </button>
              );
            })}
          </div>
        </header>

        <div
          className={cn(
            'transition-opacity duration-150',
            isPending ? 'opacity-60' : 'opacity-100'
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
