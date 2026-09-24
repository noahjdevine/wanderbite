import { describe, expect, it } from 'vitest';
import { resetPasswordGate } from '@/lib/auth/reset-password-gate';

describe('resetPasswordGate', () => {
  it('shows the password form for a session with no leftover secret', () => {
    expect(resetPasswordGate({ hasSession: true, code: null, tokenHash: null })).toEqual({
      type: 'form',
    });
  });

  it('drops leftover secrets without exchanging them again', () => {
    expect(
      resetPasswordGate({ hasSession: true, code: 'pkce-code', tokenHash: null }),
    ).toEqual({ type: 'redirect', to: '/reset-password' });
    expect(
      resetPasswordGate({ hasSession: true, code: null, tokenHash: 'otp-hash' }),
    ).toEqual({ type: 'redirect', to: '/reset-password' });
  });

  it('sends a code or token_hash with no session through /auth/recovery', () => {
    expect(resetPasswordGate({ hasSession: false, code: 'pkce-code', tokenHash: null })).toEqual({
      type: 'redirect',
      to: '/auth/recovery?code=pkce-code',
    });
    expect(resetPasswordGate({ hasSession: false, code: null, tokenHash: 'otp hash' })).toEqual({
      type: 'redirect',
      to: '/auth/recovery?token_hash=otp+hash',
    });
    expect(
      resetPasswordGate({ hasSession: false, code: 'pkce-code', tokenHash: 'otp-hash' }),
    ).toEqual({
      type: 'redirect',
      to: '/auth/recovery?code=pkce-code&token_hash=otp-hash',
    });
  });

  it('shows an invalid link when there is no session and no secret', () => {
    expect(resetPasswordGate({ hasSession: false, code: '  ', tokenHash: null })).toEqual({
      type: 'invalid',
    });
  });
});
