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

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

const PRODUCTION_FALLBACK_ORIGIN = 'https://wanderbite.co';

/**
 * Absolute URL for Supabase `emailRedirectTo` (signUp, resend).
 *
 * - **Browser:** `${window.location.origin}/auth/callback` so the link matches the host used at signup.
 * - **Server:** env (`NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_BASE_URL`), then production fallback so
 *   confirmation emails still target `/auth/callback` on the real site if env is missing in CI.
 */
export function getEmailConfirmCallbackUrl(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/auth/callback`;
  }

  const envBase =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
    PRODUCTION_FALLBACK_ORIGIN;
  return `${trimTrailingSlash(envBase)}/auth/callback`;
}
