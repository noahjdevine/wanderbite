'use server';

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireUser } from '@/lib/auth/require-user';
import { ACCOUNT_CHANGED_MESSAGE } from '@/lib/auth/account-changed';

export async function updateProfileStructured(
  values: {
    username: string;
    address: { street: string; city: string; state: string; zip: string };
  },
  renderedForUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const auth = await requireUser();
    if (!auth.ok) return { ok: false, error: auth.error };
    if (renderedForUserId !== auth.userId) {
      return { ok: false, error: ACCOUNT_CHANGED_MESSAGE };
    }

    const username = values.username.trim();
    if (username.length < 3) return { ok: false, error: 'Username must be at least 3 characters.' };
    if (username.length > 20) return { ok: false, error: 'Username must be 20 characters or fewer.' };
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return { ok: false, error: 'Username may only contain letters, numbers, and underscores.' };
    }

    const street = values.address.street.trim();
    const city = values.address.city.trim();
    const state = values.address.state.trim().toUpperCase();
    const zip = values.address.zip.trim();
    if (!street || !city || state.length !== 2) {
      return { ok: false, error: 'Please fill out your full address.' };
    }
    if (!/^\d{5}(-\d{4})?$/.test(zip)) {
      return { ok: false, error: 'ZIP must be 5 digits or ZIP+4.' };
    }

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('user_profiles')
      .upsert(
        {
          id: auth.userId,
          email: auth.email,
          username,
          address_street: street,
          address_city: city,
          address_state: state,
          address_zip: zip,
        },
        { onConflict: 'id' },
      )
      .select('id');

    if (error) {
      if (error.code === '23505') return { ok: false, error: 'That username is already taken.' };
      return { ok: false, error: error.message };
    }
    const rows = data ?? [];
    if (rows.length !== 1 || rows[0]?.id !== auth.userId) {
      return { ok: false, error: 'Unable to save your profile right now. Please try again.' };
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to save profile.';
    return { ok: false, error: message };
  }
}
