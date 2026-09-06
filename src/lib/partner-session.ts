import { createHash, randomBytes } from 'node:crypto';

/** Opaque partner session cookie. Never a restaurant UUID. */
export const PARTNER_SESSION_COOKIE_NAME = 'partner_session';

/** Legacy forgeable cookie. Ignored for auth; cleared only on login/logout. */
export const LEGACY_PARTNER_COOKIE_NAME = 'partner_restaurant_id';

/** Default partner session (7 days), in seconds. */
export const PARTNER_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/** Host-stand / tablet “keep signed in” (90 days), in seconds. */
export const PARTNER_COOKIE_KIOSK_MAX_AGE = 60 * 60 * 24 * 90;

/** 32-byte token as unpadded base64url. */
export const PARTNER_SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const PARTNER_ANALYTICS_UNAVAILABLE_MESSAGE = 'Unable to load partner stats.';
export const PARTNER_SESSION_EXPIRED_MESSAGE = 'Partner session expired. Please log in again.';
export const PARTNER_LOGOUT_FAILED_MESSAGE = 'Unable to sign out. Please try again.';
export const PARTNER_SESSION_START_FAILED_MESSAGE =
  'Unable to start a partner session. Please try again.';

export type PartnerCookieSetOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
};

export function partnerSessionCookieOptions(maxAge: number): PartnerCookieSetOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

/** Expire a path=/ cookie. Next.js cookieStore.delete(name) cannot set path. */
export function partnerSessionCookieExpireOptions(): PartnerCookieSetOptions {
  return partnerSessionCookieOptions(0);
}

export function hashPartnerSessionToken(token: string): string | null {
  if (!PARTNER_SESSION_TOKEN_PATTERN.test(token)) return null;
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length !== 32) return null;
  return createHash('sha256').update(bytes).digest('hex');
}

export function generatePartnerSessionToken(): { token: string; tokenHash: string } {
  const bytes = randomBytes(32);
  const token = bytes.toString('base64url');
  const tokenHash = createHash('sha256').update(bytes).digest('hex');
  return { token, tokenHash };
}

export function sessionExpiresAt(maxAgeSeconds: number, now = new Date()): string {
  return new Date(now.getTime() + maxAgeSeconds * 1000).toISOString();
}
