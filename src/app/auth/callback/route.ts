import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { safeAuthRedirectPath } from '@/lib/auth/safe-redirect';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const origin = requestUrl.origin;
  const next = safeAuthRedirectPath(requestUrl.searchParams.get('next'), '/');

  if (code) {
    // Default redirect; will be replaced after we inspect user state.
    const response = NextResponse.redirect(new URL(next, origin));

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    await supabase.auth.exchangeCodeForSession(code);

    // Smart routing (single source of truth for post-confirmation state):
    // - No profile yet → onboarding
    // - Profile exists but not active → pricing
    // - Active subscriber → challenges
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return response;
      }

      const admin = getSupabaseAdmin();
      const { data: profile } = await admin
        .from('user_profiles')
        .select('id, subscription_status')
        .eq('id', user.id)
        .maybeSingle();

      if (!profile) {
        return NextResponse.redirect(new URL('/onboarding', origin));
      }

      const sub = (profile as { subscription_status: string | null }).subscription_status;
      if (sub === 'active') {
        return NextResponse.redirect(new URL('/challenges', origin));
      }

      return NextResponse.redirect(new URL('/pricing', origin));
    } catch {
      return response;
    }
  }

  return NextResponse.redirect(new URL(next, origin));
}
