'use server';

import { revalidatePath } from 'next/cache';
import { assertAdmin } from '@/lib/auth/assert-admin';
import { logAdminAction } from '@/lib/audit/log-admin-action';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { allocateUniqueRestaurantSlug } from '@/lib/restaurant-slug';
import { hashPartnerPin } from '@/lib/partner-pin';
import { parsePartnerPin, PARTNER_PIN_VALIDATION_MESSAGE } from '@/lib/partner-pin-format';
import { parseUuid } from '@/lib/uuid';
import { requireLaunchMarketId } from '@/lib/launch-market-server';
import { isValidCoordinate, parseCoordinate } from '@/lib/launch-market';
import { getPlaceDetails } from '@/lib/google-places-import';
import { manualImagePathForSave } from '@/lib/restaurant-image';

export type AddRestaurantResult =
  | { ok: true; partnerUrl: string }
  | { ok: false; error: string };

export type DeleteRestaurantResult =
  | { ok: true; result: 'paused' | 'deleted' }
  | { ok: false; error: string };

/** Current user, admin role, and currentLevel aal2. Fails before any service-role write. */
async function checkAdminPermissions() {
  const auth = await assertAdmin();
  if (!auth.ok) {
    throw new Error(auth.error);
  }
  return auth;
}

function parseCuisineTags(cuisine: string): string[] {
  return cuisine
    .split(/[,;]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function addRestaurant(formData: FormData): Promise<AddRestaurantResult> {
  try {
    const auth = await checkAdminPermissions();

    const supabase = getSupabaseAdmin();

    const market = await requireLaunchMarketId(supabase);
    if (!market.ok) return { ok: false, error: market.error };

    const name = (formData.get('name') as string)?.trim();
    if (!name) return { ok: false, error: 'Name is required.' };

    const cuisineInput = (formData.get('cuisine') as string)?.trim() ?? '';
    const cuisine_tags = parseCuisineTags(cuisineInput);
    const address = (formData.get('address') as string)?.trim() ?? null;
    const description = (formData.get('description') as string)?.trim() ?? null;
    const price_range = (formData.get('price_range') as string)?.trim() ?? null;
    const neighborhood = (formData.get('neighborhood') as string)?.trim() ?? null;
    const imageInput = (formData.get('image_url') as string)?.trim() ?? '';
    const imagePath = manualImagePathForSave(imageInput);
    if (!imagePath.ok) {
      return { ok: false, error: 'Image must be a path under /images/.' };
    }
    const image_url = imagePath.value;
    const verification_code = (formData.get('verification_code') as string)?.trim() ?? null;
    const pinRaw = (formData.get('pin') as string)?.trim() ?? '';
    let pin_hash: string | null = null;
    if (pinRaw) {
      const parsedPin = parsePartnerPin(pinRaw);
      if (!parsedPin) {
        return { ok: false, error: PARTNER_PIN_VALIDATION_MESSAGE };
      }
      pin_hash = await hashPartnerPin(parsedPin);
    }

    const { data: org, error: orgErr } = await supabase
      .from('restaurant_orgs')
      .insert({ name, market_id: market.marketId })
      .select('id')
      .single();

    if (orgErr || !org) {
      return { ok: false, error: orgErr?.message ?? 'Failed to create restaurant org.' };
    }

    const orgId = (org as { id: string }).id;
    const marketId = market.marketId;

    const slug = await allocateUniqueRestaurantSlug(supabase, name);

    const googlePlaceId = (formData.get('google_place_id') as string)?.trim() || null;
    let lat = parseCoordinate(formData.get('lat'));
    let lon = parseCoordinate(formData.get('lon'));
    if (googlePlaceId) {
      const details = await getPlaceDetails(googlePlaceId);
      if (details && isValidCoordinate(details.lat, details.lon)) {
        lat = details.lat;
        lon = details.lon;
      }
    }
    if (!isValidCoordinate(lat, lon)) {
      lat = null;
      lon = null;
    }

    const { error: restErr } = await supabase.from('restaurants').insert({
      org_id: orgId,
      market_id: marketId,
      name,
      slug,
      cuisine_tags: cuisine_tags.length ? cuisine_tags : null,
      address,
      lat,
      lon,
      description,
      price_range,
      neighborhood,
      image_url,
      verification_code,
      pin_hash,
      status: 'paused',
    });

    if (restErr) return { ok: false, error: restErr.message };

    const { data: newRestaurant } = await supabase
      .from('restaurants')
      .select('id')
      .eq('org_id', orgId)
      .single();

    const restaurantId = (newRestaurant as { id: string } | null)?.id;
    if (!restaurantId) {
      return { ok: false, error: 'Restaurant was created without an id.' };
    }

    const { error: draftErr } = await supabase.from('offer_drafts').insert({
      restaurant_id: restaurantId,
    });
    if (draftErr) return { ok: false, error: draftErr.message };

    revalidatePath('/admin');
    revalidatePath('/restaurants');
    await logAdminAction({
      actorUserId: auth.userId,
      action: 'restaurant.create',
      targetType: 'restaurant',
      targetId: restaurantId,
      metadata: { name, slug, marketId },
    });
    return { ok: true, partnerUrl: `/partner/${slug}` };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false, error: message };
  }
}

export async function generateMissingSlugs(): Promise<{
  ok: boolean;
  updated: number;
  error?: string;
}> {
  let auth;
  try {
    auth = await checkAdminPermissions();
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unauthorized';
    return { ok: false, updated: 0, error: message };
  }

  const supabase = getSupabaseAdmin();

  const { data: allRows, error: listErr } = await supabase
    .from('restaurants')
    .select('id, name, slug');

  if (listErr) {
    return { ok: false, updated: 0, error: listErr.message };
  }

  const rows = (allRows ?? []) as { id: string; name: string; slug: string | null }[];
  const missing = rows.filter((r) => !r.slug?.trim());
  let updated = 0;

  for (const row of missing) {
    const slug = await allocateUniqueRestaurantSlug(supabase, row.name);
    const { error: upErr } = await supabase
      .from('restaurants')
      .update({ slug })
      .eq('id', row.id);
    if (!upErr) updated += 1;
  }

  revalidatePath('/admin');
  revalidatePath('/restaurants');
  if (updated > 0) {
    await logAdminAction({
      actorUserId: auth.userId,
      action: 'restaurant.slugs_generated',
      targetType: 'restaurants',
      metadata: { updated },
    });
  }
  return { ok: true, updated };
}

export async function deleteRestaurant(restaurantId: string): Promise<DeleteRestaurantResult> {
  try {
    const auth = await checkAdminPermissions();

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('retire_restaurant', {
      p_restaurant_id: restaurantId,
      p_actor_user_id: auth.userId,
    });
    if (error) return { ok: false, error: error.message };

    const payload = data as { ok?: boolean; error?: string; result?: string } | null;
    if (!payload?.ok || (payload.result !== 'paused' && payload.result !== 'deleted')) {
      return { ok: false, error: payload?.error ?? 'Unable to retire restaurant.' };
    }

    revalidatePath('/admin');
    revalidatePath('/restaurants');
    return { ok: true, result: payload.result };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false, error: message };
  }
}

export type SetRestaurantPinResult = { ok: true } | { ok: false; error: string };

export async function setRestaurantPin(
  restaurantId: string,
  pin: string,
): Promise<SetRestaurantPinResult> {
  try {
    const auth = await checkAdminPermissions();
    const id = parseUuid(restaurantId);
    const parsedPin = parsePartnerPin(pin);
    if (!id || !parsedPin) {
      return { ok: false, error: PARTNER_PIN_VALIDATION_MESSAGE };
    }

    const supabase = getSupabaseAdmin();
    const pin_hash = await hashPartnerPin(parsedPin);
    const { data, error } = await supabase
      .from('restaurants')
      .update({ pin_hash })
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      return { ok: false, error: 'Unable to update the partner PIN right now.' };
    }
    if (!data) {
      return { ok: false, error: 'Restaurant not found.' };
    }

    revalidatePath('/admin');
    await logAdminAction({
      actorUserId: auth.userId,
      action: 'restaurant.pin_set',
      targetType: 'restaurant',
      targetId: id,
      metadata: { has_pin: true },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: 'Unable to update the partner PIN right now.' };
  }
}

/** useActionState wrapper. The insert itself stays in addRestaurant. */
export async function addRestaurantFromForm(
  _prev: AddRestaurantResult | null,
  formData: FormData,
): Promise<AddRestaurantResult> {
  return addRestaurant(formData);
}

/** useActionState wrapper. PIN hashing stays in setRestaurantPin. */
export async function setRestaurantPinFromForm(
  _prev: SetRestaurantPinResult | null,
  formData: FormData,
): Promise<SetRestaurantPinResult> {
  return setRestaurantPin(
    String(formData.get('restaurantId') ?? ''),
    String(formData.get('pin') ?? ''),
  );
}
