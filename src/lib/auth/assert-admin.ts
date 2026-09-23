import 'server-only';

import {
  adminPageDecision,
  decideAdminAssurance,
  type AdminAccessCode,
} from '@/lib/auth/admin-assurance';
import { requireUser } from '@/lib/auth/require-user';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type AssertAdminResult =
  | { ok: true; userId: string; email: string | null }
  | { ok: false; error: string; code: AdminAccessCode };

const ERRORS: Record<AdminAccessCode, string> = {
  unauthenticated: 'You must be signed in.',
  not_admin: 'Unauthorized: admin access required.',
  role_lookup_failed: 'Failed to check admin permissions.',
  mfa_enroll: 'Authenticator setup is required before admin access.',
  mfa_challenge: 'Authenticator verification is required before admin access.',
  auth_error: 'Failed to check authenticator assurance.',
};

function failure(code: AdminAccessCode, error: string = ERRORS[code]): AssertAdminResult {
  return { ok: false, error, code };
}

/**
 * Current user plus database admin role. Does not check AAL and must not
 * be used for dashboard reads or admin mutations. The service-role read
 * here is the role lookup only.
 */
export async function assertAdminRole(): Promise<AssertAdminResult> {
  let auth: Awaited<ReturnType<typeof requireUser>>;
  try {
    auth = await requireUser();
  } catch {
    return failure('auth_error');
  }

  if (!auth.ok) return failure('unauthenticated', auth.error);

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('user_profiles')
      .select('role')
      .eq('id', auth.userId)
      .maybeSingle();

    if (error) return failure('role_lookup_failed');

    const role = (data as { role: string | null } | null)?.role ?? null;
    if (role !== 'admin') return failure('not_admin');

    return { ok: true, userId: auth.userId, email: auth.email };
  } catch {
    return failure('role_lookup_failed');
  }
}

/**
 * Every protected admin request checks three things before any service-role
 * read or write of admin data (restaurants, user emails, audit rows, mutations):
 * 1. The current user. Auth errors fail closed.
 * 2. user_profiles.role = 'admin'. A lookup error fails closed.
 * 3. The current session's authenticator assurance. currentLevel must be aal2.
 *
 * Call getAuthenticatorAssuranceLevel with the current session, not a
 * caller-supplied JWT. nextLevel aal2 is not enough. There is no
 * time-since-challenge window.
 *
 * Future offer, content, and export entry points must use this helper.
 * There is no sensitive admin export endpoint today.
 */
export async function assertAdmin(): Promise<AssertAdminResult> {
  const role = await assertAdminRole();
  if (!role.ok) return role;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) return failure('auth_error');

    const decision = decideAdminAssurance(
      data
        ? { currentLevel: data.currentLevel, nextLevel: data.nextLevel }
        : null,
    );
    if (!decision.ok) return failure(decision.code);
  } catch {
    return failure('auth_error');
  }

  return role;
}

export { adminPageDecision };
