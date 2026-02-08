import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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

  // Never run redirect logic for auth callback or login (matcher should exclude these; safety net)
  if (pathname.startsWith('/auth/') || pathname === '/login') {
    return response;
  }

  // Public routes: allow both logged-in and logged-out (no app login required)
  const isPublic =
    pathname === '/' ||
    pathname === '/how-it-works' ||
    pathname.startsWith('/how-it-works/') ||
    pathname === '/pricing' ||
    pathname.startsWith('/pricing/') ||
    pathname === '/partner' ||
    pathname.startsWith('/partner/');
  if (isPublic) {
    return response;
  }

  if (user) {
    return response;
  }

  // Unauthenticated: redirect to login only for routes that require it (e.g. onboarding)
  if (pathname === '/onboarding') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return response;
}
