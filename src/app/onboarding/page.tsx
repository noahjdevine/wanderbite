import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';

export const dynamic = 'force-dynamic';

function hasProfileStepComplete(p: {
  username: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
}): boolean {
  return Boolean(
    p.username?.trim() &&
      p.address_street?.trim() &&
      p.address_city?.trim() &&
      p.address_state?.trim() &&
      p.address_zip?.trim()
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
  const { data: profile } = await admin
    .from('user_profiles')
    .select(
      'id, email, subscription_status, dietary_flags, distance_band, wants_cocktail_experience, cuisine_opt_out, username, address_street, address_city, address_state, address_zip'
    )
    .eq('id', user.id)
    .maybeSingle();

  // If active subscriber, onboarding is complete.
  const sub = (profile as { subscription_status: string | null } | null)?.subscription_status ?? null;
  if (sub === 'active') {
    redirect('/challenges');
  }

  const p = (profile as {
    id: string;
    email: string | null;
    dietary_flags: string[] | null;
    distance_band: string | null;
    wants_cocktail_experience: boolean | null;
    cuisine_opt_out: string[] | null;
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
        email: user.email ?? null,
        subscriptionStatus: sub,
        preferences: {
          dietary_flags: p?.dietary_flags ?? [],
          vibe_tags: p?.cuisine_opt_out ?? [],
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

