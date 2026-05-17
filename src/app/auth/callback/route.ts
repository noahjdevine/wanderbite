import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { trackSignupCompleted } from '@/app/actions/auth';
import { safeAuthRedirectPath } from '@/lib/auth/safe-redirect';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const origin = requestUrl.origin;
  const next = safeAuthRedirectPath(requestUrl.searchParams.get('next'), '/');

  if (!code) {
    return NextResponse.redirect(new URL(next, origin));
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

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  function redirectWithSessionCookies(pathWithQuery: string) {
    const res = NextResponse.redirect(new URL(pathWithQuery, origin));
    cookieJar.forEach(({ name, value, options }) => {
      res.cookies.set(name, value, options);
    });
    return res;
  }

  if (exchangeError) {
    console.error('auth/callback exchangeCodeForSession:', exchangeError.message);
    return NextResponse.redirect(new URL('/signin?error=session', origin));
  }

  // Smart routing after PKCE exchange:
  // - No profile yet → onboarding
  // - Active subscriber → challenges
  // - Otherwise → pricing
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.error('auth/callback: no user after successful exchange');
      return redirectWithSessionCookies('/signin?error=session');
    }

    const admin = getSupabaseAdmin();
    const { data: profile } = await admin
      .from('user_profiles')
      .select('id, subscription_status')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) {
      await trackSignupCompleted(user.id);
      return redirectWithSessionCookies('/onboarding');
    }

    const sub = (profile as { subscription_status: string | null }).subscription_status;
    if (sub === 'active') {
      return redirectWithSessionCookies('/challenges');
    }

    return redirectWithSessionCookies('/pricing');
  } catch (err) {
    console.error('auth/callback smart redirect:', err);
    return redirectWithSessionCookies('/signin?error=session');
  }
}
