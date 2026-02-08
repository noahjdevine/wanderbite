import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (Next.js internals)
     * - favicon.ico, image assets
     * - auth (OAuth callback; avoid running middleware during session refresh)
     * - login (avoid redirect loops when sending unauthenticated users here)
     */
    '/((?!_next/static|_next/image|favicon.ico|auth|login|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
