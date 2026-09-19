import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PASSWORD_RESET_UNAVAILABLE_MESSAGE,
  PASSWORD_RESET_VALIDATION_MESSAGE,
} from '@/lib/password-reset';

const allowPasswordReset = vi.fn();
const resetPasswordForEmail = vi.fn();
const createClient = vi.fn();

const headerState = {
  forwarded: '203.0.113.10' as string | null,
  throwOnRead: false,
};

vi.mock('next/headers', () => ({
  headers: async () => {
    if (headerState.throwOnRead) {
      throw new Error('headers unavailable');
    }
    return {
      get: (name: string) =>
        name.toLowerCase() === 'x-forwarded-for' ? headerState.forwarded : null,
    };
  },
  cookies: async () => ({ getAll: () => [] }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

vi.mock('@/lib/ratelimit', () => ({
  allowPasswordReset: (...args: unknown[]) => allowPasswordReset(...args),
}));

vi.mock('@/lib/posthog-server', () => ({
  captureEvent: vi.fn(),
}));

function stubReadyEnv() {
  vi.stubEnv('WANDERBITE_IP_HASH_SECRET', 'test-ip-hash-secret');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.wanderbite.co');
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('WANDERBITE_PASSWORD_RESET_DISABLED', '');
  delete process.env.WANDERBITE_PASSWORD_RESET_DISABLED;
}

describe('sendPasswordResetEmail three-state contract', () => {
  beforeEach(() => {
    allowPasswordReset.mockReset();
    resetPasswordForEmail.mockReset();
    createClient.mockReset();
    headerState.forwarded = '203.0.113.10';
    headerState.throwOnRead = false;
    stubReadyEnv();
    allowPasswordReset.mockResolvedValue(true);
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    createClient.mockResolvedValue({
      auth: { resetPasswordForEmail },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns validation without limiter or provider', async () => {
    const { sendPasswordResetEmail } = await import('@/app/actions/auth');
    await expect(sendPasswordResetEmail('not-an-email')).resolves.toEqual({
      ok: false,
      error: PASSWORD_RESET_VALIDATION_MESSAGE,
    });
    expect(allowPasswordReset).not.toHaveBeenCalled();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns unavailable for kill switch, missing secret, missing site URL, null IP, and limiter deny', async () => {
    const { sendPasswordResetEmail } = await import('@/app/actions/auth');

    vi.stubEnv('WANDERBITE_PASSWORD_RESET_DISABLED', 'true');
    await expect(sendPasswordResetEmail('user@example.com')).resolves.toEqual({
      ok: false,
      error: PASSWORD_RESET_UNAVAILABLE_MESSAGE,
    });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();

    vi.stubEnv('WANDERBITE_PASSWORD_RESET_DISABLED', '');
    delete process.env.WANDERBITE_PASSWORD_RESET_DISABLED;
    vi.stubEnv('WANDERBITE_IP_HASH_SECRET', 'short');
    await expect(sendPasswordResetEmail('user@example.com')).resolves.toEqual({
      ok: false,
      error: PASSWORD_RESET_UNAVAILABLE_MESSAGE,
    });

    stubReadyEnv();
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');
    await expect(sendPasswordResetEmail('user@example.com')).resolves.toEqual({
      ok: false,
      error: PASSWORD_RESET_UNAVAILABLE_MESSAGE,
    });

    stubReadyEnv();
    headerState.forwarded = null;
    await expect(sendPasswordResetEmail('user@example.com')).resolves.toEqual({
      ok: false,
      error: PASSWORD_RESET_UNAVAILABLE_MESSAGE,
    });

    headerState.forwarded = '203.0.113.10';
    allowPasswordReset.mockResolvedValue(false);
    await expect(sendPasswordResetEmail('user@example.com')).resolves.toEqual({
      ok: false,
      error: PASSWORD_RESET_UNAVAILABLE_MESSAGE,
    });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('returns unavailable when the Supabase client cannot be constructed before Auth', async () => {
    createClient.mockRejectedValue(new Error('cookies failed'));
    const { sendPasswordResetEmail } = await import('@/app/actions/auth');
    await expect(sendPasswordResetEmail('user@example.com')).resolves.toEqual({
      ok: false,
      error: PASSWORD_RESET_UNAVAILABLE_MESSAGE,
    });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('treats provider { error } as generic success after dispatch', async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { message: 'User not found' },
    });
    const { sendPasswordResetEmail } = await import('@/app/actions/auth');
    await expect(sendPasswordResetEmail('unknown@example.com')).resolves.toEqual({
      ok: true,
    });
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });

  it('treats provider throw as generic success after dispatch', async () => {
    resetPasswordForEmail.mockRejectedValue(new Error('network down'));
    const { sendPasswordResetEmail } = await import('@/app/actions/auth');
    await expect(sendPasswordResetEmail('user@example.com')).resolves.toEqual({
      ok: true,
    });
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });

  it('keys Redis with digests only and shares one email bucket for mixed case', async () => {
    const { sendPasswordResetEmail } = await import('@/app/actions/auth');
    await sendPasswordResetEmail('  User@Example.COM ');
    await sendPasswordResetEmail('user@example.com');
    expect(allowPasswordReset).toHaveBeenCalledTimes(2);
    const first = allowPasswordReset.mock.calls[0] as [string, string];
    const second = allowPasswordReset.mock.calls[1] as [string, string];
    expect(first[0]).toBe(second[0]);
    expect(first[1]).toBe(second[1]);
    expect(first[0]).not.toMatch(/@/);
    expect(first[0]).not.toMatch(/example\.com/i);
    expect(first[1]).not.toMatch(/203\.0\.113\.10/);
    expect(first[0]).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(first[1]).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(resetPasswordForEmail).toHaveBeenCalledWith('user@example.com', {
      redirectTo: 'https://www.wanderbite.co/auth/recovery',
    });
  });
});
