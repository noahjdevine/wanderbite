import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getCurrentChallenge } from '@/app/actions/generate-challenge';
import { getMemberProgress, presentMemberProgress } from '@/lib/progress/get-member-progress';
import { getBiteNotes } from '@/app/actions/bite-notes';
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import { SubscriptionSuccessToast } from '@/components/dashboard/paywall-card';
import { launchAreaState, resolveProfileAddress } from '@/lib/launch-market';
import { challengesCreditHold, pendingCreditsHeadFilters } from '@/lib/progress/progress-board';
import { nextMemberRedirect, profileGate } from '@/lib/auth/member-destinations';
import {
  loadCarriedCreditsForUser,
  loadCreditsSwapRemaining,
  type CarriedCreditView,
} from '@/lib/challenges/carried-credits';
import { showsMonthlyCuration } from '@/lib/challenges/monthly-cron-gate';
import { loadMonthlyRevealForChallenges } from '@/lib/challenges/load-monthly-reveal';
import { loadActivitySuggestions } from '@/lib/activities/load';
import { loadRestaurantBriefings } from '@/lib/briefings/load';
import { loadRecipeSections } from '@/lib/recipes/load';
import { arrivalSessionsEnabled, visitProblemsEnabled } from '@/lib/boost/flag';
import { loadMemberMakeupSpots } from '@/lib/boost/visit-problem-store';

export const dynamic = 'force-dynamic';

/**
 * Challenges: active month’s restaurant challenges. Requires signed-in + profile + active subscription.
 * Otherwise redirects to login, onboarding, or home (landing with Club CTA).
 */
export default async function ChallengesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/signin?redirectTo=/challenges');
  }

  const admin = getSupabaseAdmin();
  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('id, role, subscription_status, username, address, address_street, address_city, address_state, address_zip, workflow_version, distance_band')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-destructive">Failed to load profile: {profileError.message}</p>
      </main>
    );
  }

  if (!profile) {
    redirect('/onboarding');
  }

  const typedProfile = profile as {
    id: string;
    role: string | null;
    subscription_status: string | null;
    username: string | null;
    address: string | null;
    address_street: string | null;
    address_city: string | null;
    address_state: string | null;
    address_zip: string | null;
    workflow_version: string;
    distance_band: string | null;
  };

  const gate = profileGate({
    role: typedProfile.role,
    subscription_status: typedProfile.subscription_status,
    username: typedProfile.username,
    address: typedProfile.address,
    address_street: typedProfile.address_street,
    address_city: typedProfile.address_city,
    address_state: typedProfile.address_state,
    address_zip: typedProfile.address_zip,
  });
  const next = nextMemberRedirect('/challenges', gate);
  if (next) redirect(next);

  const resolvedAddress = resolveProfileAddress(typedProfile);
  const area = launchAreaState(resolvedAddress);

  const [progress, biteNotesRes] = await Promise.all([
    getMemberProgress(typedProfile.id),
    getBiteNotes(),
  ]);
  const presentedProgress = presentMemberProgress(progress);
  const biteNotesForDash =
    biteNotesRes.ok
      ? biteNotesRes.data.map((b) => ({
          id: b.id,
          redemption_id: b.redemption_id,
          note: b.note,
          rating: b.rating,
          is_public: b.is_public,
        }))
      : [];

  let creditHold: { pendingCount: number } | null = null;
  let creditsSwapRemaining: number | null = null;
  const creditsWorkflow = typedProfile.workflow_version === 'credits';
  if (creditsWorkflow) {
    const creditFilters = pendingCreditsHeadFilters(typedProfile.id, new Date());
    const [{ count, error: creditError }, swapRemaining] = await Promise.all([
      admin
        .from('entitlement_credits')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', creditFilters.userId)
        .eq('issue_period', creditFilters.issuePeriod)
        .eq('status', creditFilters.status),
      loadCreditsSwapRemaining(typedProfile.id),
    ]);
    if (creditError) {
      return (
        <main className="flex min-h-screen items-center justify-center p-6">
          <p className="text-destructive">Failed to load credits: {creditError.message}</p>
        </main>
      );
    }
    if (!swapRemaining.ok) {
      return (
        <main className="flex min-h-screen items-center justify-center p-6">
          <p className="text-destructive">{swapRemaining.error}</p>
        </main>
      );
    }
    creditHold = challengesCreditHold(count ?? 0);
    creditsSwapRemaining = swapRemaining.remaining;
  }

  let currentChallenge = null;
  try {
    currentChallenge = await getCurrentChallenge();
  } catch {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-destructive">
          Something went wrong loading your challenge. Please try again.
        </p>
      </main>
    );
  }

  let carriedCredits: CarriedCreditView[] = [];
  if (creditsWorkflow) {
    const excludeCreditIds = (currentChallenge?.items ?? []).flatMap((item) =>
      item.challengeItem.credit_id ? [item.challengeItem.credit_id] : [],
    );
    const carried = await loadCarriedCreditsForUser(typedProfile.id, { excludeCreditIds });
    if (!carried.ok) {
      return (
        <main className="flex min-h-screen items-center justify-center p-6">
          <p className="text-destructive">{carried.error}</p>
        </main>
      );
    }
    carriedCredits = carried.credits;
  }

  const activityRestaurants = [
    ...(currentChallenge?.items ?? []).map((item) => item.restaurant),
    ...carriedCredits.flatMap((credit) => (credit.item ? [credit.item.restaurant] : [])),
  ];
  const restaurantIds = activityRestaurants.map((restaurant) => restaurant.id);
  const [recipeSections, activitySuggestions, briefings] = await Promise.all([
    loadRecipeSections(restaurantIds),
    loadActivitySuggestions({
      restaurants: activityRestaurants,
      distanceBand: typedProfile.distance_band,
    }),
    loadRestaurantBriefings({ restaurantIds }),
  ]);

  const monthlyReveal = await loadMonthlyRevealForChallenges({
    userId: typedProfile.id,
    cycleMonth: currentChallenge?.cycle.cycle_month ?? null,
    showCuration: showsMonthlyCuration({
      launchEligible: area === 'eligible',
      creditsWorkflow,
      hasCurrentPair: Boolean(currentChallenge),
    }),
  });

  const makeupSpots = visitProblemsEnabled()
    ? await loadMemberMakeupSpots(typedProfile.id)
    : [];

  return (
    <main className="min-h-screen bg-wb-cream">
      <Suspense fallback={null}>
        <SubscriptionSuccessToast />
      </Suspense>
      <DashboardClient
        appearance="golden"
        boostCheckIn={arrivalSessionsEnabled()}
        visitProblems={visitProblemsEnabled()}
        makeupSpots={makeupSpots}
        showIncompleteProfile={!gate.profileComplete}
        launchEligible={area === 'eligible'}
        currentChallenge={currentChallenge}
        streak={presentedProgress.streak}
        progressUnavailable={presentedProgress.progressUnavailable}
        earnedBadges={presentedProgress.earnedBadges}
        showFirstBiteLocked={presentedProgress.showFirstBiteLocked}
        nextBadge={presentedProgress.nextBadge}
        biteNotes={biteNotesForDash}
        memoryReturnTo="/challenges"
        creditHold={creditHold}
        creditsSwapRemaining={creditsSwapRemaining}
        carriedCredits={carriedCredits}
        monthlyReveal={monthlyReveal}
        recipeSections={recipeSections}
        activitySuggestions={activitySuggestions}
        briefings={briefings}
      />
    </main>
  );
}
