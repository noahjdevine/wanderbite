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

/**
 * Canonical origin for Supabase email links (`emailRedirectTo`).
 * Prefer `NEXT_PUBLIC_SITE_URL` (or `NEXT_PUBLIC_BASE_URL`) in production so confirmation
 * emails always point at your primary domain; falls back to `window.location.origin` on the client.
 */
export function getEmailConfirmCallbackUrl(): string {
  const envBase =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.NEXT_PUBLIC_BASE_URL?.trim();
  let origin: string;
  if (envBase) {
    origin = trimTrailingSlash(envBase);
  } else if (typeof window !== 'undefined') {
    origin = window.location.origin;
  } else {
    origin = '';
  }
  if (!origin) {
    throw new Error(
      'Cannot build auth callback URL: set NEXT_PUBLIC_SITE_URL or NEXT_PUBLIC_BASE_URL, or call from the browser.'
    );
  }
  return `${origin}/auth/callback`;
}
