import { ordinarySignInPath, profileGate } from '@/lib/auth/member-destinations';
import { safeAuthRedirectPath } from '@/lib/auth/safe-redirect';

export const SIGN_IN_PROFILE_ERROR =
  'Unable to load your profile right now. Please try again.';

export type SignInProfileRow = Parameters<typeof profileGate>[0];

/**
 * Explicit redirectTo is rechecked here. An empty value is not explicit, so
 * the profile gate still chooses the destination.
 */
export function resolveSignInDestination(input: {
  redirectTo: string | null;
  profileError: boolean;
  profile: SignInProfileRow;
}): { ok: true; path: string } | { ok: false; error: string } {
  const explicit = input.redirectTo?.trim() ? input.redirectTo : null;
  if (explicit) {
    return { ok: true, path: safeAuthRedirectPath(explicit, '/dashboard') };
  }
  if (input.profileError) {
    return { ok: false, error: SIGN_IN_PROFILE_ERROR };
  }
  return { ok: true, path: ordinarySignInPath(profileGate(input.profile)) };
}

export function signInFieldErrors(
  email: string,
  password: string,
): { email?: string; password?: string } | null {
  const errors: { email?: string; password?: string } = {};
  const trimmed = email.trim();
  if (!trimmed) {
    errors.email = 'Enter your email.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    errors.email = "That doesn't look like a valid email.";
  }
  if (!password) {
    errors.password = 'Enter your password.';
  }
  return errors.email || errors.password ? errors : null;
}
