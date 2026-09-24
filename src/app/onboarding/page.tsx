import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { normalizeCuisineIds } from '@/lib/cuisines';
import { hasStructuredAddress } from '@/lib/launch-market';
import { nextMemberRedirect, profileGate } from '@/lib/auth/member-destinations';
import type { UserPreferencesRow } from '@/types/user-preferences';
import { hasCurrentLegalAttestation } from '@/lib/legal-attestation-status';

export const dynamic = 'force-dynamic';

function hasProfileStepComplete(p: {
  username: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
}): boolean {
  return (
    Boolean(p.username?.trim()) &&
    hasStructuredAddress({
      street: p.address_street,
      city: p.address_city,
      state: p.address_state,
      zip: p.address_zip,
    })
  );
}

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/signin?redirectTo=/onboarding');
  }

  const admin = getSupabaseAdmin();
  const [profileResult, prefsResult, hasCurrentAttestation] = await Promise.all([
    admin
      .from('user_profiles')
      .select(
        'id, email, role, subscription_status, dietary_flags, distance_band, wants_cocktail_experience, username, address_street, address_city, address_state, address_zip'
      )
      .eq('id', user.id)
      .maybeSingle(),
    admin.from('user_preferences').select('excluded_cuisines').eq('user_id', user.id).maybeSingle(),
    hasCurrentLegalAttestation(supabase, user.id),
  ]);

  if (profileResult.error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-destructive">Unable to load your profile right now. Please try again.</p>
      </main>
    );
  }

  const profile = profileResult.data;
  const prefs = prefsResult.data;

  const sub = (profile as { subscription_status: string | null } | null)?.subscription_status ?? null;
  const gate = profileGate(
    profile as {
      role: string | null;
      subscription_status: string | null;
      username: string | null;
      address_street: string | null;
      address_city: string | null;
      address_state: string | null;
      address_zip: string | null;
    } | null,
  );
  const next = nextMemberRedirect('/onboarding', gate);
  if (next) redirect(next);

  const p = (profile as {
    id: string;
    email: string | null;
    dietary_flags: string[] | null;
    distance_band: string | null;
    wants_cocktail_experience: boolean | null;
    username: string | null;
    address_street: string | null;
    address_city: string | null;
    address_state: string | null;
    address_zip: string | null;
    subscription_status: string | null;
  } | null) ?? null;

  const step1Done = Boolean(p); // prefs step creates/updates the profile row
  const step2Done = p ? hasProfileStepComplete(p) : false;

  const initialStep: 1 | 2 | 3 = !step1Done ? 1 : !step2Done ? 2 : 3;

  return (
    <OnboardingWizard
      initial={{
        step: initialStep,
        userId: user.id,
        hasCurrentAttestation,
        email: user.email ?? null,
        subscriptionStatus: sub,
        preferences: {
          dietary_flags: p?.dietary_flags ?? [],
          excluded_cuisines: normalizeCuisineIds(
            (prefs as UserPreferencesRow | null)?.excluded_cuisines ?? []
          ),
          distance_band: p?.distance_band ?? '15_mi',
          wants_cocktail_experience: Boolean(p?.wants_cocktail_experience),
        },
        profile: {
          username: p?.username ?? '',
          address: {
            street: p?.address_street ?? '',
            city: p?.address_city ?? '',
            state: p?.address_state ?? '',
            zip: p?.address_zip ?? '',
          },
        },
      }}
    />
  );
}

