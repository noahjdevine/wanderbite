'use server';

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { findRestaurantPlace } from '@/lib/google-places';

export async function enrichSingleRestaurant(
  restaurantId: string
): Promise<{ ok: boolean; photoUrl?: string; error?: string }> {
  const admin = getSupabaseAdmin();
  const { data: row, error } = await admin
    .from('restaurants')
    .select('id, name, address')
    .eq('id', restaurantId)
    .maybeSingle();

  if (error || !row) {
    return { ok: false, error: error?.message ?? 'Restaurant not found.' };
  }

  const r = row as { id: string; name: string; address: string | null };
  const { placeId, photoUrl } = await findRestaurantPlace(
    r.name,
    r.address ?? ''
  );

  if (!photoUrl) {
    return {
      ok: false,
      error: 'No Google Places photo found for this restaurant.',
    };
  }

  const { error: updErr } = await admin
    .from('restaurants')
    .update({
      google_place_id: placeId,
      google_photo_url: photoUrl,
    })
    .eq('id', restaurantId);

  if (updErr) {
    return { ok: false, error: updErr.message };
  }

  return { ok: true, photoUrl };
}

export async function enrichAllRestaurants(): Promise<{
  ok: boolean;
  updated: number;
  failed: number;
  error?: string;
}> {
  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin
    .from('restaurants')
    .select('id, name, address, google_photo_url')
    .eq('status', 'active');

  if (error) {
    return { ok: false, updated: 0, failed: 0, error: error.message };
  }

  const list = (rows ?? []) as {
    id: string;
    name: string;
    address: string | null;
    google_photo_url: string | null;
  }[];

  const pending = list.filter((r) => !r.google_photo_url?.trim());
  let updated = 0;
  let failed = 0;

  for (const r of pending) {
    const res = await enrichSingleRestaurant(r.id);
    if (res.ok) updated += 1;
    else failed += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return { ok: true, updated, failed };
}
