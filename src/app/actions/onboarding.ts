'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type OnboardingData = {
  dietary_flags: string[];
  distance_band: string;
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

  const distanceBand = data.distance_band as 'close' | 'worth_trip' | 'adventure';
  if (!['close', 'worth_trip', 'adventure'].includes(distanceBand)) {
    return { ok: false, error: 'Invalid distance band.' };
  }

  const admin = getSupabaseAdmin();
  const { error: insertError } = await admin.from('user_profiles').insert({
    id: user.id,
    email: user.email ?? null,
    dietary_flags: data.dietary_flags?.length ? data.dietary_flags : null,
    distance_band: distanceBand,
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
