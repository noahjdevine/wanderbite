'use server';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/require-user';
import { ACCOUNT_CHANGED_MESSAGE } from '@/lib/auth/account-changed';
import { normalizeCuisineIds } from '@/lib/cuisines';

const SAVE_UNAVAILABLE = 'Unable to save preferences right now. Please try again.';

type ProfileFields = {
  email: string | null;
  dietary_flags: string[] | null;
  distance_band: string;
  wants_cocktail_experience: boolean;
};

type WriteError = { code?: string; message?: string; details?: string | null };

function isOwnProfileIdConflict(error: WriteError): boolean {
  if (error.code !== '23505') return false;
  const text = `${error.message ?? ''} ${error.details ?? ''}`;
  return /user_profiles_pkey/i.test(text) || /Key \(id\)=/i.test(text);
}

export async function updatePreferences(
  values: {
    dietary_flags: string[];
    excluded_cuisines: string[];
    distance_band: string;
    wants_cocktail_experience: boolean;
  },
  renderedForUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const auth = await requireUser();
    if (!auth.ok) return { ok: false, error: auth.error };
    if (renderedForUserId !== auth.userId) {
      return { ok: false, error: ACCOUNT_CHANGED_MESSAGE };
    }

    const fields: ProfileFields = {
      email: auth.email,
      dietary_flags: values.dietary_flags?.length ? values.dietary_flags : null,
      distance_band: values.distance_band,
      wants_cocktail_experience: Boolean(values.wants_cocktail_experience),
    };
    const excluded = normalizeCuisineIds(values.excluded_cuisines ?? []);
    const supabase = await createClient();

    const { data: existing, error: lookupError } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('id', auth.userId)
      .maybeSingle();
    if (lookupError) {
      return { ok: false, error: SAVE_UNAVAILABLE };
    }

    if (!existing) {
      const { error: insertError } = await supabase.from('user_profiles').insert({
        id: auth.userId,
        ...fields,
      });
      if (insertError) {
        if (!isOwnProfileIdConflict(insertError)) {
          return { ok: false, error: insertError.message };
        }
        const updated = await updateOwnPreferences(supabase, auth.userId, fields);
        if (!updated.ok) return updated;
      }
    } else {
      const updated = await updateOwnPreferences(supabase, auth.userId, fields);
      if (!updated.ok) return updated;
    }

    const { error: prefsError } = await supabase.from('user_preferences').upsert(
      {
        user_id: auth.userId,
        excluded_cuisines: excluded,
      },
      { onConflict: 'user_id' },
    );
    if (prefsError) return { ok: false, error: prefsError.message };
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to save preferences.';
    return { ok: false, error: message };
  }
}

async function updateOwnPreferences(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  fields: ProfileFields,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from('user_profiles')
    .update(fields)
    .eq('id', userId)
    .select('id');
  if (error) return { ok: false, error: error.message };
  const rows = data ?? [];
  if (rows.length !== 1 || rows[0]?.id !== userId) {
    return { ok: false, error: SAVE_UNAVAILABLE };
  }
  return { ok: true };
}
