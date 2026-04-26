/** Allow only same-origin relative paths for open-redirect-safe navigation. */
export function safeAuthRedirectPath(redirectTo: string | null | undefined, fallback = '/'): string {
  if (!redirectTo?.trim()) return fallback;
  try {
    const path = decodeURIComponent(redirectTo.trim());
    if (!path.startsWith('/') || path.startsWith('//')) return fallback;
    return path;
  } catch {
    return fallback;
  }
}

export const SIGNUP_EMAIL_CONFIRM_NEXT = '/onboarding';

export function getEmailConfirmCallbackUrl(origin: string): string {
  const next = encodeURIComponent(SIGNUP_EMAIL_CONFIRM_NEXT);
  return `${origin}/auth/callback?next=${next}`;
}
