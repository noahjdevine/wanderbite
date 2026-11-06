'use client';

import { JournalShell } from '@/components/journal/journal-shell';
import { PassportChrome } from '@/components/passport/passport-chrome';
import { parseMyJourneyView } from '@/lib/my-journey-views';
import { useSearchParams } from 'next/navigation';

function PendingCards() {
  return (
    <>
      <div className="h-36 animate-pulse rounded-[26px] bg-white shadow-[0_14px_34px_rgba(42,20,66,0.08)]" />
      <div className="h-36 animate-pulse rounded-[26px] bg-white shadow-[0_14px_34px_rgba(42,20,66,0.08)]" />
    </>
  );
}

/** Progress shell. Same header stack as Progress, without a name or XP. */
export function ProgressPending() {
  return (
    <div className="bg-wb-cream text-wb-ink" aria-busy="true" data-surface="progress">
      <p className="sr-only" role="status">
        Loading Progress
      </p>
      <header className="wb-dark relative overflow-hidden">
        <div
          aria-hidden="true"
          className="wb-aurora pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.6) 0%, rgba(139,92,246,0) 70%)' }}
        />
        <div
          aria-hidden="true"
          className="wb-aurora-2 pointer-events-none absolute -left-28 top-36 h-80 w-80 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(251,113,133,0.4) 0%, rgba(251,113,133,0) 70%)' }}
        />
        <div className="relative mx-auto flex max-w-5xl flex-col gap-6 px-5 pb-16 pt-4 sm:px-8">
          <div className="flex items-center gap-4 sm:gap-[18px]">
            <div className="h-[92px] w-[92px] shrink-0 rounded-full bg-white/15" />
            <div className="min-w-0 flex-1">
              <div className="h-10 w-56 max-w-full rounded-md bg-white/15 sm:h-12" />
              <div className="mt-2 h-4 w-32 rounded-md bg-white/10" />
            </div>
          </div>
          <div className="min-h-[92px] rounded-[22px] bg-white/10" />
        </div>
      </header>
      <div className="wb-sheet wb-on-cream">
        <div className="mx-auto flex max-w-5xl flex-col gap-8 px-5 pb-16 pt-7 sm:px-8">
          <PendingCards />
        </div>
      </div>
    </div>
  );
}

/** Journal shell. Title stays Journal and it is not the passport cover. */
export function JournalPending() {
  return (
    <JournalShell pending>
      <PendingCards />
    </JournalShell>
  );
}

export function PassportPending({ segment }: { segment: 'stamps' | 'map' }) {
  return (
    <div data-surface="passport">
      <PassportChrome
        pending
        displayName="Your"
        segment={segment}
        progressUnavailable={false}
        verifiedVisits={0}
        uniqueRestaurants={0}
        neighborhoods={null}
        currentStreak={0}
        longestStreak={0}
        pendingVisits={0}
        earnedBadges={[]}
        showFirstBiteLocked={false}
      >
        {segment === 'map' ? (
          <div className="wb-map-frame animate-pulse" />
        ) : (
          <div className="h-80 animate-pulse rounded-[26px] bg-[#f6f1e8]" />
        )}
      </PassportChrome>
    </div>
  );
}

/** Picks the shell from the URL so the tab and the page agree while data loads. */
export function JourneyPending() {
  const view = parseMyJourneyView(useSearchParams().get('view') ?? undefined);
  if (view === 'journal') return <JournalPending />;
  if (view === 'passport') return <PassportPending segment="stamps" />;
  if (view === 'map') return <PassportPending segment="map" />;
  return <ProgressPending />;
}
