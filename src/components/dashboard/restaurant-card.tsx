'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { addDays } from 'date-fns';
import { Loader2, MapPin, RefreshCw, Ticket } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { REDEMPTION_CODE_LIFETIME_LABEL } from '@/lib/redemption-expiry';
import type { BiteNoteSummary } from '@/app/actions/bite-notes';
import { VisitNoteRead } from '@/components/notes/visit-note';
import { memoryActionForStatus } from '@/lib/notes/note-rules';
import { RestaurantReviews } from '@/components/restaurants/restaurant-reviews';
import { RestaurantPhoto } from '@/components/restaurants/restaurant-photo';
import { SocialProofRatingBlock } from '@/components/restaurant-social-proof';
import {
  challengeCardExpired,
  formatChicagoDeadline,
} from '@/lib/challenges/challenge-deadline';
import { NearbyIdeas } from '@/components/activities/nearby-ideas';
import type { ActivitySuggestion } from '@/lib/activities/types';
import { RecipeCards } from '@/components/recipes/recipe-cards';
import { RECIPES_SECTION_HEADING, type RecipeCardModel } from '@/lib/recipes/display';
import { StatusTrack } from '@/components/wb/status-track';

function formatOffer(discountCents: number, minSpendCents: number): string {
  const dollars = discountCents / 100;
  const minDollars = minSpendCents / 100;
  return `$${dollars} off when you spend $${minDollars}+`;
}

export type RestaurantCardProps = {
  item: GeneratedChallengeItem;
  cycleCreatedAt: string;
  canSwap: boolean;
  isSwapping: boolean;
  isRedeeming: boolean;
  onSwap: (challengeItemId: string) => void;
  onRedeem: (challengeItemId: string) => void;
  biteNote?: BiteNoteSummary;
  /** Where Save and Cancel in the note editor return. Challenges is the default. */
  memoryReturnTo?: string;
  /** Credits cards use the stored deadline. Legacy cards keep cycle + 30 days. */
  useStoredDeadline?: boolean;
  storedDeadline?: string | null;
  /** Monthly reveal only. Flag-off cards omit these. */
  showRevealDetails?: boolean;
  revealReason?: string | null;
  /** Published recipes for this restaurant. Omitted when the recipes flag is off. */
  recipes?: RecipeCardModel[];
  recipeExclusionLine?: string | null;
  /** Empty when E06_ACTIVITIES_ENABLED is not exactly true, or nothing qualifies. */
  activities?: ActivitySuggestion[];
};

export function RestaurantCard({
  item,
  cycleCreatedAt,
  canSwap,
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
}: RestaurantCardProps) {
  const [nowMs] = useState(() => Date.now());
  const isExpired = challengeCardExpired({
    now: new Date(nowMs),
    cycleCreatedAt,
    useStoredDeadline,
    storedDeadline,
  });
  const createdAt = new Date(cycleCreatedAt);
  const legacyDeadline = Number.isNaN(createdAt.getTime())
    ? ''
    : addDays(createdAt, 30).toISOString();
  const deadlineLabel = showRevealDetails
    ? formatChicagoDeadline(storedDeadline || legacyDeadline)
    : useStoredDeadline && storedDeadline
      ? formatChicagoDeadline(storedDeadline)
      : '';
  const tags = (item.restaurant.cuisine_tags ?? []).filter((tag) => tag.trim());
  const offerText = item.offer.available
    ? formatOffer(item.offer.discount_amount_cents, item.offer.min_spend_cents)
    : 'Offer unavailable';
  const isAssigned = item.challengeItem.status === 'assigned';
  const isRedeemed = item.challengeItem.status === 'redeemed';
  const [displayCode, setDisplayCode] = useState<string | null>(item.redemptionToken ?? null);

  useEffect(() => {
    if (!isRedeemed || !item.redemptionId) return;
    let cancelled = false;
    void getRedemptionCode(item.redemptionId).then((result) => {
      if (cancelled) return;
      setDisplayCode(result?.state === 'issued' ? result.code : null);
    });
    return () => {
      cancelled = true;
    };
  }, [isRedeemed, item.redemptionId, item.redemptionToken]);
  const hasCoords =
    item.restaurant.lat != null &&
    item.restaurant.lon != null &&
    !Number.isNaN(item.restaurant.lat) &&
    !Number.isNaN(item.restaurant.lon);
  const mapsUrl = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${item.restaurant.lat},${item.restaurant.lon}`
    : null;

  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);

  return (
    <Card className={`overflow-hidden ${isExpired ? 'opacity-75 grayscale' : ''}`}>
      <div className="-mt-6 aspect-[16/9] w-full shrink-0 bg-muted">
        <RestaurantPhoto
          restaurantId={item.restaurant.id}
          imageUrl={item.restaurant.image_url}
          googlePlaceId={item.restaurant.google_place_id}
        />
      </div>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{item.restaurant.name}</CardTitle>
            {isExpired && <Badge variant="secondary">Expired</Badge>}
          </div>
          {tags.length > 0 ? (
            <CardDescription className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </CardDescription>
          ) : null}
        </div>
        {mapsUrl && (
          <Button variant="ghost" size="icon" className="shrink-0" asChild>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Get directions"
            >
              <MapPin className="size-4" />
            </a>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm font-medium text-primary">{offerText}</p>
        {deadlineLabel ? (
          <p className="text-sm text-muted-foreground">Redeem by {deadlineLabel}</p>
        ) : null}
        {showRevealDetails ? (
          <p className="text-sm text-muted-foreground">
            {isRedeemed ? 'Completed' : 'Not completed yet'}
          </p>
        ) : null}
        {revealReason ? <p className="text-sm text-foreground">{revealReason}</p> : null}
        {item.visitStatus ? <StatusTrack status={item.visitStatus} /> : null}
        <NearbyIdeas headingId={`nearby-${item.restaurant.id}`} suggestions={activities} />
        {item.socialProof &&
          item.socialProof.totalRatings >= 3 &&
          item.socialProof.avgRating != null && (
            <SocialProofRatingBlock
              avgRating={item.socialProof.avgRating}
              totalRatings={item.socialProof.totalRatings}
            />
          )}
        <RestaurantReviews restaurantId={item.restaurant.id} />
        {isRedeemed && item.redemptionId && (
          <div className="space-y-3">
            {displayCode && (
              <div className="rounded-lg border-2 border-green-600 bg-green-50 p-3 dark:border-green-500 dark:bg-green-950/30">
                <p className="text-center font-mono text-lg font-bold tracking-wide text-green-800 dark:text-green-200">
                  {displayCode}
                </p>
              </div>
            )}
            <Button variant="default" className="w-full gap-2" asChild>
              <Link href={`/challenges/show/${item.redemptionId}`}>
                <Ticket className="size-4" aria-hidden />
                Show code to server
              </Link>
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Open full-screen QR + code for your server to scan or type.
            </p>
          </div>
        )}
        {item.redemptionId &&
        item.visitStatus &&
        (memoryActionForStatus(item.visitStatus) ||
          (item.visitStatus === 'note_added' && biteNote)) ? (
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
        <RecipeCards
          headingId={`recipes-${item.restaurant.id}`}
          heading={RECIPES_SECTION_HEADING}
          exclusionLine={recipeExclusionLine}
          recipes={recipes}
        />
      </CardContent>
      {isAssigned && (
        <CardFooter className="flex flex-col gap-2 pt-0">
          <AlertDialog open={redeemDialogOpen} onOpenChange={setRedeemDialogOpen}>
            <Button
              variant="default"
              size="sm"
              className="w-full gap-2"
              disabled={isRedeeming || isExpired}
              onClick={() => setRedeemDialogOpen(true)}
            >
              {isRedeeming ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Redeeming…
                </>
              ) : isExpired ? (
                'Offer expired'
              ) : (
                <>
                  <Ticket className="size-4" aria-hidden />
                  Redeem Offer
                </>
              )}
            </Button>
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
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            disabled={!canSwap || isSwapping || isExpired}
            onClick={() => onSwap(item.challengeItem.id)}
          >
            {isSwapping ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Swapping…
              </>
            ) : canSwap ? (
              <>
                <RefreshCw className="size-4" aria-hidden />
                Swap This Spot
              </>
            ) : (
              'No swaps left'
            )}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
