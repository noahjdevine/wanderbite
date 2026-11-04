'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Flame } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  generateMonthlyChallenge,
  type GeneratedChallenge,
} from '@/app/actions/generate-challenge';
import { swapChallengeItem } from '@/app/actions/swap-challenge';
import { redeemChallengeItem } from '@/app/actions/redeem-challenge';
import { PROGRESS_UNAVAILABLE_MESSAGE } from '@/lib/progress/rules';
import type { BiteNoteSummary } from '@/app/actions/bite-notes';
import { AreaHoldNotice } from '@/components/area-hold-notice';
import { distanceMatchCopy } from '@/lib/launch-market';
import { RestaurantCard } from '@/components/dashboard/restaurant-card';
import { CarriedCreditsSection } from '@/components/challenges/carried-credits-section';
import { MonthlyCuration } from '@/components/challenges/monthly-curation';
import type { CarriedCreditView } from '@/lib/challenges/carried-credits';
import {
  MONTHLY_REVEAL_FOCUS_KEY,
  REVEAL_TRY_AGAIN,
  reasonForSlot,
  type MonthlyRevealPanel,
} from '@/lib/challenges/monthly-reveal-copy';
import type { RecipeSections } from '@/lib/recipes/display';

export type DashboardStreakStats = {
  currentStreak: number;
  longestStreak: number;
  totalMonthsActive: number;
};

export type DashboardEarnedBadge = {
  id: string;
  name: string;
  earnedOn: string | null;
};

export type DashboardNextBadge = {
  name: string;
  current: number;
  target: number;
};

type DashboardClientProps = {
  launchEligible: boolean;
  currentChallenge: GeneratedChallenge | null;
  streak: DashboardStreakStats;
  /** True when getMemberProgress could not be read. Hides streak numbers. */
  progressUnavailable?: boolean;
  earnedBadges?: DashboardEarnedBadge[];
  showFirstBiteLocked?: boolean;
  nextBadge?: DashboardNextBadge | null;
  biteNotes: BiteNoteSummary[];
  /** Set only for a credits-workflow account. Legacy accounts omit it. */
  creditHold?: { pendingCount: number } | null;
  /** Credits workflow only. Null keeps the legacy per-cycle swap count. */
  creditsSwapRemaining?: number | null;
  carriedCredits?: CarriedCreditView[];
  /** Default off. Challenges passes curation or the saved reveal. */
  monthlyReveal?: MonthlyRevealPanel;
  /** Dashboard hides Generate Challenge while monthly reveal is available. */
  blockMemberGenerate?: boolean;
  /** Empty when E05_RECIPES_ENABLED is not exactly true. */
  recipeSections?: RecipeSections;
};

export function DashboardClient({
  launchEligible,
  currentChallenge,
  streak,
  progressUnavailable = false,
  earnedBadges = [],
  showFirstBiteLocked = false,
  nextBadge = null,
  biteNotes,
  creditHold = null,
  creditsSwapRemaining = null,
  carriedCredits = [],
  monthlyReveal = { mode: 'off' },
  blockMemberGenerate = false,
  recipeSections = { exclusionLine: null, byRestaurantId: {} },
}: DashboardClientProps) {
  const router = useRouter();
  const pairHeadingRef = useRef<HTMLHeadingElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [swappingItemId, setSwappingItemId] = useState<string | null>(null);
  const [redeemingItemId, setRedeemingItemId] = useState<string | null>(null);

  async function handleGenerate() {
    setIsGenerating(true);
    try {
      const result = await generateMonthlyChallenge();
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
      const result = await swapChallengeItem(challengeItemId);
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
      const result = await redeemChallengeItem(challengeItemId);
      if (result.ok) {
        router.push(`/challenges/show/${result.data.redemptionId}`);
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
  const swapsRemaining =
    creditsSwapRemaining == null ? Math.max(0, 1 - swapCountUsed) : creditsSwapRemaining;
  const canSwap = swapsRemaining > 0 && launchEligible;
  const useStoredDeadline = creditsSwapRemaining != null;
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

  const streakLabel =
    streak.currentStreak === 1
      ? '1 month streak'
      : `${streak.currentStreak} month streak`;
  const revealDetails = monthlyReveal.mode === 'revealed';
  const revealReasons = monthlyReveal.mode === 'revealed' ? monthlyReveal.reasons : null;

  useEffect(() => {
    if (!revealDetails) return;
    try {
      if (sessionStorage.getItem(MONTHLY_REVEAL_FOCUS_KEY) !== '1') return;
      sessionStorage.removeItem(MONTHLY_REVEAL_FOCUS_KEY);
    } catch {
      return;
    }
    pairHeadingRef.current?.focus();
  }, [revealDetails, currentChallenge?.cycle.id]);

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
                  {progressUnavailable ? (
                    <span className="text-muted-foreground">{PROGRESS_UNAVAILABLE_MESSAGE}</span>
                  ) : streak.currentStreak > 0 ? (
                    <span className="font-medium text-foreground">{streakLabel}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      Start your streak this month!
                    </span>
                  )}
                </CardDescription>
              </div>
            </div>
            {progressUnavailable || (earnedBadges.length === 0 && !showFirstBiteLocked) ? null : (
              <div className="flex flex-wrap justify-end gap-2">
                {earnedBadges.map((badge) => (
                  <Badge
                    key={badge.id}
                    variant="secondary"
                    className="shrink-0 border-[#E85D26]/30 bg-[#E85D26]/10 text-[#E85D26] dark:bg-[#E85D26]/20"
                  >
                    {badge.name}
                    {badge.earnedOn ? ` · ${badge.earnedOn}` : ''}
                  </Badge>
                ))}
                {showFirstBiteLocked ? (
                  <Badge variant="outline" className="shrink-0 text-muted-foreground">
                    First Bite locked
                  </Badge>
                ) : null}
              </div>
            )}
          </div>
        </CardHeader>
        {progressUnavailable ? null : (
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
          {nextBadge != null && nextBadge.target > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Progress to {nextBadge.name}</span>
                <span>
                  {nextBadge.current} / {nextBadge.target}
                </span>
              </div>
              <Progress
                value={Math.min(100, Math.round((nextBadge.current / nextBadge.target) * 100))}
                max={100}
                className="h-1.5 bg-muted"
              />
            </div>
          ) : null}
        </CardContent>
        )}
      </Card>

      {launchEligible ? null : <AreaHoldNotice />}

      {monthlyReveal.mode === 'retry' ? (
        <p role="alert" className="text-sm text-destructive">
          {REVEAL_TRY_AGAIN}
        </p>
      ) : null}

      {currentChallenge ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2
              ref={pairHeadingRef}
              tabIndex={revealDetails ? -1 : undefined}
              className="text-lg font-semibold outline-none"
            >
              This month&apos;s challenges
            </h2>
            <p className="text-sm text-muted-foreground">
              Swaps remaining: <span className="font-medium text-foreground">{swapsRemaining}/1</span>
            </p>
          </div>
          {currentChallenge.distanceMatch ? (
            <p className="text-sm text-muted-foreground">
              {distanceMatchCopy(currentChallenge.distanceMatch)}
            </p>
          ) : null}
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
                biteNote={
                  item.redemptionId
                    ? biteNoteByRedemptionId.get(item.redemptionId)
                    : undefined
                }
                useStoredDeadline={useStoredDeadline}
                storedDeadline={item.challengeItem.redemption_deadline ?? null}
                showRevealDetails={revealDetails}
                revealReason={
                  revealReasons
                    ? reasonForSlot(revealReasons, item.challengeItem.restaurant_id)
                    : null
                }
                recipes={recipeSections.byRestaurantId[item.restaurant.id] ?? []}
                recipeExclusionLine={recipeSections.exclusionLine}
              />
            ))}
          </div>
          {revealDetails ? (
            <p className="sr-only" role="status">
              Your challenges for this month are ready.
            </p>
          ) : null}
        </div>
      ) : creditHold ? (
        <Card>
          <CardHeader>
            <CardTitle>Your credits are waiting</CardTitle>
            <CardDescription>
              {creditHold.pendingCount === 2
                ? 'You have 2 credits for this month. Restaurant selection is not open yet.'
                : 'Restaurant selection is not open yet.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : monthlyReveal.mode === 'retry' ? null : monthlyReveal.mode === 'curation' && launchEligible ? (
        <MonthlyCuration constraintLines={monthlyReveal.constraintLines} />
      ) : blockMemberGenerate && launchEligible ? (
        <Card>
          <CardHeader>
            <CardTitle>Reveal your challenges</CardTitle>
            <CardDescription>
              This month’s pair is chosen on the Challenges page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/challenges">Go to Challenges</Link>
            </Button>
          </CardContent>
        </Card>
      ) : launchEligible ? (
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
      ) : null}

      <CarriedCreditsSection
        credits={carriedCredits}
        swapsRemaining={swapsRemaining}
        swappingItemId={swappingItemId}
        redeemingItemId={redeemingItemId}
        onSwap={handleSwap}
        onRedeem={handleRedeem}
        biteNoteByRedemptionId={biteNoteByRedemptionId}
        launchEligible={launchEligible}
        recipeSections={recipeSections}
      />
    </div>
  );
}
