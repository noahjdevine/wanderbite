import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED_ROUTES = [
  '/checkout',
  '/dashboard',
  '/billing',
  '/challenges',
  '/journey',
  '/journal',
  '/passport',
  '/account',
  '/profile',
  '/onboarding',
  '/admin',
  '/suggest',
  '/restaurants',
] as const;

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const code = request.nextUrl.searchParams.get('code');
  const authType = request.nextUrl.searchParams.get('type');

  // Recovery emails sometimes land on / (Site URL fallback) instead of /auth/callback.
  if (
    code &&
    authType === 'recovery' &&
    pathname !== '/auth/callback' &&
    pathname !== '/reset-password'
  ) {
    const callbackUrl = request.nextUrl.clone();
    callbackUrl.pathname = '/auth/callback';
    callbackUrl.searchParams.set('next', '/reset-password');
    return NextResponse.redirect(callbackUrl);
  }

  // Auth entry routes + callback: don't force session redirects here (matcher also skips many of these)
  if (
    pathname.startsWith('/auth/') ||
    pathname === '/login' ||
    pathname === '/signin' ||
    pathname === '/signup' ||
    pathname.startsWith('/signup/')
  ) {
    return response;
  }

  // Public routes: allow both logged-in and logged-out (no app login required)
  const isPublic =
    pathname === '/' ||
    pathname === '/how-it-works' ||
    pathname.startsWith('/how-it-works/') ||
    pathname === '/pricing' ||
    pathname.startsWith('/pricing/') ||
    pathname === '/restaurants' ||
    pathname.startsWith('/restaurants/') ||
    pathname === '/partner' ||
    pathname.startsWith('/partner/') ||
    pathname === '/roulette' ||
    pathname.startsWith('/roulette/');
  if (isPublic) {
    return response;
  }

  const isProtected = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
  if (!user && isProtected) {
    const loginUrl = new URL('/signin', request.url);
    loginUrl.searchParams.set(
      'redirectTo',
      `${pathname}${request.nextUrl.search}`
    );
    return NextResponse.redirect(loginUrl);
  }

  if (user) {
    return response;
  }

  // Unauthenticated: redirect to login only for routes that require it (e.g. onboarding)
  if (pathname === '/onboarding') {
    return NextResponse.redirect(new URL('/signin', request.url));
  }

  return response;
}
