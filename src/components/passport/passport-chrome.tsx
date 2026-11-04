'use client';

import { useCallback } from 'react';
import { Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { PassportSegments } from '@/components/passport/passport-segments';
import { CtaButton } from '@/components/wb/cta-button';
import { pluralNoun, pluralize } from '@/lib/format/text';
import {
  buildPassportShare,
  PASSPORT_RETRY_HREF,
  PASSPORT_UNAVAILABLE_MESSAGE,
  type PassportSegmentId,
} from '@/lib/passport/passport-board';
import { shareOrCopy } from '@/lib/share';

export type PassportBadge = {
  id: string;
  name: string;
  earnedOn: string | null;
};

export type PassportChromeProps = {
  displayName: string;
  segment: Extract<PassportSegmentId, 'stamps' | 'timeline'>;
  progressUnavailable: boolean;
  verifiedVisits: number;
  uniqueRestaurants: number;
  neighborhoods: number | null;
  currentStreak: number;
  longestStreak: number;
  pendingVisits: number;
  earnedBadges: PassportBadge[];
  showFirstBiteLocked: boolean;
  pageYear?: string;
  retryHref?: string;
  children: React.ReactNode;
};

export function PassportChrome({
  displayName,
  segment,
  progressUnavailable,
  verifiedVisits,
  uniqueRestaurants,
  neighborhoods,
  currentStreak,
  longestStreak,
  pendingVisits,
  earnedBadges,
  showFirstBiteLocked,
  pageYear,
  retryHref = PASSPORT_RETRY_HREF,
  children,
}: PassportChromeProps) {
  const handleShare = useCallback(async () => {
    const payload = buildPassportShare({
      progressUnavailable,
      uniqueRestaurants,
      neighborhoods,
      currentStreak,
    });
    const outcome = await shareOrCopy(payload);
    if (outcome === 'copied') toast.success('Link copied to clipboard!');
    else if (outcome === 'error') toast.error('Could not share. Try copying the link manually.');
  }, [currentStreak, neighborhoods, progressUnavailable, uniqueRestaurants]);

  const badgeSummary =
    earnedBadges.length > 0
      ? earnedBadges
          .map((badge) => (badge.earnedOn ? `${badge.name} · ${badge.earnedOn}` : badge.name))
          .join(', ')
      : showFirstBiteLocked
        ? 'First Bite locked'
        : null;

  const title =
    displayName === 'Your' ? (
      <>
        Your <em>Passport</em>
      </>
    ) : (
      <>
        {displayName}&apos;s <em>Passport</em>
      </>
    );

  return (
    <div className="overflow-x-clip bg-wb-cream text-wb-ink">
      <header className="wb-dark relative overflow-hidden">
        <div
          aria-hidden="true"
          className="wb-aurora pointer-events-none absolute -left-24 -top-16 h-80 w-80 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(251,113,133,0.45) 0%, rgba(251,113,133,0) 70%)' }}
        />
        <div
          aria-hidden="true"
          className="wb-aurora-2 pointer-events-none absolute -right-24 top-16 h-80 w-80 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.55) 0%, rgba(139,92,246,0) 70%)' }}
        />
        <div className="relative mx-auto flex max-w-5xl flex-col gap-5 px-5 pt-4 pb-16 sm:px-8">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleShare()}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 text-[13px] font-semibold text-white"
            >
              <Share2 className="size-4" aria-hidden />
              Share My Passport
            </button>
          </div>
          <h1 className="wb-display m-0 text-[42px] text-white sm:text-[56px]">{title}</h1>
          {progressUnavailable ? null : (
            <div className="flex flex-wrap gap-2">
              <span className="wb-chip-glass" data-passport-visits={verifiedVisits}>
                {pluralize(verifiedVisits, 'visit')}
              </span>
              {pendingVisits > 0 ? (
                <span className="wb-chip-glass">{pendingVisits} pending</span>
              ) : null}
              <span className="wb-chip-glass">
                {uniqueRestaurants} {pluralNoun(uniqueRestaurants, 'restaurant')}
              </span>
              {neighborhoods == null ? null : (
                <span className="wb-chip-glass">
                  {neighborhoods} {pluralNoun(neighborhoods, 'neighborhood')}
                </span>
              )}
              <span className="wb-chip-glass">{pluralize(currentStreak, 'month')} streak</span>
            </div>
          )}
          {progressUnavailable ? null : badgeSummary ? (
            <p className="m-0 text-sm text-wb-lavender-2">{badgeSummary}</p>
          ) : null}
          {progressUnavailable || longestStreak < 1 ? null : (
            <p className="m-0 text-xs text-wb-lavender-2">
              Longest streak: {pluralize(longestStreak, 'month')}
            </p>
          )}
          {pageYear && segment === 'stamps' ? (
            <p className="sr-only">Stamp page {pageYear}</p>
          ) : null}
          <PassportSegments active={segment} />
        </div>
      </header>
      <div className="wb-sheet wb-on-cream">
        <div className="mx-auto flex max-w-5xl flex-col gap-7 px-4 pt-7 pb-16 sm:px-8">
          {progressUnavailable ? (
            <div className="flex flex-col items-start gap-3">
              <p className="m-0 text-base text-wb-ink">{PASSPORT_UNAVAILABLE_MESSAGE}</p>
              <CtaButton href={retryHref}>Retry</CtaButton>
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}
