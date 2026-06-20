import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Dedicated PKCE handler for password recovery emails only.
 * Always lands on /reset-password — never runs signup/challenge smart routing.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const tokenHash = requestUrl.searchParams.get('token_hash');
  const origin = requestUrl.origin;

  if (!code && !tokenHash) {
    return NextResponse.redirect(new URL('/forgot-password', origin));
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

  if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      type: 'recovery',
      token_hash: tokenHash,
    });
    if (error) {
      console.error('[auth/recovery] verifyOtp:', error.message);
      return NextResponse.redirect(new URL('/forgot-password?error=expired', origin));
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('[auth/recovery] exchangeCodeForSession:', error.message);
      return NextResponse.redirect(new URL('/forgot-password?error=expired', origin));
    }
  }

  const response = NextResponse.redirect(new URL('/reset-password', origin));
  cookieJar.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });
  return response;
}
