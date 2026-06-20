import { createServerClient } from '@supabase/ssr';
import type { EmailOtpType } from '@supabase/supabase-js';
import type { CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { safeAuthRedirectPath } from '@/lib/auth/safe-redirect';

/**
 * Handles Supabase email links that use token_hash (older / default email templates).
 * PKCE recovery links use /auth/callback?code=...&next=/reset-password instead.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get('token_hash');
  const type = requestUrl.searchParams.get('type') as EmailOtpType | null;
  const origin = requestUrl.origin;

  const successPath =
    type === 'recovery'
      ? '/reset-password'
      : safeAuthRedirectPath(requestUrl.searchParams.get('next'), '/');

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL('/signin?error=auth', origin));
  }

  let cookieJar: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookieJar = cookiesToSet;
        },
      },
    }
  );

  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });

  const redirectUrl = new URL(error ? '/signin?error=auth' : successPath, origin);
  const response = NextResponse.redirect(redirectUrl);
  cookieJar.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });
  return response;
}
