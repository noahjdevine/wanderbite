'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  searchPlaces,
  getPlaceDetails,
  type PlaceDetails,
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

export type { PlaceDetails };

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
): Promise<{ placeId: string; name: string; address: string }[]> {
  try {
    await checkAdminPermissions();
  } catch {
    return [];
  }
  return searchPlaces(query, city, { lat, lng });
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
