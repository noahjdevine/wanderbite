import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const exchangeCodeForSession = vi.fn();
const verifyOtp = vi.fn();
const getUser = vi.fn();
const from = vi.fn();
const trackSignupCompleted = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      exchangeCodeForSession: (...args: unknown[]) => exchangeCodeForSession(...args),
      verifyOtp: (...args: unknown[]) => verifyOtp(...args),
      getUser: (...args: unknown[]) => getUser(...args),
    },
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (...args: unknown[]) => from(...args),
  }),
}));

vi.mock('@/app/actions/auth', () => ({
  trackSignupCompleted: (...args: unknown[]) => trackSignupCompleted(...args),
}));

function locationOf(res: Response): URL {
  return new URL(res.headers.get('location') ?? '', 'http://localhost');
}

describe('auth handler Location headers', () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
    verifyOtp.mockReset();
    getUser.mockReset();
    from.mockReset();
    trackSignupCompleted.mockReset();
    exchangeCodeForSession.mockResolvedValue({ error: null });
    verifyOtp.mockResolvedValue({ error: null });
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { id: 'user-1', subscription_status: 'active' } }),
        }),
      }),
    });
  });

  it('callback consumes code and redirects to a clean Location', async () => {
    const { GET } = await import('@/app/auth/callback/route');
    const ok = await GET(
      new NextRequest('http://localhost/auth/callback?code=pkce-secret&type=recovery'),
    );
    expect(exchangeCodeForSession).toHaveBeenCalledWith('pkce-secret');
    expect(locationOf(ok).pathname).toBe('/reset-password');
    expect(locationOf(ok).search).toBe('');

    exchangeCodeForSession.mockResolvedValueOnce({ error: { message: 'bad code' } });
    const fail = await GET(
      new NextRequest('http://localhost/auth/callback?code=pkce-secret&next=/challenges'),
    );
    expect(locationOf(fail).pathname).toBe('/signin');
    expect(locationOf(fail).searchParams.get('error')).toBe('session');
    expect(locationOf(fail).href).not.toContain('pkce-secret');
  });

  it('callback sanitizes next= that still contains a code', async () => {
    const { GET } = await import('@/app/auth/callback/route');
    const res = await GET(
      new NextRequest(
        'http://localhost/auth/callback?code=pkce-secret&next=%2Fchallenges%3Fcode%3Dleftover',
      ),
    );
    expect(locationOf(res).pathname).toBe('/challenges');
    expect(locationOf(res).search).toBe('');
  });

  it('confirm consumes token_hash and redirects to a clean Location', async () => {
    const { GET } = await import('@/app/auth/confirm/route');
    const ok = await GET(
      new NextRequest(
        'http://localhost/auth/confirm?token_hash=otp-secret&type=recovery&next=/challenges',
      ),
    );
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'otp-secret' });
    expect(locationOf(ok).pathname).toBe('/reset-password');
    expect(locationOf(ok).href).not.toContain('otp-secret');

    verifyOtp.mockResolvedValueOnce({ error: { message: 'expired' } });
    const fail = await GET(
      new NextRequest('http://localhost/auth/confirm?token_hash=otp-secret&type=recovery'),
    );
    expect(locationOf(fail).pathname).toBe('/signin');
    expect(locationOf(fail).href).not.toContain('otp-secret');
  });

  it('recovery consumes incoming secrets and redirects to a clean Location', async () => {
    const { GET } = await import('@/app/auth/recovery/route');
    const ok = await GET(new NextRequest('http://localhost/auth/recovery?code=pkce-secret'));
    expect(exchangeCodeForSession).toHaveBeenCalledWith('pkce-secret');
    expect(locationOf(ok).pathname).toBe('/reset-password');
    expect(locationOf(ok).search).toBe('');

    exchangeCodeForSession.mockResolvedValueOnce({ error: { message: 'expired' } });
    const fail = await GET(new NextRequest('http://localhost/auth/recovery?code=pkce-secret'));
    expect(locationOf(fail).pathname).toBe('/forgot-password');
    expect(locationOf(fail).searchParams.get('error')).toBe('expired');
    expect(locationOf(fail).href).not.toContain('pkce-secret');
  });
});
