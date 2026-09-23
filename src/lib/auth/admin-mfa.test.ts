import { describe, expect, it } from 'vitest';
import {
  adminMfaBypassGranted,
  isUnverifiedTotpFactor,
  isVerifiedTotpFactor,
  normalizeTotpCode,
  totpQrImageSrc,
} from '@/lib/auth/admin-mfa';

describe('admin MFA helpers', () => {
  it('never grants a production bypass', () => {
    expect(adminMfaBypassGranted()).toBe(false);
    expect(
      adminMfaBypassGranted({
        envFlag: 'true',
        query: 'skipMfa=1',
        sharedSecret: 'super-secret',
      }),
    ).toBe(false);
    expect(
      adminMfaBypassGranted({
        envFlag: 'MFA_BYPASS',
        query: 'bypass=1',
        sharedSecret: '',
      }),
    ).toBe(false);
  });

  it('accepts a 6-digit authenticator code only', () => {
    expect(normalizeTotpCode(' 123 456 ')).toBe('123456');
    expect(normalizeTotpCode('12345')).toBeNull();
    expect(normalizeTotpCode('1234567')).toBeNull();
    expect(normalizeTotpCode('12ab56')).toBeNull();
  });

  it('clears only unverified TOTP factors during enrollment', () => {
    expect(isUnverifiedTotpFactor({ factor_type: 'totp', status: 'unverified' })).toBe(true);
    expect(isUnverifiedTotpFactor({ factor_type: 'totp', status: 'verified' })).toBe(false);
    expect(isVerifiedTotpFactor({ factor_type: 'totp', status: 'verified' })).toBe(true);
    expect(isVerifiedTotpFactor({ factor_type: 'phone', status: 'verified' })).toBe(false);
  });

  it('builds an image src without dropping an existing data URL', () => {
    expect(totpQrImageSrc('<svg></svg>')).toBe('data:image/svg+xml;utf-8,<svg></svg>');
    expect(totpQrImageSrc('data:image/svg+xml;utf-8,<svg></svg>')).toBe(
      'data:image/svg+xml;utf-8,<svg></svg>',
    );
  });
});
