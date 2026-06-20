'use server';

import { assertAdmin } from '@/lib/auth/assert-admin';
import { logAdminAction } from '@/lib/audit/log-admin-action';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { findRestaurantPlace } from '@/lib/google-places';

export async function enrichSingleRestaurant(
  restaurantId: string
): Promise<{ ok: boolean; photoUrl?: string; error?: string }> {
  const auth = await assertAdmin();
  if (!auth.ok) {
    return { ok: false, error: auth.error };
  }

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

  await logAdminAction({
    actorUserId: auth.userId,
    action: 'restaurant.enrich',
    targetType: 'restaurant',
    targetId: restaurantId,
    metadata: { placeId, photoUrl },
  });

  return { ok: true, photoUrl };
}

export async function enrichAllRestaurants(): Promise<{
  ok: boolean;
  updated: number;
  failed: number;
  error?: string;
}> {
  const auth = await assertAdmin();
  if (!auth.ok) {
    return { ok: false, updated: 0, failed: 0, error: auth.error };
  }

  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin
    .from('restaurants')
    .select('id, name, address')
    .eq('status', 'active');

  if (error) {
    return { ok: false, updated: 0, failed: 0, error: error.message };
  }

  const list = (rows ?? []) as {
    id: string;
    name: string;
    address: string | null;
  }[];

  let updated = 0;
  let failed = 0;

  for (const r of list) {
    const res = await enrichSingleRestaurant(r.id);
    const photoUrl = res.ok ? res.photoUrl : undefined;
    console.warn('Enriching:', r.name, '→', photoUrl ?? 'not found');
    if (res.ok) updated += 1;
    else failed += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  await logAdminAction({
    actorUserId: auth.userId,
    action: 'restaurant.enrich_bulk',
    targetType: 'restaurants',
    metadata: { updated, failed, total: list.length },
  });

  return { ok: true, updated, failed };
}
