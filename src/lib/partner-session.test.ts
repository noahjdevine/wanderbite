import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PARTNER_COOKIE_KIOSK_MAX_AGE,
  PARTNER_COOKIE_MAX_AGE,
  PARTNER_SESSION_TOKEN_PATTERN,
  generatePartnerSessionToken,
  hashPartnerSessionToken,
  partnerSessionCookieExpireOptions,
  partnerSessionCookieOptions,
  sessionExpiresAt,
} from '@/lib/partner-session';

describe('partner session token helpers', () => {
  it('issues a 32-byte unpadded base64url token and hashes the raw bytes', () => {
    const { token, tokenHash } = generatePartnerSessionToken();
    expect(token).toMatch(PARTNER_SESSION_TOKEN_PATTERN);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPartnerSessionToken(token)).toBe(tokenHash);

    const bytes = Buffer.from(token, 'base64url');
    expect(bytes).toHaveLength(32);
    const hashedString = createHash('sha256').update(token, 'utf8').digest('hex');
    expect(tokenHash).not.toBe(hashedString);
    expect(tokenHash).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it.each([
    'not-a-token',
    'abc',
    '50000000-0000-4000-8000-000000000001',
    `${randomBytes(32).toString('base64url')}=`,
    randomBytes(16).toString('base64url'),
  ])('rejects malformed or UUID cookies: %s', (token) => {
    expect(hashPartnerSessionToken(token)).toBeNull();
  });

  it('sets httpOnly path=/ lax cookies and expires with maxAge 0', () => {
    const live = partnerSessionCookieOptions(PARTNER_COOKIE_MAX_AGE);
    expect(live).toEqual({
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: PARTNER_COOKIE_MAX_AGE,
    });
    expect(partnerSessionCookieOptions(PARTNER_COOKIE_KIOSK_MAX_AGE).maxAge).toBe(
      PARTNER_COOKIE_KIOSK_MAX_AGE,
    );
    expect(partnerSessionCookieExpireOptions()).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  });

  it('computes expires_at from the same TTL used for the cookie', () => {
    const now = new Date('2026-09-06T12:00:00.000Z');
    expect(sessionExpiresAt(PARTNER_COOKIE_MAX_AGE, now)).toBe(
      new Date(now.getTime() + PARTNER_COOKIE_MAX_AGE * 1000).toISOString(),
    );
  });
});
