import { ImageResponse } from 'next/og';
import { loadPassportShareModel } from '@/lib/passport/load-share-card';
import { passportShareImageElement } from '@/lib/passport/share-card-image';
import {
  PASSPORT_SHARE_IMAGE_HEIGHT,
  PASSPORT_SHARE_IMAGE_WIDTH,
} from '@/lib/passport/share-card';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * The signed-in member's own passport image. The request URL is ignored:
 * there is no member id parameter, and a query string cannot choose a row.
 */
export async function GET(_request: Request) {
  void _request;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(null, { status: 401, headers: PRIVATE_NO_STORE });
  }

  const loaded = await loadPassportShareModel(supabase, user.id);
  if (!loaded.ok) {
    return new Response(null, { status: 500, headers: PRIVATE_NO_STORE });
  }

  return new ImageResponse(passportShareImageElement(loaded.model), {
    width: PASSPORT_SHARE_IMAGE_WIDTH,
    height: PASSPORT_SHARE_IMAGE_HEIGHT,
    headers: PRIVATE_NO_STORE,
  });
}
