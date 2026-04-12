'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  searchPlaces,
  getPlaceDetails,
  type PlaceDetails,
  type PlaceResult,
  buildGooglePlacesTextSearchUrl,
  maskGoogleApiKeyInUrl,
} from '@/lib/google-places-import';
import { allocateUniqueRestaurantSlug } from '@/lib/restaurant-slug';

const SUPER_ADMIN_EMAIL = 'noah@wanderbite.com';

async function checkAdminPermissions() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.email?.toLowerCase() !== SUPER_ADMIN_EMAIL) {
    throw new Error('Unauthorized: You are not the admin.');
  }
}

export type { PlaceDetails, PlaceResult };

/**
 * After addRestaurant(), attaches google_place_id and google_photo_url to the
 * row that was just created (same trimmed name, created within last 5 minutes).
 */
export async function attachGoogleMetadataToLatestRestaurantByName(
  name: string,
  google_place_id: string,
  google_photo_url: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await checkAdminPermissions();
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unauthorized';
    return { ok: false, error: message };
  }

  const trimmedName = name.trim();
  const placeId = google_place_id.trim();
  if (!trimmedName || !placeId) {
    return { ok: false, error: 'Name and Google Place ID are required.' };
  }

  const admin = getSupabaseAdmin();
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data: row, error: selErr } = await admin
    .from('restaurants')
    .select('id')
    .eq('name', trimmedName)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selErr) {
    return { ok: false, error: selErr.message };
  }
  if (!row) {
    return {
      ok: false,
      error: 'Could not find the new restaurant row to attach Google metadata.',
    };
  }

  const id = (row as { id: string }).id;
  const { error: updErr } = await admin
    .from('restaurants')
    .update({
      google_place_id: placeId,
      google_photo_url: google_photo_url?.trim() || null,
    })
    .eq('id', id);

  if (updErr) {
    return { ok: false, error: updErr.message };
  }

  const { data: slugRow } = await admin
    .from('restaurants')
    .select('name, slug')
    .eq('id', id)
    .maybeSingle();
  const sr = slugRow as { name: string; slug: string | null } | null;
  if (sr && (!sr.slug || !sr.slug.trim())) {
    const newSlug = await allocateUniqueRestaurantSlug(admin, sr.name);
    await admin.from('restaurants').update({ slug: newSlug }).eq('id', id);
  }

  revalidatePath('/admin');
  revalidatePath('/restaurants');
  return { ok: true };
}

export async function searchRestaurantsFromGoogle(
  query: string,
  city: string,
  lat: number,
  lng: number
): Promise<
  { ok: true; results: PlaceResult[] } | { ok: false; error: string }
> {
  console.log('Searching Google Places for:', query);

  try {
    await checkAdminPermissions();
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unauthorized';
    return { ok: false, error: message };
  }

  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key) {
    return {
      ok: false,
      error:
        'Google Places API key not configured. Add GOOGLE_PLACES_API_KEY to environment variables.',
    };
  }

  const trimmedQuery = query.trim();
  const cityTrim = city.trim();
  const url = buildGooglePlacesTextSearchUrl(
    trimmedQuery,
    cityTrim,
    { lat, lng },
    key
  );
  console.log('Google Places request URL:', maskGoogleApiKeyInUrl(url, key));

  try {
    const results = await searchPlaces(trimmedQuery, cityTrim, { lat, lng }, {
      onResponse: ({ httpStatus, bodyText }) => {
        console.log('Google Places raw response status:', httpStatus);
        console.log('Google Places raw response body:', bodyText);
      },
    });

    if (!results.length) {
      return {
        ok: false,
        error:
          'No results found for that search. Try a different name or check your Google Places API key.',
      };
    }

    return { ok: true, results };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Google Places search failed.';
    return { ok: false, error: message };
  }
}

export async function getRestaurantDetailsFromGoogle(
  placeId: string
): Promise<PlaceDetails | null> {
  try {
    await checkAdminPermissions();
  } catch {
    return null;
  }
  return getPlaceDetails(placeId);
}
