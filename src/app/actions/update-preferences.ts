'use server';

import { createClient } from '@/lib/supabase/server';
import { normalizeCuisineIds } from '@/lib/cuisines';

export async function updatePreferences(values: {
  dietary_flags: string[];
  excluded_cuisines: string[];
  distance_band: string;
  wants_cocktail_experience: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'You must be signed in.' };

    const excluded = normalizeCuisineIds(values.excluded_cuisines ?? []);

    // Use the signed-in user's client (RLS) so writes match policies on user_profiles + user_preferences.
    const { error: profileError } = await supabase.from('user_profiles').upsert(
      {
        id: user.id,
        email: user.email ?? null,
        dietary_flags: values.dietary_flags?.length ? values.dietary_flags : null,
        distance_band: values.distance_band,
        wants_cocktail_experience: Boolean(values.wants_cocktail_experience),
        role: 'subscriber',
      },
      { onConflict: 'id' }
    );

    if (profileError) return { ok: false, error: profileError.message };

    const { error: prefsError } = await supabase.from('user_preferences').upsert(
      {
        user_id: user.id,
        excluded_cuisines: excluded,
      },
      { onConflict: 'user_id' }
    );

    if (prefsError) return { ok: false, error: prefsError.message };
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to save preferences.';
    return { ok: false, error: message };
  }
}
