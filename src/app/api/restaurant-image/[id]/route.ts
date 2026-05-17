import { NextResponse } from 'next/server';
import { fetchPlacePhotoBytes } from '@/lib/google-places';
import { RESTAURANT_IMAGE_PLACEHOLDER } from '@/lib/restaurant-image';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/** Cache proxied Google photos for 24h (CDN/browser); stale OK for 1h while revalidating. */
const PHOTO_CACHE_CONTROL =
  'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600';

type RestaurantImageRow = {
  image_url: string | null;
  google_place_id: string | null;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.redirect(
      new URL(RESTAURANT_IMAGE_PLACEHOLDER, _request.url),
      302
    );
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('restaurants')
    .select('image_url, google_place_id')
    .eq('id', id.trim())
    .maybeSingle();

  if (error || !data) {
    return NextResponse.redirect(
      new URL(RESTAURANT_IMAGE_PLACEHOLDER, _request.url),
      302
    );
  }

  const row = data as RestaurantImageRow;
  const manual = row.image_url?.trim();
  if (manual) {
    if (manual.startsWith('/')) {
      return NextResponse.redirect(new URL(manual, _request.url), 302);
    }
    return NextResponse.redirect(manual, 302);
  }

  const placeId = row.google_place_id?.trim();
  if (!placeId) {
    return NextResponse.redirect(
      new URL(RESTAURANT_IMAGE_PLACEHOLDER, _request.url),
      302
    );
  }

  const photo = await fetchPlacePhotoBytes(placeId);
  if (!photo) {
    return NextResponse.redirect(
      new URL(RESTAURANT_IMAGE_PLACEHOLDER, _request.url),
      302
    );
  }

  return new NextResponse(photo.body, {
    status: 200,
    headers: {
      'Content-Type': photo.contentType,
      'Cache-Control': PHOTO_CACHE_CONTROL,
    },
  });
}
