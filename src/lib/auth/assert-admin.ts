import 'server-only';

import { requireUser } from '@/lib/auth/require-user';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type AssertAdminResult =
  | { ok: true; userId: string; email: string | null }
  | { ok: false; error: string };

/**
 * Server-only helper that:
 * 1. Confirms there's a signed-in user.
 * 2. Confirms their user_profiles.role = 'admin'.
 *
 * Use at the top of every admin-only Server Action and inside server components
 * that render the admin dashboard.
 */
export async function assertAdmin(): Promise<AssertAdminResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('user_profiles')
    .select('role')
    .eq('id', auth.userId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: 'Failed to check admin permissions.' };
  }

  const role = (data as { role: string | null } | null)?.role ?? null;
  if (role !== 'admin') {
    return { ok: false, error: 'Unauthorized: admin access required.' };
  }

  return { ok: true, userId: auth.userId, email: auth.email };
}
