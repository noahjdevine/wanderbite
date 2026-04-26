'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  DISTANCE_BANDS,
  type CompleteOnboardingResult,
  type DistanceBand,
  type OnboardingData,
} from '@/lib/onboarding-shared';

export async function completeOnboarding(
  data: OnboardingData
): Promise<CompleteOnboardingResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'You must be signed in to complete onboarding.' };
  }

  const distanceBand = data.distance_band as DistanceBand;
  if (!DISTANCE_BANDS.includes(distanceBand)) {
    return { ok: false, error: 'Invalid distance band.' };
  }

  const wantsCocktail = Boolean(data.wants_cocktail_experience);

  const admin = getSupabaseAdmin();
  // Idempotent: user may revisit onboarding or re-submit.
  const { error: upsertError } = await admin
    .from('user_profiles')
    .upsert(
      {
        id: user.id,
        email: user.email ?? null,
        dietary_flags: data.dietary_flags?.length ? data.dietary_flags : null,
        distance_band: distanceBand,
        wants_cocktail_experience: wantsCocktail,
        role: 'subscriber',
      },
      { onConflict: 'id' }
    );

  if (upsertError) {
    return { ok: false, error: upsertError.message };
  }

  const { data: profile } = await admin
    .from('user_profiles')
    .select('subscription_status')
    .eq('id', user.id)
    .maybeSingle();

  const sub = (profile as { subscription_status: string | null } | null)?.subscription_status ?? null;
  redirect(sub === 'active' ? '/challenges' : '/pricing');
}
