import { AI_GUEST_COOKIE_NAME, guestCookieSetOptions } from '@/lib/ai-guest';
import { NextResponse } from 'next/server';

export function withGuestCookie(response: NextResponse, cookieValue: string | null): NextResponse {
  if (cookieValue) {
    response.cookies.set(AI_GUEST_COOKIE_NAME, cookieValue, guestCookieSetOptions());
  }
  return response;
}
