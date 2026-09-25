import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getCurrentChallenge } from '@/app/actions/generate-challenge';
import { calculateStreak } from '@/lib/streaks';
import { getBiteNotes } from '@/app/actions/bite-notes';
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import { SubscriptionSuccessToast } from '@/components/dashboard/paywall-card';
import { chicagoMonthStart } from '@/lib/cron-period';
import { launchAreaState } from '@/lib/launch-market';
import { nextMemberRedirect, profileGate } from '@/lib/auth/member-destinations';

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
    .select('id, role, subscription_status, username, address_street, address_city, address_state, address_zip, workflow_version')
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
    address_street: string | null;
    address_city: string | null;
    address_state: string | null;
    address_zip: string | null;
    workflow_version: string;
  };

  const next = nextMemberRedirect(
    '/challenges',
    profileGate({
      role: typedProfile.role,
      subscription_status: typedProfile.subscription_status,
      username: typedProfile.username,
      address_street: typedProfile.address_street,
      address_city: typedProfile.address_city,
      address_state: typedProfile.address_state,
      address_zip: typedProfile.address_zip,
    }),
  );
  if (next) redirect(next);

  const area = launchAreaState({
    street: typedProfile.address_street,
    city: typedProfile.address_city,
    state: typedProfile.address_state,
    zip: typedProfile.address_zip,
  });

  const streak = await calculateStreak(typedProfile.id);

  const biteNotesRes = await getBiteNotes();
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
  if (typedProfile.workflow_version === 'credits') {
    const { count, error: creditError } = await admin
      .from('entitlement_credits')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', typedProfile.id)
      .eq('issue_period', chicagoMonthStart())
      .eq('status', 'pending');
    if (creditError) {
      return (
        <main className="flex min-h-screen items-center justify-center p-6">
          <p className="text-destructive">Failed to load credits: {creditError.message}</p>
        </main>
      );
    }
    creditHold = { pendingCount: count ?? 0 };
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

  return (
    <main className="min-h-screen bg-background">
      <Suspense fallback={null}>
        <SubscriptionSuccessToast />
      </Suspense>
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <h1 className="mb-8 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Culinary Adventure Awaits
        </h1>
        <DashboardClient
          launchEligible={area === 'eligible'}
          currentChallenge={currentChallenge}
          streak={streak}
          biteNotes={biteNotesForDash}
          creditHold={creditHold}
        />
      </div>
    </main>
  );
}
