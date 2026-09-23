import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { hashClientIp } from '@/lib/ai-ip-hash';
import { trustedClientIpFromHeaders } from '@/lib/client-ip';
import { fetchLegacyPlacePhoto } from '@/lib/google-places';
import {
  evaluateLimiterPair,
  restaurantPhotoGlobalLimiter,
  restaurantPhotoIpLimiter,
} from '@/lib/ratelimit';
import { isGooglePlacesOutboundDisabled } from '@/lib/restaurant-image';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { parseUuid } from '@/lib/uuid';

export const dynamic = 'force-dynamic';

type PhotoOutcome =
  | 'invalid_id'
  | 'disabled'
  | 'unavailable'
  | 'rate_limited'
  | 'no_photo'
  | 'unsafe_credit'
  | 'oversize'
  | 'timeout'
  | 'failed'
  | 'ok';

function photoJson(body: Record<string, unknown>, outcome: PhotoOutcome) {
  if (outcome !== 'ok' && outcome !== 'invalid_id' && outcome !== 'no_photo') {
    Sentry.captureMessage('restaurant image proxy', {
      level: outcome === 'rate_limited' ? 'info' : 'warning',
      tags: { route: 'restaurant-image', outcome },
    });
  }
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await context.params;
  const id = parseUuid(rawId);
  if (!id) return photoJson({ ok: false }, 'invalid_id');

  if (isGooglePlacesOutboundDisabled()) {
    return photoJson({ ok: false }, 'disabled');
  }

  const ip = trustedClientIpFromHeaders(request.headers);
  const digest = ip ? hashClientIp(ip) : null;
  if (!digest) return photoJson({ ok: false }, 'unavailable');

  const limit = await evaluateLimiterPair(
    restaurantPhotoIpLimiter,
    restaurantPhotoGlobalLimiter,
    digest,
    'global',
  );
  if (limit !== 'allowed') {
    return photoJson({ ok: false }, limit === 'rate_limited' ? 'rate_limited' : 'unavailable');
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('restaurants')
    .select('google_place_id')
    .eq('id', id)
    .eq('status', 'active')
    .maybeSingle();

  const placeId = (data as { google_place_id: string | null } | null)?.google_place_id?.trim();
  if (error || !placeId) return photoJson({ ok: false }, 'no_photo');

  const photo = await fetchLegacyPlacePhoto(placeId);
  if (!photo.ok) return photoJson({ ok: false }, photo.reason);

  return photoJson(
    {
      ok: true,
      contentType: photo.contentType,
      imageBase64: Buffer.from(photo.bytes).toString('base64'),
      credit: photo.credit,
    },
    'ok',
  );
}
