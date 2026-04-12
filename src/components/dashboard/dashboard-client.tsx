'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Flame, Loader2, MapPin, RefreshCw, Star, Ticket } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
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
import {
  generateMonthlyChallenge,
  type GeneratedChallenge,
  type GeneratedChallengeItem,
} from '@/app/actions/generate-challenge';
import { swapChallengeItem } from '@/app/actions/swap-challenge';
import { redeemChallengeItem } from '@/app/actions/redeem-challenge';
import {
  getBadgeProgress,
  getNextBadgeMilestoneMonths,
  getStreakBadgeForLongest,
} from '@/lib/streaks';
import {
  saveBiteNote,
  toggleNoteVisibility,
  type BiteNoteSummary,
} from '@/app/actions/bite-notes';
import { RestaurantReviews } from '@/components/restaurants/restaurant-reviews';
import { SocialProofRatingBlock } from '@/components/restaurant-social-proof';

type TestUser = {
  id: string;
  email: string | null;
  dietary_flags: string[] | null;
};

export type DashboardStreakStats = {
  currentStreak: number;
  longestStreak: number;
  totalMonthsActive: number;
};

type DashboardClientProps = {
  testUser: TestUser;
  marketId: string;
  currentChallenge: GeneratedChallenge | null;
  streak: DashboardStreakStats;
  biteNotes: BiteNoteSummary[];
};

function formatOffer(discountCents: number, minSpendCents: number): string {
  const dollars = discountCents / 100;
  const minDollars = minSpendCents / 100;
  return `$${dollars} off when you spend $${minDollars}+`;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const BITE_NOTE_MAX = 280;

function StarRow({
  value,
  onChange,
  readOnly,
}: {
  value: number;
  onChange?: (n: number) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5" role="img" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) =>
        readOnly ? (
          <Star
            key={n}
            className={cn(
              'size-6',
              n <= value
                ? 'fill-amber-400 text-amber-400'
                : 'fill-transparent text-muted-foreground/40'
            )}
            aria-hidden
          />
        ) : (
          <button
            key={n}
            type="button"
            onClick={() => onChange?.(n)}
            className="rounded p-0.5 transition-opacity hover:opacity-90"
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
          >
            <Star
              className={cn(
                'size-6',
                n <= value
                  ? 'fill-amber-400 text-amber-400'
                  : 'fill-transparent text-muted-foreground/50'
              )}
            />
          </button>
        )
      )}
    </div>
  );
}

function BiteNotesInline({
  userId,
  redemptionId,
  saved,
}: {
  userId: string;
  redemptionId: string;
  saved: BiteNoteSummary | undefined;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [rating, setRating] = useState(saved?.rating ?? 5);
  const [text, setText] = useState(saved?.note ?? '');
  const [formIsPublic, setFormIsPublic] = useState(saved?.is_public ?? false);
  const [publicLocal, setPublicLocal] = useState(Boolean(saved?.is_public));
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [saving, setSaving] = useState(false);

  const hasSaved = Boolean(saved);

  useEffect(() => {
    setPublicLocal(Boolean(saved?.is_public));
  }, [saved?.id, saved?.is_public]);

  function openEdit() {
    setRating(saved?.rating ?? 5);
    setText(saved?.note ?? '');
    setFormIsPublic(saved?.is_public ?? false);
    setShowForm(true);
  }

  async function handleVisibilityChange(next: boolean) {
    if (!saved?.id) return;
    setVisibilitySaving(true);
    try {
      const res = await toggleNoteVisibility(saved.id, userId, next);
      if (res.ok) {
        setPublicLocal(next);
        toast.success(next ? 'Your review is now public' : 'Your review is now private');
        router.refresh();
      } else {
        toast.error(res.error);
      }
    } finally {
      setVisibilitySaving(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await saveBiteNote(
        redemptionId,
        userId,
        text,
        rating,
        formIsPublic
      );
      if (res.ok) {
        toast.success('Bite Note saved');
        setShowForm(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed border-muted-foreground/25 bg-muted/20 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Bite Notes
      </p>
      {hasSaved && !showForm && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StarRow value={saved!.rating} readOnly />
            {saved!.is_public ? (
              <Badge variant="secondary" className="text-xs">
                Public review
              </Badge>
            ) : null}
          </div>
          {saved!.note ? (
            <p className="whitespace-pre-wrap text-sm text-foreground">{saved!.note}</p>
          ) : (
            <p className="text-sm italic text-muted-foreground">No written note</p>
          )}
          {saved?.id ? (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 rounded border-input accent-[#E85D26]"
                checked={publicLocal}
                disabled={visibilitySaving}
                onChange={(e) => void handleVisibilityChange(e.target.checked)}
              />
              <span>Share publicly as a review</span>
            </label>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={openEdit}>
            Edit
          </Button>
        </div>
      )}
      {!hasSaved && !showForm && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setFormIsPublic(false);
            setShowForm(true);
          }}
        >
          Leave a Bite Note
        </Button>
      )}
      {showForm && (
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Rating</p>
            <StarRow value={rating} onChange={setRating} />
          </div>
          <div>
            <label htmlFor={`bite-note-${redemptionId}`} className="mb-1 block text-xs text-muted-foreground">
              How was it? (optional)
            </label>
            <textarea
              id={`bite-note-${redemptionId}`}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, BITE_NOTE_MAX))}
              rows={3}
              maxLength={BITE_NOTE_MAX}
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              placeholder="Quick memory from your visit…"
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {text.length}/{BITE_NOTE_MAX}
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-3.5 rounded border-input accent-[#E85D26]"
              checked={formIsPublic}
              onChange={(e) => setFormIsPublic(e.target.checked)}
            />
            <span>Share this note publicly as a review</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={saving} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save Note'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => {
                if (hasSaved) {
                  setShowForm(false);
                  setRating(saved!.rating);
                  setText(saved!.note ?? '');
                  setFormIsPublic(saved!.is_public);
                } else {
                  setShowForm(false);
                  setRating(5);
                  setText('');
                  setFormIsPublic(false);
                }
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

type RestaurantCardProps = {
  item: GeneratedChallengeItem;
  cycleCreatedAt: string;
  canSwap: boolean;
  isSwapping: boolean;
  isRedeeming: boolean;
  onSwap: (challengeItemId: string) => void;
  onRedeem: (challengeItemId: string) => void;
  userId: string;
  biteNote?: BiteNoteSummary;
};

function RestaurantCard({
  item,
  cycleCreatedAt,
  canSwap,
  isSwapping,
  isRedeeming,
  onSwap,
  onRedeem,
  userId,
  biteNote,
}: RestaurantCardProps) {
  const isExpired = Date.now() - new Date(cycleCreatedAt).getTime() > THIRTY_DAYS_MS;
  const tags = item.restaurant.cuisine_tags ?? [];
  const offerText = formatOffer(
    item.offer.discount_amount_cents,
    item.offer.min_spend_cents
  );
  const discountDollars = item.offer.discount_amount_cents / 100;
  const isAssigned = item.challengeItem.status === 'assigned';
  const isRedeemed = item.challengeItem.status === 'redeemed';
  const token = item.redemptionToken ?? null;
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
    <Card className={isExpired ? 'opacity-75 grayscale' : ''}>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{item.restaurant.name}</CardTitle>
            {isExpired && (
              <Badge variant="secondary">Expired</Badge>
            )}
          </div>
          <CardDescription className="flex flex-wrap gap-1.5">
            {tags.length > 0 ? (
              tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground">No tags</span>
            )}
          </CardDescription>
        </div>
        {mapsUrl && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            asChild
          >
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
        {item.socialProof &&
          item.socialProof.totalRatings >= 3 &&
          item.socialProof.avgRating != null && (
            <SocialProofRatingBlock
              avgRating={item.socialProof.avgRating}
              totalRatings={item.socialProof.totalRatings}
            />
          )}
        <RestaurantReviews restaurantId={item.restaurant.id} />
        {isRedeemed && token && (
          <div className="rounded-lg border-2 border-green-600 bg-green-50 p-4 dark:border-green-500 dark:bg-green-950/30">
            <p className="text-center text-lg font-mono font-bold tracking-wide text-green-800 dark:text-green-200">
              CODE: {token}
            </p>
            <p className="mt-1 text-center text-sm text-green-700 dark:text-green-300">
              Show to server for ${discountDollars} off
            </p>
          </div>
        )}
        {isRedeemed && item.redemptionId && (
          <BiteNotesInline
            userId={userId}
            redemptionId={item.redemptionId}
            saved={biteNote}
          />
        )}
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
                  Once you redeem, you have 15 minutes to show this to your server.
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

export function DashboardClient({
  testUser,
  marketId,
  currentChallenge,
  streak,
  biteNotes,
}: DashboardClientProps) {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);
  const [swappingItemId, setSwappingItemId] = useState<string | null>(null);
  const [redeemingItemId, setRedeemingItemId] = useState<string | null>(null);

  async function handleGenerate() {
    setIsGenerating(true);
    try {
      const result = await generateMonthlyChallenge(testUser.id, marketId);
      if (result.ok) {
        toast.success('Challenge generated!');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSwap(challengeItemId: string) {
    setSwappingItemId(challengeItemId);
    try {
      const result = await swapChallengeItem(challengeItemId, testUser.id);
      if (result.ok) {
        toast.success(`Swapped to ${result.data.newRestaurant.name}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSwappingItemId(null);
    }
  }

  async function handleRedeem(challengeItemId: string) {
    setRedeemingItemId(challengeItemId);
    try {
      const result = await redeemChallengeItem(challengeItemId, testUser.id);
      if (result.ok) {
        toast.success(`Redeemed! Show code ${result.data.token} to your server.`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setRedeemingItemId(null);
    }
  }

  const swapCountUsed = currentChallenge?.cycle.swap_count_used ?? 0;
  const swapsRemaining = Math.max(0, 1 - swapCountUsed);
  const canSwap = swapsRemaining > 0;
  const activeItems =
    currentChallenge?.items.filter(
      (item) =>
        item.challengeItem.status === 'assigned' ||
        item.challengeItem.status === 'redeemed'
    ) ?? [];

  const biteNoteByRedemptionId = useMemo(() => {
    const m = new Map<string, BiteNoteSummary>();
    for (const b of biteNotes) {
      m.set(b.redemption_id, b);
    }
    return m;
  }, [biteNotes]);

  const streakBadge = getStreakBadgeForLongest(streak.longestStreak);
  const nextMilestone = getNextBadgeMilestoneMonths(streak.longestStreak);
  const badgeProgress = getBadgeProgress(streak.longestStreak);
  const streakLabel =
    streak.currentStreak === 1
      ? '1 month streak'
      : `${streak.currentStreak} month streak`;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-6">
      <Card className="overflow-hidden border-orange-200/80 bg-gradient-to-br from-orange-50/90 to-background dark:border-orange-900/40 dark:from-orange-950/25">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#E85D26]/15 text-[#E85D26]">
                <Flame className="size-6" aria-hidden />
              </div>
              <div>
                <CardTitle className="text-lg">Dining streak</CardTitle>
                <CardDescription>
                  {streak.currentStreak > 0 ? (
                    <span className="font-medium text-foreground">{streakLabel}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      Start your streak this month!
                    </span>
                  )}
                </CardDescription>
              </div>
            </div>
            {streakBadge && (
              <Badge
                variant="secondary"
                className="shrink-0 border-[#E85D26]/30 bg-[#E85D26]/10 text-[#E85D26] dark:bg-[#E85D26]/20"
              >
                {streakBadge.label}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <p className="text-sm text-muted-foreground">
            Longest streak:{' '}
            <span className="font-medium text-foreground">
              {streak.longestStreak}{' '}
              {streak.longestStreak === 1 ? 'month' : 'months'}
            </span>
            {streak.totalMonthsActive > 0 && (
              <>
                {' '}
                · {streak.totalMonthsActive} distinct{' '}
                {streak.totalMonthsActive === 1 ? 'month' : 'months'} with a visit
              </>
            )}
          </p>
          {streak.longestStreak >= 1 && nextMilestone != null && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Progress to next badge</span>
                <span>{nextMilestone} mo. longest</span>
              </div>
              <Progress
                value={Math.round(badgeProgress * 100)}
                max={100}
                className="h-1.5 bg-muted"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {currentChallenge ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">This month&apos;s challenges</h2>
            <p className="text-sm text-muted-foreground">
              Swaps remaining: <span className="font-medium text-foreground">{swapsRemaining}/1</span>
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {activeItems.map((item) => (
              <RestaurantCard
                key={item.challengeItem.id}
                item={item}
                cycleCreatedAt={currentChallenge.cycle.created_at}
                canSwap={canSwap}
                isSwapping={swappingItemId === item.challengeItem.id}
                isRedeeming={redeemingItemId === item.challengeItem.id}
                onSwap={handleSwap}
                onRedeem={handleRedeem}
                userId={testUser.id}
                biteNote={
                  item.redemptionId
                    ? biteNoteByRedemptionId.get(item.redemptionId)
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Welcome! Start your journey</CardTitle>
            <CardDescription>
              Generate your two restaurant challenges for this month.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? 'Generating…' : 'Generate Challenge'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
