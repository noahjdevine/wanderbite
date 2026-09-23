/**
 * Session authenticator assurance for admin access.
 *
 * Supabase distinguishes currentLevel from nextLevel. An enrolled factor
 * (nextLevel aal2) does not mean this session completed its challenge.
 * Only currentLevel === 'aal2' unlocks admin data.
 *
 * G14 "fresh" means this check runs on every protected request. There is
 * no time-since-challenge window and no step-up expiry.
 *
 * https://supabase.com/docs/reference/javascript/auth-mfa-getauthenticatorassurancelevel
 * https://supabase.com/docs/guides/auth/auth-mfa/totp
 */

export type AdminAssuranceCode = 'mfa_enroll' | 'mfa_challenge' | 'auth_error';

export type AdminAssuranceDecision =
  | { ok: true }
  | { ok: false; code: AdminAssuranceCode };

export type SessionAssuranceLevels = {
  currentLevel: string | null;
  nextLevel: string | null;
};

/**
 * Fail closed on a missing or unexpected level. nextLevel aal2 is not access.
 * currentAuthenticationMethods is intentionally unused: G14 does not
 * implement a time-since-challenge window.
 */
export function decideAdminAssurance(
  levels: SessionAssuranceLevels | null,
): AdminAssuranceDecision {
  if (!levels) return { ok: false, code: 'auth_error' };

  if (levels.currentLevel === 'aal2') return { ok: true };

  if (levels.currentLevel === 'aal1' && levels.nextLevel === 'aal2') {
    return { ok: false, code: 'mfa_challenge' };
  }

  if (levels.currentLevel === 'aal1' && levels.nextLevel === 'aal1') {
    return { ok: false, code: 'mfa_enroll' };
  }

  return { ok: false, code: 'auth_error' };
}

export type AdminAccessCode =
  | 'unauthenticated'
  | 'not_admin'
  | 'role_lookup_failed'
  | AdminAssuranceCode;

export function adminPageDecision(
  result: { ok: true } | { ok: false; code: AdminAccessCode },
):
  | { kind: 'dashboard' }
  | { kind: 'mfa'; mode: 'enroll' | 'challenge' }
  | { kind: 'redirect'; href: '/signin?redirectTo=/admin' | '/challenges' } {
  if (result.ok) return { kind: 'dashboard' };
  if (result.code === 'mfa_enroll') return { kind: 'mfa', mode: 'enroll' };
  if (result.code === 'mfa_challenge') return { kind: 'mfa', mode: 'challenge' };
  if (result.code === 'unauthenticated') {
    return { kind: 'redirect', href: '/signin?redirectTo=/admin' };
  }
  return { kind: 'redirect', href: '/challenges' };
}
