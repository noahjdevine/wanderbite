'use server';

import { revalidatePath } from 'next/cache';
import { assertAdmin } from '@/lib/auth/assert-admin';
import { logAdminAction } from '@/lib/audit/log-admin-action';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { allocateUniqueRestaurantSlug } from '@/lib/restaurant-slug';
import type { PlaceDetails, PlaceResult } from '@/lib/google-places-import';
import {
  searchPlaces,
  getPlaceDetails,
} from '@/lib/google-places-import';
import { isValidCoordinate } from '@/lib/launch-market';
import {
  googleImportOutcome,
  type GoogleImportOutcome,
} from '@/lib/google-import-outcome';
import { addRestaurant } from './actions';

/** Current user, admin role, and currentLevel aal2. Fails before any service-role read or write. */
async function checkAdminPermissions() {
  const auth = await assertAdmin();
  if (!auth.ok) {
    throw new Error(auth.error);
  }
  return auth;
}

/**
 * After addRestaurant(), stores google_place_id on the row that was just
 * created (same trimmed name, created within last 5 minutes).
 */
export async function attachGoogleMetadataToLatestRestaurantByName(
  name: string,
  google_place_id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let auth;
  try {
    auth = await checkAdminPermissions();
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
  const details = await getPlaceDetails(placeId);
  const { error: updErr } = await admin
    .from('restaurants')
    .update({
      google_place_id: placeId,
      google_photo_url: null,
      ...(details && isValidCoordinate(details.lat, details.lon)
        ? { lat: details.lat, lon: details.lon }
        : {}),
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
  await logAdminAction({
    actorUserId: auth.userId,
    action: 'restaurant.import',
    targetType: 'restaurant',
    targetId: id,
    metadata: { source: 'google_places', placeId, name: trimmedName },
  });
  return { ok: true };
}

export async function searchRestaurantsFromGoogle(
  query: string
): Promise<
  { ok: true; results: PlaceResult[] } | { ok: false; error: string }
> {
  try {
    await checkAdminPermissions();
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unauthorized';
    return { ok: false, error: message };
  }

  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return { ok: false, error: 'Enter a restaurant name to search.' };
  }

  try {
    const results = await searchPlaces(trimmedQuery);

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

/**
 * Creates the restaurant, then attaches Google metadata when a Place ID is present.
 * Attach failure leaves the restaurant in place and returns a visible partial result.
 */
export async function importRestaurantFromGoogle(
  _prev: GoogleImportOutcome | null,
  formData: FormData,
): Promise<GoogleImportOutcome> {
  const created = await addRestaurant(formData);
  if (!created.ok) {
    return googleImportOutcome({
      createdOk: false,
      createdError: created.error,
      partnerUrl: null,
      placeId: '',
      attachedOk: null,
      attachedError: null,
    });
  }

  const placeId = String(formData.get('google_place_id') ?? '').trim();
  if (!placeId) {
    return googleImportOutcome({
      createdOk: true,
      createdError: null,
      partnerUrl: created.partnerUrl,
      placeId: '',
      attachedOk: null,
      attachedError: null,
    });
  }

  const name = String(formData.get('name') ?? '');
  const attached = await attachGoogleMetadataToLatestRestaurantByName(name, placeId);
  return googleImportOutcome({
    createdOk: true,
    createdError: null,
    partnerUrl: created.partnerUrl,
    placeId,
    attachedOk: attached.ok,
    attachedError: attached.ok ? null : attached.error,
  });
}
