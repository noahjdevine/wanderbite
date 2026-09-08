import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { safeAuthRedirectPath, getEmailConfirmCallbackUrl } from './safe-redirect';

describe('safeAuthRedirectPath', () => {
  it('returns fallback for null/undefined/empty', () => {
    expect(safeAuthRedirectPath(null)).toBe('/');
    expect(safeAuthRedirectPath(undefined)).toBe('/');
    expect(safeAuthRedirectPath('')).toBe('/');
    expect(safeAuthRedirectPath('   ')).toBe('/');
  });

  it('returns the fallback when the path does not start with /', () => {
    expect(safeAuthRedirectPath('challenges')).toBe('/');
    expect(safeAuthRedirectPath('https://evil.com')).toBe('/');
    expect(safeAuthRedirectPath('http://evil.com/path')).toBe('/');
    expect(safeAuthRedirectPath('javascript:alert(1)')).toBe('/');
  });

  it('blocks protocol-relative URLs (//evil.com)', () => {
    expect(safeAuthRedirectPath('//evil.com')).toBe('/');
    expect(safeAuthRedirectPath('//evil.com/path')).toBe('/');
    expect(safeAuthRedirectPath('//google.com')).toBe('/');
  });

  it('blocks URL-encoded protocol-relative URLs', () => {
    expect(safeAuthRedirectPath('%2F%2Fevil.com')).toBe('/');
    expect(safeAuthRedirectPath('%2f%2fevil.com')).toBe('/');
  });

  it('accepts well-formed relative paths', () => {
    expect(safeAuthRedirectPath('/challenges')).toBe('/challenges');
    expect(safeAuthRedirectPath('/dashboard')).toBe('/dashboard');
    expect(safeAuthRedirectPath('/restaurants/some-slug')).toBe('/restaurants/some-slug');
    expect(safeAuthRedirectPath('/billing?session=xyz')).toBe('/billing?session=xyz');
    expect(safeAuthRedirectPath('/challenges?code=secret')).toBe('/challenges');
    expect(safeAuthRedirectPath('/challenges?code=secret&checkout=success')).toBe(
      '/challenges?checkout=success',
    );
    expect(safeAuthRedirectPath('/reset-password?type=recovery')).toBe(
      '/reset-password?type=recovery',
    );
    expect(safeAuthRedirectPath('/reset-password?code=abc&type=recovery')).toBe(
      '/reset-password',
    );
    expect(safeAuthRedirectPath('/journey?view=journal#section')).toBe(
      '/journey?view=journal#section',
    );
    expect(safeAuthRedirectPath('/#access_token=tok&type=recovery')).toBe('/');
  });

  it('uses the supplied fallback instead of the default', () => {
    expect(safeAuthRedirectPath(null, '/dashboard')).toBe('/dashboard');
    expect(safeAuthRedirectPath('//evil.com', '/dashboard')).toBe('/dashboard');
  });

  it('handles URL-encoded paths gracefully', () => {
    expect(safeAuthRedirectPath('%2Fchallenges')).toBe('/challenges');
    expect(safeAuthRedirectPath('/profile%20settings')).toBe('/profile settings');
    expect(safeAuthRedirectPath('%2Fchallenges%3Fcode%3Dsecret')).toBe('/challenges');
    expect(safeAuthRedirectPath('%2Fbilling%3Fsession%3Dxyz')).toBe('/billing?session=xyz');
  });

  it('returns the fallback when decodeURIComponent throws', () => {
    expect(safeAuthRedirectPath('%')).toBe('/');
    expect(safeAuthRedirectPath('%E0%A4%A')).toBe('/');
  });
});

describe('getEmailConfirmCallbackUrl', () => {
  // happy-dom defines window; stub it away so we exercise the server branch.
  beforeEach(() => {
    vi.stubGlobal('window', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the production fallback when no env is set and no window', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_BASE_URL;
    expect(getEmailConfirmCallbackUrl()).toBe('https://wanderbite.co/auth/callback');
  });

  it('uses NEXT_PUBLIC_SITE_URL when set', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://preview-123.vercel.app';
    expect(getEmailConfirmCallbackUrl()).toBe('https://preview-123.vercel.app/auth/callback');
  });

  it('trims trailing slashes', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://wanderbite.com/';
    expect(getEmailConfirmCallbackUrl()).toBe('https://wanderbite.com/auth/callback');
  });

  it('prefers NEXT_PUBLIC_SITE_URL over NEXT_PUBLIC_BASE_URL', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://wanderbite.com';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://otherwise.com';
    expect(getEmailConfirmCallbackUrl()).toBe('https://wanderbite.com/auth/callback');
  });
});
