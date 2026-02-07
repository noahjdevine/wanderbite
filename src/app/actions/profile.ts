'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type ProfileOnboardingCheck =
  | { needsCompletion: false }
  | { needsCompletion: true; username: string | null; address: string | null };

/** Used by Onboarding Modal: returns whether the user must complete username/address. */
export async function getProfileOnboardingCheck(): Promise<ProfileOnboardingCheck> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { needsCompletion: false };

  const admin = getSupabaseAdmin();
  const { data: row } = await admin
    .from('user_profiles')
    .select('username, address')
    .eq('id', user.id)
    .maybeSingle();

  if (!row) return { needsCompletion: false };
  const r = row as { username: string | null; address: string | null };
  const hasUsername = r.username != null && String(r.username).trim() !== '';
  const hasAddress = r.address != null && String(r.address).trim() !== '';
  if (hasUsername && hasAddress) return { needsCompletion: false };

  return { needsCompletion: true, username: r.username, address: r.address };
}

export type UpdateProfileOnboardingResult =
  | { ok: true }
  | { ok: false; error: string };

/** Update username and address (onboarding modal submit). */
export async function updateProfileOnboarding(
  username: string,
  address: string
): Promise<UpdateProfileOnboardingResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const trimmedUsername = username.trim();
  const trimmedAddress = address.trim();
  if (!trimmedUsername) return { ok: false, error: 'Username is required.' };
  if (!trimmedAddress) return { ok: false, error: 'Address is required.' };

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('user_profiles')
    .update({
      username: trimmedUsername,
      address: trimmedAddress,
    })
    .eq('id', user.id);

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'That username is already taken.' };
    return { ok: false, error: error.message };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export type ProfileFormData = {
  full_name: string | null;
  email: string | null;
  username: string | null;
  phone_number: string | null;
  address: string | null;
  dietary_flags: string[] | null;
};

export type UpdateProfileResult =
  | { ok: true }
  | { ok: false; error: string };

/** Update full profile (profile page form). */
export async function updateProfile(
  data: ProfileFormData
): Promise<UpdateProfileResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('user_profiles')
    .update({
      full_name: data.full_name?.trim() ?? null,
      email: data.email?.trim() || null,
      username: data.username?.trim() || null,
      phone_number: data.phone_number?.trim() || null,
      address: data.address?.trim() || null,
      dietary_flags: data.dietary_flags?.length ? data.dietary_flags : null,
    })
    .eq('id', user.id);

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'That username is already taken.' };
    return { ok: false, error: error.message };
  }
  revalidatePath('/profile');
  revalidatePath('/journey');
  revalidatePath('/challenges');
  return { ok: true };
}
