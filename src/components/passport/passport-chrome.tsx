'use client';

import { Share2 } from 'lucide-react';
import { PassportShareSheet, usePassportSharePreview } from '@/components/passport/passport-share-sheet';
import { PassportSegments } from '@/components/passport/passport-segments';
import { CtaButton } from '@/components/wb/cta-button';
import { pluralNoun, pluralize } from '@/lib/format/text';
import {
  PASSPORT_RETRY_HREF,
  PASSPORT_UNAVAILABLE_MESSAGE,
  type PassportSegmentId,
} from '@/lib/passport/passport-board';

export type PassportBadge = {
  id: string;
  name: string;
  earnedOn: string | null;
};

export type PassportChromeProps = {
  displayName: string;
  segment: PassportSegmentId;
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
  /**
   * Instant shell while stamps or map load. Keeps the cover and the
   * Passport | Map switcher, and does not paint zero counts.
   */
  pending?: boolean;
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
  pending = false,
  children,
}: PassportChromeProps) {
  const preview = usePassportSharePreview({
    progressUnavailable,
    uniqueRestaurants,
    neighborhoods,
    currentStreak,
  });

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
    <>
    <div className="overflow-x-clip bg-wb-cream text-wb-ink" aria-busy={pending || undefined}>
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
            {pending ? (
              <div
                aria-hidden="true"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 text-[13px] font-semibold text-white"
              >
                <Share2 className="size-4" />
                Share My Passport
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void preview.openPreview()}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 text-[13px] font-semibold text-white"
              >
                <Share2 className="size-4" aria-hidden />
                Share My Passport
              </button>
            )}
          </div>
          {pending ? (
            <h1 className="wb-display m-0 text-[42px] text-white sm:text-[56px]">
              <span className="sr-only" role="status">
                Loading Passport
              </span>
              <span aria-hidden="true" className="inline-block h-[1em] w-[12ch] max-w-full rounded-md bg-white/15" />
            </h1>
          ) : (
            <h1 className="wb-display m-0 text-[42px] text-white sm:text-[56px]">{title}</h1>
          )}
          {pending ? (
            <div className="flex flex-wrap gap-2" aria-hidden="true">
              <span className="h-8 w-24 rounded-full bg-white/15" />
              <span className="h-8 w-28 rounded-full bg-white/15" />
              <span className="h-8 w-24 rounded-full bg-white/15" />
            </div>
          ) : progressUnavailable ? null : (
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
          {pending || progressUnavailable ? null : badgeSummary ? (
            <p className="m-0 text-sm text-wb-lavender-2">{badgeSummary}</p>
          ) : null}
          {pending || progressUnavailable || longestStreak < 1 ? null : (
            <p className="m-0 text-xs text-wb-lavender-2">
              Longest streak: {pluralize(longestStreak, 'month')}
            </p>
          )}
          {!pending && pageYear && segment === 'stamps' ? (
            <p className="sr-only">Passport {pageYear}</p>
          ) : null}
          <PassportSegments active={segment} />
        </div>
      </header>
      <div className="wb-sheet wb-on-cream">
        <div className="mx-auto flex max-w-5xl flex-col gap-7 px-4 pt-7 pb-16 sm:px-8">
          {!pending && progressUnavailable ? (
            <div className="flex flex-col items-start gap-3">
              <p className="m-0 text-base text-wb-ink">{PASSPORT_UNAVAILABLE_MESSAGE}</p>
              <CtaButton href={retryHref}>Retry</CtaButton>
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </div>
    <PassportShareSheet
      phase={preview.phase}
      imageUrl={preview.imageUrl}
      reducedMotion={preview.reducedMotion}
      onCancel={preview.closePreview}
      onShare={() => void preview.sharePreview()}
    />
    </>
  );
}
