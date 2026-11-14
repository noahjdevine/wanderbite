'use client';

import { useEffect, useState } from 'react';
import { addDays } from 'date-fns';
import { Loader2, QrCode } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { GeneratedChallengeItem } from '@/app/actions/generate-challenge';
import { getRedemptionCode } from '@/app/actions/get-redemption-code';
import { NearbyIdeas } from '@/components/activities/nearby-ideas';
import { BoostCheckIn } from '@/components/challenges/boost-check-in';
import { ReportVisitProblem } from '@/components/challenges/report-visit-problem';
import { FirstVisitBriefing } from '@/components/briefings/first-visit';
import { VisitNoteRead } from '@/components/notes/visit-note';
import { RecipeCards } from '@/components/recipes/recipe-cards';
import { SocialProofRatingBlock } from '@/components/restaurant-social-proof';
import { RestaurantReviews } from '@/components/restaurants/restaurant-reviews';
import { RestaurantPhoto } from '@/components/restaurants/restaurant-photo';
import { ChallengeTicket } from '@/components/wb/challenge-ticket';
import { CtaButton } from '@/components/wb/cta-button';
import type { StatusTrackStatus } from '@/components/wb/status-track';
import type { ActivitySuggestion } from '@/lib/activities/types';
import type { BriefingFact } from '@/lib/briefings/types';
import type { BiteNoteSummary } from '@/app/actions/bite-notes';
import {
  challengeCardExpired,
  formatChicagoDeadline,
} from '@/lib/challenges/challenge-deadline';
import { challengeTicketOffer } from '@/lib/boost/savings-copy';
import { memoryActionForStatus } from '@/lib/notes/note-rules';
import { visitStatusCountsAsVisit } from '@/lib/visits/visit-status';
import { REDEMPTION_CODE_LIFETIME_LABEL } from '@/lib/redemption-expiry';
import { RECIPES_SECTION_HEADING, type RecipeCardModel } from '@/lib/recipes/display';
import type { VisitStatus } from '@/lib/visits/visit-status';

/** Fixed frame. A portrait photo cannot change the ticket height. */
export const TICKET_PHOTO_HEIGHT = 180;

function ticketArea(item: GeneratedChallengeItem): string {
  const tags = (item.restaurant.cuisine_tags ?? []).filter((tag) => tag.trim());
  if (tags.length > 0) return tags.join(' · ');
  return item.restaurant.address?.trim() ?? '';
}

function photoBadge(status: VisitStatus | undefined): { text: string; tone: 'ready' | 'wait' } | null {
  switch (status) {
    case 'ready':
      return { text: 'Ready to visit', tone: 'ready' };
    case 'code_issued':
      return { text: 'Code issued · awaiting verification', tone: 'wait' };
    case 'code_expired':
      return { text: 'Code expired', tone: 'wait' };
    case 'verified':
      return { text: 'Verified', tone: 'ready' };
    case 'note_added':
      return { text: 'Note added', tone: 'ready' };
    case 'expired':
      return { text: 'Expired', tone: 'wait' };
    case 'swapped':
      return { text: 'Swapped', tone: 'wait' };
    default:
      return null;
  }
}

function trackStatus(item: GeneratedChallengeItem): StatusTrackStatus {
  if (item.visitStatus) return item.visitStatus;
  if (item.challengeItem.status === 'expired') return 'expired';
  if (item.challengeItem.status === 'swapped_out') return 'swapped';
  if (item.challengeItem.status === 'redeemed') return 'code_issued';
  return 'ready';
}

type AdventureTicketProps = {
  item: GeneratedChallengeItem;
  cycleCreatedAt: string;
  canSwap: boolean;
  swapsRemaining: number;
  isSwapping: boolean;
  isRedeeming: boolean;
  onSwap: (challengeItemId: string) => void;
  onRedeem: (challengeItemId: string) => void;
  biteNote?: BiteNoteSummary;
  memoryReturnTo?: string;
  useStoredDeadline?: boolean;
  storedDeadline?: string | null;
  showRevealDetails?: boolean;
  revealReason?: string | null;
  recipes?: RecipeCardModel[];
  recipeExclusionLine?: string | null;
  activities?: ActivitySuggestion[];
  /** Empty when E06_BRIEFINGS_ENABLED is not exactly true, or no active facts exist. */
  briefings?: BriefingFact[];
  /**
   * Exact E07_ARRIVAL_SESSIONS_ENABLED. Default false hides Boost check-in
   * and does not ask for a location.
   */
  boostCheckIn?: boolean;
  /**
   * Exact E07_VISIT_PROBLEMS_ENABLED. Default false hides problem reporting
   * and does not read visit cases.
   */
  visitProblems?: boolean;
};

export function AdventureTicket({
  item,
  cycleCreatedAt,
  canSwap,
  swapsRemaining,
  isSwapping,
  isRedeeming,
  onSwap,
  onRedeem,
  biteNote,
  memoryReturnTo = '/challenges',
  useStoredDeadline = false,
  storedDeadline = null,
  showRevealDetails = false,
  revealReason = null,
  recipes = [],
  recipeExclusionLine = null,
  activities = [],
  briefings = [],
  boostCheckIn = false,
  visitProblems = false,
}: AdventureTicketProps) {
  const [nowMs] = useState(() => Date.now());
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);
  const isExpired = challengeCardExpired({
    now: new Date(nowMs),
    cycleCreatedAt,
    useStoredDeadline,
    storedDeadline,
  });
  const createdAt = new Date(cycleCreatedAt);
  const legacyDeadline = Number.isNaN(createdAt.getTime()) ? '' : addDays(createdAt, 30).toISOString();
  const deadlineLabel = showRevealDetails
    ? formatChicagoDeadline(storedDeadline || legacyDeadline)
    : useStoredDeadline && storedDeadline
      ? formatChicagoDeadline(storedDeadline)
      : '';
  const offer = challengeTicketOffer({
    offer: item.offer,
    visitStatus: item.visitStatus,
    storedSavingsCents: item.storedSavingsCents,
    savingsCorrected: item.savingsCorrected === true,
  });
  const status = trackStatus(item);
  const badge = photoBadge(item.visitStatus);
  const isAssigned = item.challengeItem.status === 'assigned';
  const isRedeemed = item.challengeItem.status === 'redeemed';
  const postVerify = item.visitStatus != null && visitStatusCountsAsVisit(item.visitStatus);
  const windowClosed = isExpired || item.visitStatus === 'expired';
  const [displayCode, setDisplayCode] = useState<string | null>(item.redemptionToken ?? null);

  useEffect(() => {
    if (!isRedeemed || !item.redemptionId || postVerify) return;
    let cancelled = false;
    void getRedemptionCode(item.redemptionId).then((result) => {
      if (cancelled) return;
      setDisplayCode(result?.state === 'issued' ? result.code : null);
    });
    return () => {
      cancelled = true;
    };
  }, [isRedeemed, item.redemptionId, item.redemptionToken, postVerify]);

  const hasCoords =
    item.restaurant.lat != null &&
    item.restaurant.lon != null &&
    !Number.isNaN(item.restaurant.lat) &&
    !Number.isNaN(item.restaurant.lon);
  const mapsUrl = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${item.restaurant.lat},${item.restaurant.lon}`
    : null;

  const showMemory =
    Boolean(item.redemptionId && item.visitStatus) &&
    (memoryActionForStatus(item.visitStatus ?? 'ready') !== null ||
      (item.visitStatus === 'note_added' && Boolean(biteNote)));

  let action = null;
  if (isAssigned && windowClosed) {
    action = (
      <CtaButton className="min-h-[52px] w-full" disabled type="button">
        Offer expired
      </CtaButton>
    );
  } else if (isAssigned) {
    action = (
      <AlertDialog open={redeemDialogOpen} onOpenChange={setRedeemDialogOpen}>
        <CtaButton
          className="min-h-[52px] w-full"
          disabled={isRedeeming}
          type="button"
          onClick={() => setRedeemDialogOpen(true)}
        >
          {isRedeeming ? (
            <>
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              Getting your code…
            </>
          ) : (
            "I'm here — get my code"
          )}
        </CtaButton>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you at the restaurant?</AlertDialogTitle>
            <AlertDialogDescription>
              Once you redeem, you have {REDEMPTION_CODE_LIFETIME_LABEL} to show this to your server.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onRedeem(item.challengeItem.id);
              }}
            >
              Yes, Redeem Now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  } else if (isRedeemed && item.redemptionId && !postVerify) {
    const label = item.visitStatus === 'code_expired' ? 'Get a new one' : 'Show code to your server';
    action = (
      <CtaButton
        href={`/challenges/show/${item.redemptionId}`}
        variant="secondary-cream"
        creamStyle="plum"
        className="min-h-[52px] w-full"
      >
        <QrCode className="size-4" aria-hidden />
        {label}
      </CtaButton>
    );
  }

  const swapNote =
    isAssigned && !windowClosed && swapsRemaining === 0 ? "You've used this month's swap." : null;

  return (
    <ChallengeTicket
      name={item.restaurant.name}
      area={ticketArea(item)}
      offerAmount={offer.amount}
      offerRequirement={offer.requirement}
      offerNote={offer.note}
      status={status}
      action={action}
      photo={
        <RestaurantPhoto
          restaurantId={item.restaurant.id}
          imageUrl={item.restaurant.image_url}
          googlePlaceId={item.restaurant.google_place_id}
          className="h-full w-full object-cover"
        />
      }
      photoHeight={TICKET_PHOTO_HEIGHT}
      badge={badge?.text}
      badgeTone={badge?.tone}
      note={swapNote}
    >
      {visitProblems && item.challengeItem.status !== 'swapped_out' ? (
        <ReportVisitProblem
          challengeItemId={item.challengeItem.id}
          redemptionId={item.redemptionId ?? null}
        />
      ) : null}
      <BoostCheckIn
        enabled={
          boostCheckIn && isAssigned && !windowClosed && Boolean(item.challengeItem.offer_version_id) && hasCoords
        }
        challengeItemId={item.challengeItem.id}
      />
      {isAssigned && !windowClosed && canSwap ? (
        <CtaButton
          variant="secondary-cream"
          creamStyle="outline"
          className="min-h-11 w-full"
          disabled={isSwapping}
          type="button"
          onClick={() => onSwap(item.challengeItem.id)}
        >
          {isSwapping ? (
            <>
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              Swapping…
            </>
          ) : (
            'Swap this spot'
          )}
        </CtaButton>
      ) : null}
      {deadlineLabel ? <p className="m-0 text-sm text-wb-muted">Redeem by {deadlineLabel}</p> : null}
      {showRevealDetails ? (
        <p className="m-0 text-sm text-wb-muted">{isRedeemed ? 'Completed' : 'Not completed yet'}</p>
      ) : null}
      {revealReason ? <p className="m-0 text-sm text-wb-ink">{revealReason}</p> : null}
      {mapsUrl ? (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-wb-plum underline-offset-4 hover:underline"
        >
          Directions
        </a>
      ) : null}
      {isRedeemed && item.redemptionId && !postVerify ? (
        <div className="space-y-2">
          {displayCode ? (
            <p className="m-0 text-center font-mono text-lg font-bold tracking-wide text-wb-plum">{displayCode}</p>
          ) : null}
          <p className="m-0 text-center text-xs text-wb-muted">
            Open full-screen QR + code for your server to scan or type.
          </p>
        </div>
      ) : null}
      {showMemory && item.redemptionId && item.visitStatus ? (
        <VisitNoteRead
          redemptionId={item.redemptionId}
          status={item.visitStatus}
          returnTo={memoryReturnTo}
          note={
            item.visitStatus === 'note_added' && biteNote
              ? { id: biteNote.id, note: biteNote.note, is_public: biteNote.is_public }
              : null
          }
        />
      ) : null}
      <NearbyIdeas headingId={`nearby-${item.restaurant.id}`} suggestions={activities} />
      <FirstVisitBriefing headingId={`briefing-${item.restaurant.id}`} facts={briefings} />
      {item.socialProof && item.socialProof.totalRatings >= 3 && item.socialProof.avgRating != null ? (
        <SocialProofRatingBlock
          avgRating={item.socialProof.avgRating}
          totalRatings={item.socialProof.totalRatings}
        />
      ) : null}
      <RestaurantReviews restaurantId={item.restaurant.id} />
      <RecipeCards
        headingId={`recipes-${item.restaurant.id}`}
        heading={RECIPES_SECTION_HEADING}
        exclusionLine={recipeExclusionLine}
        recipes={recipes}
      />
    </ChallengeTicket>
  );
}
