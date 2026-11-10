'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  generateMonthlyChallenge,
  type GeneratedChallenge,
} from '@/app/actions/generate-challenge';
import { swapChallengeItem } from '@/app/actions/swap-challenge';
import { redeemChallengeItem } from '@/app/actions/redeem-challenge';
import type { BiteNoteSummary } from '@/app/actions/bite-notes';
import { AreaHoldNotice } from '@/components/area-hold-notice';
import { distanceMatchCopy } from '@/lib/launch-market';
import { RestaurantCard } from '@/components/dashboard/restaurant-card';
import { StreakPanel } from '@/components/dashboard/streak-panel';
import { AdventureTicket } from '@/components/challenges/adventure-ticket';
import { MakeupOpportunities } from '@/components/challenges/makeup-opportunities';
import type { MemberMakeupSpot } from '@/lib/boost/visit-problem';
import { ChallengesGolden } from '@/components/challenges/challenges-golden';
import {
  adventureMonthName,
  adventureStatTiles,
  daysLeftInChicagoMonth,
  daysLeftLabel,
  swapsRemainingForHeader,
} from '@/lib/challenges/adventure-header';
import { FocusVisitFromHash } from '@/components/notes/focus-visit';
import { CarriedCreditsSection } from '@/components/challenges/carried-credits-section';
import { MonthlyCuration } from '@/components/challenges/monthly-curation';
import type { CarriedCreditView } from '@/lib/challenges/carried-credits';
import {
  MONTHLY_REVEAL_FOCUS_KEY,
  REVEAL_TRY_AGAIN,
  reasonForSlot,
  type MonthlyRevealPanel,
} from '@/lib/challenges/monthly-reveal-copy';
import type { ActivitySuggestions } from '@/lib/activities/types';
import type { RestaurantBriefings } from '@/lib/briefings/types';
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
  /** Editor return path. Challenges and the dashboard each pass their own. */
  memoryReturnTo?: string;
  /**
   * Credits workflow with a pending credit for this America/Chicago month.
   * A zero count is not a hold and falls through to the same empty state as null.
   */
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
  /** Empty when E06_ACTIVITIES_ENABLED is not exactly true. */
  activitySuggestions?: ActivitySuggestions;
  /** Empty when E06_BRIEFINGS_ENABLED is not exactly true. */
  briefings?: RestaurantBriefings;
  /** Challenges uses the Golden Hour sheet. Dashboard keeps the classic stack. */
  appearance?: 'classic' | 'golden';
  /** Exact E07_ARRIVAL_SESSIONS_ENABLED. Default false shows no Boost check-in. */
  boostCheckIn?: boolean;
  /** Exact E07_VISIT_PROBLEMS_ENABLED. Default false hides problem reporting. */
  visitProblems?: boolean;
  /** Make-up spots from a reviewed visit. Empty unless that flag is on. */
  makeupSpots?: readonly MemberMakeupSpot[];
  /** Golden sheet only. The classic page renders this notice itself. */
  showIncompleteProfile?: boolean;
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
  memoryReturnTo = '/challenges',
  creditHold = null,
  creditsSwapRemaining = null,
  carriedCredits = [],
  monthlyReveal = { mode: 'off' },
  blockMemberGenerate = false,
  recipeSections = { exclusionLine: null, byRestaurantId: {} },
  activitySuggestions = { byRestaurantId: {} },
  briefings = { byRestaurantId: {} },
  appearance = 'classic',
  showIncompleteProfile = false,
  boostCheckIn = false,
  visitProblems = false,
  makeupSpots = [],
}: DashboardClientProps) {
  const router = useRouter();
  const [headerNow] = useState(() => new Date());
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
        item.challengeItem.status === 'redeemed' ||
        item.challengeItem.status === 'expired'
    ) ?? [];

  const biteNoteByRedemptionId = useMemo(() => {
    const m = new Map<string, BiteNoteSummary>();
    for (const b of biteNotes) {
      m.set(b.redemption_id, b);
    }
    return m;
  }, [biteNotes]);

  const revealDetails = monthlyReveal.mode === 'revealed';
  const revealReasons = monthlyReveal.mode === 'revealed' ? monthlyReveal.reasons : null;
  const creditsWaiting = (creditHold?.pendingCount ?? 0) > 0;

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

  const streakPanel = (
    <StreakPanel
      streak={streak}
      progressUnavailable={progressUnavailable}
      earnedBadges={earnedBadges}
      showFirstBiteLocked={showFirstBiteLocked}
      nextBadge={nextBadge}
    />
  );

  const selection = currentChallenge ? (
    <div className={appearance === 'golden' ? 'flex flex-col gap-5' : 'space-y-4'}>
      {appearance === 'classic' ? (
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
      ) : null}
      {currentChallenge.distanceMatch ? (
        <p className="text-sm text-muted-foreground">
          {distanceMatchCopy(currentChallenge.distanceMatch)}
        </p>
      ) : null}
      <div className={appearance === 'golden' ? 'grid gap-5 lg:grid-cols-2' : 'grid gap-4 sm:grid-cols-2'}>
        {activeItems.map((item) =>
          appearance === 'golden' ? (
            <AdventureTicket
              key={item.challengeItem.id}
              item={item}
              swapsRemaining={swapsRemaining}
              cycleCreatedAt={currentChallenge.cycle.created_at}
              canSwap={canSwap}
              isSwapping={swappingItemId === item.challengeItem.id}
              isRedeeming={redeemingItemId === item.challengeItem.id}
              onSwap={handleSwap}
              onRedeem={handleRedeem}
              biteNote={item.redemptionId ? biteNoteByRedemptionId.get(item.redemptionId) : undefined}
              memoryReturnTo={memoryReturnTo}
              useStoredDeadline={useStoredDeadline}
              storedDeadline={item.challengeItem.redemption_deadline ?? null}
              showRevealDetails={revealDetails}
              revealReason={
                revealReasons ? reasonForSlot(revealReasons, item.challengeItem.restaurant_id) : null
              }
              recipes={recipeSections.byRestaurantId[item.restaurant.id] ?? []}
              recipeExclusionLine={recipeSections.exclusionLine}
              activities={activitySuggestions.byRestaurantId[item.restaurant.id] ?? []}
              briefings={briefings.byRestaurantId[item.restaurant.id] ?? []}
              boostCheckIn={boostCheckIn}
              visitProblems={visitProblems}
            />
          ) : (
            <RestaurantCard
              key={item.challengeItem.id}
              item={item}
              cycleCreatedAt={currentChallenge.cycle.created_at}
              canSwap={canSwap}
              isSwapping={swappingItemId === item.challengeItem.id}
              isRedeeming={redeemingItemId === item.challengeItem.id}
              onSwap={handleSwap}
              onRedeem={handleRedeem}
              biteNote={item.redemptionId ? biteNoteByRedemptionId.get(item.redemptionId) : undefined}
              memoryReturnTo={memoryReturnTo}
              useStoredDeadline={useStoredDeadline}
              storedDeadline={item.challengeItem.redemption_deadline ?? null}
              showRevealDetails={revealDetails}
              revealReason={
                revealReasons ? reasonForSlot(revealReasons, item.challengeItem.restaurant_id) : null
              }
              recipes={recipeSections.byRestaurantId[item.restaurant.id] ?? []}
              recipeExclusionLine={recipeSections.exclusionLine}
              activities={activitySuggestions.byRestaurantId[item.restaurant.id] ?? []}
              briefings={briefings.byRestaurantId[item.restaurant.id] ?? []}
              visitProblems={visitProblems}
            />
          ),
        )}
      </div>
      {revealDetails ? (
        <p className="sr-only" role="status">
          Your challenges for this month are ready.
        </p>
      ) : null}
    </div>
  ) : creditsWaiting && creditHold ? (
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
        <CardDescription>This month’s pair is chosen on the Challenges page.</CardDescription>
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
        <CardDescription>Generate your two restaurant challenges for this month.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleGenerate} disabled={isGenerating}>
          {isGenerating ? 'Generating…' : 'Generate Challenge'}
        </Button>
      </CardContent>
    </Card>
  ) : null;

  const carried = (
    <CarriedCreditsSection
      credits={carriedCredits}
      swapsRemaining={swapsRemaining}
      swappingItemId={swappingItemId}
      redeemingItemId={redeemingItemId}
      onSwap={handleSwap}
      onRedeem={handleRedeem}
      biteNoteByRedemptionId={biteNoteByRedemptionId}
      memoryReturnTo={memoryReturnTo}
      launchEligible={launchEligible}
      recipeSections={recipeSections}
      activitySuggestions={activitySuggestions}
      briefings={briefings}
      visitProblems={visitProblems}
    />
  );

  if (appearance === 'golden') {
    return (
      <div>
        <FocusVisitFromHash />
        <ChallengesGolden
          monthName={adventureMonthName(currentChallenge?.cycle.cycle_month, headerNow)}
          daysLabel={daysLeftLabel(daysLeftInChicagoMonth(headerNow))}
          tiles={adventureStatTiles({
            activeItems: currentChallenge ? activeItems : null,
            swapsRemaining: swapsRemainingForHeader(
              currentChallenge ? swapCountUsed : null,
              creditsSwapRemaining,
            ),
            makeupIssuedCodes: visitProblems
              ? makeupSpots.filter((spot) => spot.codeIssued).length
              : 0,
          })}
          headingRef={pairHeadingRef}
          revealFocus={revealDetails}
          showIncompleteProfile={showIncompleteProfile}
          launchEligible={launchEligible}
          retryMessage={monthlyReveal.mode === 'retry' ? REVEAL_TRY_AGAIN : null}
          primary={
            <>
              {visitProblems ? <MakeupOpportunities spots={makeupSpots} /> : null}
              {selection}
            </>
          }
          streak={streakPanel}
          carried={carried}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-6">
      <FocusVisitFromHash />
      {streakPanel}

      {launchEligible ? null : <AreaHoldNotice />}

      {monthlyReveal.mode === 'retry' ? (
        <p role="alert" className="text-sm text-destructive">
          {REVEAL_TRY_AGAIN}
        </p>
      ) : null}

      {visitProblems ? <MakeupOpportunities spots={makeupSpots} /> : null}
      {selection}
      {carried}
    </div>
  );
}
