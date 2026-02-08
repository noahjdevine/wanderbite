'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const DISTANCE_BANDS = ['5_mi', '15_mi', '25_mi', '40_mi'] as const;
export type DistanceBand = (typeof DISTANCE_BANDS)[number];

export type OnboardingData = {
  dietary_flags: string[];
  distance_band: string;
  wants_cocktail_experience?: boolean;
};

export type CompleteOnboardingResult =
  | { ok: true }
  | { ok: false; error: string };

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
  const { error: insertError } = await admin.from('user_profiles').insert({
    id: user.id,
    email: user.email ?? null,
    dietary_flags: data.dietary_flags?.length ? data.dietary_flags : null,
    distance_band: distanceBand,
    wants_cocktail_experience: wantsCocktail,
    role: 'subscriber',
  });

  if (insertError) {
    if (insertError.code === '23505') {
      return { ok: false, error: 'Profile already exists.' };
    }
    return { ok: false, error: insertError.message };
  }

  redirect('/');
}
