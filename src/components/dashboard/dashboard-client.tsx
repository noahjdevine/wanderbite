'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
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
import {
  getBadgeProgress,
  getNextBadgeMilestoneMonths,
  getStreakBadgeForLongest,
} from '@/lib/streaks';
import type { BiteNoteSummary } from '@/app/actions/bite-notes';
import { AreaHoldNotice } from '@/components/area-hold-notice';
import { distanceMatchCopy } from '@/lib/launch-market';
import { RestaurantCard } from '@/components/dashboard/restaurant-card';
import { CarriedCreditsSection } from '@/components/challenges/carried-credits-section';
import type { CarriedCreditView } from '@/lib/challenges/carried-credits';

export type DashboardStreakStats = {
  currentStreak: number;
  longestStreak: number;
  totalMonthsActive: number;
};

type DashboardClientProps = {
  launchEligible: boolean;
  currentChallenge: GeneratedChallenge | null;
  streak: DashboardStreakStats;
  biteNotes: BiteNoteSummary[];
  /** Set only for a credits-workflow account. Legacy accounts omit it. */
  creditHold?: { pendingCount: number } | null;
  /** Credits workflow only. Null keeps the legacy per-cycle swap count. */
  creditsSwapRemaining?: number | null;
  carriedCredits?: CarriedCreditView[];
};

export function DashboardClient({
  launchEligible,
  currentChallenge,
  streak,
  biteNotes,
  creditHold = null,
  creditsSwapRemaining = null,
  carriedCredits = [],
}: DashboardClientProps) {
  const router = useRouter();
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

      {launchEligible ? null : <AreaHoldNotice />}

      {currentChallenge ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">This month&apos;s challenges</h2>
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
              />
            ))}
          </div>
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
      />
    </div>
  );
}
