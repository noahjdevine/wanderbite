'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function updateProfile(data: {
  full_name: string | null;
  email: string | null;
  username: string | null;
  phone_number: string | null;
  address: string | null;
  dietary_flags: string[] | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
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
  revalidatePath('/account');
  revalidatePath('/profile');
  revalidatePath('/journey');
  revalidatePath('/challenges');
  return { ok: true };
}
