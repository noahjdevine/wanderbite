'use server';

import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const USERNAME_RE = /^[a-zA-Z0-9_]+$/;

export async function checkUsername(username: string): Promise<
  | { ok: true; status: 'available' | 'taken' | 'invalid' | 'too_short' | 'too_long' | 'unchanged' }
  | { ok: false; error: string }
> {
  const raw = username ?? '';
  const u = raw.trim();

  if (u.length < 3) return { ok: true, status: 'too_short' };
  if (u.length > 20) return { ok: true, status: 'too_long' };
  if (!USERNAME_RE.test(u)) return { ok: true, status: 'invalid' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const admin = getSupabaseAdmin();
  const { data: self } = await admin
    .from('user_profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle();

  const selfUsername =
    (self as { username: string | null } | null)?.username?.trim().toLowerCase() ?? null;
  if (selfUsername && selfUsername === u.toLowerCase()) {
    return { ok: true, status: 'unchanged' };
  }

  const { data: existing, error } = await admin
    .from('user_profiles')
    .select('id')
    .ilike('username', u)
    .limit(1);

  if (error) return { ok: false, error: error.message };

  return { ok: true, status: existing && existing.length > 0 ? 'taken' : 'available' };
}

