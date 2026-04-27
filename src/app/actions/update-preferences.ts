'use server';

import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
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

    const admin = getSupabaseAdmin();
    const excluded = normalizeCuisineIds(values.excluded_cuisines);
    const { error } = await admin
      .from('user_profiles')
      .upsert(
        {
          id: user.id,
          email: user.email ?? null,
          dietary_flags: values.dietary_flags?.length ? values.dietary_flags : null,
          distance_band: values.distance_band,
          wants_cocktail_experience: Boolean(values.wants_cocktail_experience),
          excluded_cuisines: excluded,
          role: 'subscriber',
        },
        { onConflict: 'id' }
      );

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to save preferences.';
    return { ok: false, error: message };
  }
}

