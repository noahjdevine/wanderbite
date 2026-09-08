import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: (...args: unknown[]) => getUser(...args),
    },
  }),
}));

describe('updateSession redirectTo sanitization', () => {
  beforeEach(() => {
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: null } });
  });

  it('keeps code on the / → /auth/recovery hop', async () => {
    const { updateSession } = await import('@/lib/supabase/middleware');
    const res = await updateSession(
      new NextRequest('http://localhost/?code=pkce-secret&type=recovery'),
    );
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.pathname).toBe('/auth/recovery');
    expect(location.searchParams.get('code')).toBe('pkce-secret');
    expect(location.searchParams.get('type')).toBe('recovery');
  });

  it('omits secrets from sign-in redirectTo, including encoded input', async () => {
    const { updateSession } = await import('@/lib/supabase/middleware');
    const res = await updateSession(
      new NextRequest('http://localhost/challenges?code=secret&checkout=success'),
    );
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.pathname).toBe('/signin');
    expect(location.searchParams.get('redirectTo')).toBe('/challenges?checkout=success');

    const encoded = await updateSession(
      new NextRequest('http://localhost/challenges?code=%73ecret'),
    );
    const encodedLocation = new URL(encoded.headers.get('location') ?? '');
    expect(encodedLocation.searchParams.get('redirectTo')).toBe('/challenges');
    expect(encodedLocation.searchParams.get('redirectTo')).not.toContain('code=');
  });

  it('keeps harmless billing query params on redirectTo', async () => {
    const { updateSession } = await import('@/lib/supabase/middleware');
    const res = await updateSession(new NextRequest('http://localhost/billing?session=xyz'));
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.searchParams.get('redirectTo')).toBe('/billing?session=xyz');
  });
});
