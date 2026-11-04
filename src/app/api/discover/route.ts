import { encodeDiscoverSse } from '@/lib/discover/events';
import { discoverStreamEnabled } from '@/lib/discover/flag';
import { withGuestCookie } from '@/lib/discover/http';
import { attachMemberOffer } from '@/lib/discover/member-offer';
import { runDiscoverTurn, type DiscoverTurnResult } from '@/lib/discover/turn';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
/** Same Claude + DB budget as /api/roulette. */
export const maxDuration = 60;

function notFound(): NextResponse {
  return NextResponse.json({ error: 'Not found.' }, { status: 404 });
}

function isDiscoverCard(result: DiscoverTurnResult): result is DiscoverTurnResult & {
  selectionMode: 'ai' | 'random_fallback';
  body: { restaurantId: string; selectionMode: 'ai' | 'random_fallback' };
} {
  if (result.status !== 200 || result.selectionMode == null) return false;
  const body = result.body as { restaurantId?: unknown; selectionMode?: unknown };
  return typeof body.restaurantId === 'string' && body.selectionMode === result.selectionMode;
}

export async function GET() {
  if (!discoverStreamEnabled()) return notFound();
  return NextResponse.json({ error: 'Method not allowed.' }, { status: 405 });
}

export async function POST(request: NextRequest) {
  if (!discoverStreamEnabled()) return notFound();
  try {
    const result = await runDiscoverTurn(request);
    if (!isDiscoverCard(result)) {
      return withGuestCookie(
        NextResponse.json(result.body, { status: result.status }),
        result.guestCookie,
      );
    }
    const events = await attachMemberOffer({
      events: result.events,
      memberUserId: result.memberUserId,
      selectionMode: result.selectionMode,
      restaurantId: result.body.restaurantId,
    });
    return withGuestCookie(
      new NextResponse(encodeDiscoverSse(events), {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        },
      }),
      result.guestCookie,
    );
  } catch (err) {
    console.error('[discover] unhandled', err instanceof Error ? err.name : 'error');
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
