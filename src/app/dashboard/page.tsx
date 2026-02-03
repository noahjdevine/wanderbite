import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getCurrentChallenge } from '@/app/actions/generate-challenge';
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import { SubscriptionSuccessToast } from '@/components/dashboard/paywall-card';

/**
 * Dedicated dashboard route. Requires signed-in + profile + active subscription.
 * Otherwise redirects to login, onboarding, or home (landing with Club CTA).
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const admin = getSupabaseAdmin();
  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('id, email, dietary_flags, subscription_status')
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
    email: string | null;
    dietary_flags: string[] | null;
    subscription_status: string | null;
  };

  if (typedProfile.subscription_status !== 'active') {
    redirect('/');
  }

  const { data: market, error: marketError } = await admin
    .from('markets')
    .select('id')
    .limit(1)
    .maybeSingle();

  if (marketError || !market) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-destructive">
          {marketError
            ? `Failed to load market: ${marketError.message}`
            : 'No market found. Run the seed script first.'}
        </p>
      </main>
    );
  }

  let currentChallenge = null;
  try {
    currentChallenge = await getCurrentChallenge(typedProfile.id);
  } catch (err) {
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
        <DashboardClient
          testUser={{
            id: typedProfile.id,
            email: typedProfile.email,
            dietary_flags: typedProfile.dietary_flags,
          }}
          marketId={market.id}
          currentChallenge={currentChallenge}
        />
      </div>
    </main>
  );
}
