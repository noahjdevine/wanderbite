import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginAdminMfaEnrollment,
  verifyAdminMfaChallenge,
  verifyAdminMfaEnrollment,
} from './mfa-actions';

const FACTOR_ID = '50000000-0000-4000-8000-0000000000aa';
const VERIFIED_ID = '50000000-0000-4000-8000-0000000000bb';

const harness = vi.hoisted(() => ({
  calls: [] as string[],
  user: { ok: true as const, userId: 'user-a', email: 'a@example.com' } as
    | { ok: true; userId: string; email: string | null }
    | { ok: false; error: string },
  role: 'admin' as string | null,
  factors: [] as { id: string; factor_type: string; status: 'verified' | 'unverified' }[],
  listError: null as { message: string } | null,
  enroll: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
  unenroll: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Error(`REDIRECT:${href}`);
  },
}));

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: vi.fn(async () => harness.user),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      harness.calls.push(table);
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({
          data: harness.role ? { role: harness.role } : null,
          error: null,
        }),
      };
    },
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      mfa: {
        listFactors: async () => ({
          data: harness.listError
            ? null
            : {
                all: harness.factors,
                totp: harness.factors.filter(
                  (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
                ),
              },
          error: harness.listError,
        }),
        enroll: harness.enroll,
        challenge: harness.challenge,
        verify: harness.verify,
        unenroll: harness.unenroll,
      },
    },
  })),
}));

describe('admin MFA enrollment and challenge', () => {
  beforeEach(() => {
    harness.calls = [];
    harness.user = { ok: true, userId: 'user-a', email: 'a@example.com' };
    harness.role = 'admin';
    harness.factors = [];
    harness.listError = null;
    harness.enroll.mockReset();
    harness.challenge.mockReset();
    harness.verify.mockReset();
    harness.unenroll.mockReset();
    harness.enroll.mockResolvedValue({
      data: {
        id: FACTOR_ID,
        type: 'totp',
        totp: {
          qr_code: '<svg></svg>',
          secret: 'SECRET',
          uri: 'otpauth://totp/example',
        },
      },
      error: null,
    });
    harness.challenge.mockResolvedValue({ data: { id: 'challenge-1', type: 'totp' }, error: null });
    harness.verify.mockResolvedValue({ data: {}, error: null });
    harness.unenroll.mockResolvedValue({ data: { id: FACTOR_ID }, error: null });
  });

  it('enrolls an AAL1 admin without reading dashboard tables', async () => {
    harness.factors = [
      { id: '50000000-0000-4000-8000-0000000000cc', factor_type: 'totp', status: 'unverified' },
    ];
    const result = await beginAdminMfaEnrollment();
    expect(result).toEqual({
      ok: true,
      factorId: FACTOR_ID,
      qrCode: 'data:image/svg+xml;utf-8,<svg></svg>',
      secret: 'SECRET',
    });
    expect(harness.unenroll).toHaveBeenCalledWith({
      factorId: '50000000-0000-4000-8000-0000000000cc',
    });
    expect(harness.calls.every((table) => table === 'user_profiles')).toBe(true);
  });

  it('does not let a signed-in non-admin enroll or read factors', async () => {
    harness.role = 'member';
    await expect(beginAdminMfaEnrollment()).resolves.toEqual({
      ok: false,
      error: 'Unauthorized: admin access required.',
    });
    expect(harness.enroll).not.toHaveBeenCalled();
    expect(harness.unenroll).not.toHaveBeenCalled();
  });

  it('refuses a second enrollment when a verified factor already exists', async () => {
    harness.factors = [{ id: VERIFIED_ID, factor_type: 'totp', status: 'verified' }];
    await expect(beginAdminMfaEnrollment()).resolves.toEqual({
      ok: false,
      error: 'An authenticator is already enrolled. Enter the current code to continue.',
    });
    expect(harness.enroll).not.toHaveBeenCalled();
    expect(harness.unenroll).not.toHaveBeenCalled();
    await expect(verifyAdminMfaEnrollment(FACTOR_ID, '123456')).resolves.toEqual({
      ok: false,
      error: 'An authenticator is already enrolled. Enter the current code to continue.',
    });
    expect(harness.verify).not.toHaveBeenCalled();
  });

  it('returns to /admin after first enrollment verification', async () => {
    harness.factors = [{ id: FACTOR_ID, factor_type: 'totp', status: 'unverified' }];
    await expect(verifyAdminMfaEnrollment(FACTOR_ID, '123 456')).rejects.toThrow('REDIRECT:/admin');
    expect(harness.challenge).toHaveBeenCalledWith({ factorId: FACTOR_ID });
    expect(harness.verify).toHaveBeenCalledWith({
      factorId: FACTOR_ID,
      challengeId: 'challenge-1',
      code: '123456',
    });
  });

  it('challenges the verified factor on sign-in and returns to /admin', async () => {
    harness.factors = [{ id: VERIFIED_ID, factor_type: 'totp', status: 'verified' }];
    await expect(verifyAdminMfaChallenge('654321')).rejects.toThrow('REDIRECT:/admin');
    expect(harness.challenge).toHaveBeenCalledWith({ factorId: VERIFIED_ID });
    expect(harness.unenroll).not.toHaveBeenCalled();
  });

  it('fails closed on factor lookup errors and bad codes', async () => {
    harness.listError = { message: 'auth down' };
    await expect(verifyAdminMfaChallenge('123456')).resolves.toEqual({
      ok: false,
      error: 'Failed to check authenticator factors.',
    });
    expect(harness.verify).not.toHaveBeenCalled();

    harness.listError = null;
    harness.factors = [{ id: VERIFIED_ID, factor_type: 'totp', status: 'verified' }];
    await expect(verifyAdminMfaChallenge('12')).resolves.toEqual({
      ok: false,
      error: 'Enter the 6-digit code from your authenticator app.',
    });
    expect(harness.challenge).not.toHaveBeenCalled();

    harness.verify.mockResolvedValueOnce({ data: null, error: { message: 'invalid' } });
    await expect(verifyAdminMfaChallenge('123456')).resolves.toEqual({
      ok: false,
      error: 'That code was not accepted. Try the current code from your authenticator app.',
    });
  });

  it('re-checks the current account before enrollment', async () => {
    const first = await beginAdminMfaEnrollment();
    expect(first.ok).toBe(true);
    harness.user = { ok: true, userId: 'user-b', email: 'b@example.com' };
    harness.role = 'member';
    await expect(verifyAdminMfaEnrollment(FACTOR_ID, '123456')).resolves.toEqual({
      ok: false,
      error: 'Unauthorized: admin access required.',
    });
    expect(harness.verify).not.toHaveBeenCalled();
  });
});
