import { withGuestCookie } from '@/lib/discover/http';
import { runDiscoverTurn } from '@/lib/discover/turn';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
/** Claude + DB can exceed the default serverless limit on cold starts. */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const result = await runDiscoverTurn(request);
  return withGuestCookie(NextResponse.json(result.body, { status: result.status }), result.guestCookie);
}
