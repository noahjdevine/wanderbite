'use server';

import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase/server';

const SUPER_ADMIN_EMAIL = 'noah@wanderbite.com';

export type AddRestaurantResult =
  | { ok: true }
  | { ok: false; error: string };

export type DeleteRestaurantResult =
  | { ok: true }
  | { ok: false; error: string };

async function checkAdminPermissions() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.email?.toLowerCase() !== SUPER_ADMIN_EMAIL) {
    throw new Error('Unauthorized: You are not the admin.');
  }
}

function parseCuisineTags(cuisine: string): string[] {
  return cuisine
    .split(/[,;]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function addRestaurant(formData: FormData): Promise<AddRestaurantResult> {
  try {
    await checkAdminPermissions();

    const supabase = getSupabaseAdmin();

    const { data: market } = await supabase
      .from('markets')
      .select('id')
      .limit(1)
      .maybeSingle();
    if (!market) return { ok: false, error: 'No market found. Create a market first.' };

    const name = (formData.get('name') as string)?.trim();
    if (!name) return { ok: false, error: 'Name is required.' };

    const cuisineInput = (formData.get('cuisine') as string)?.trim() ?? '';
    const cuisine_tags = parseCuisineTags(cuisineInput);
    const address = (formData.get('address') as string)?.trim() ?? null;
    const description = (formData.get('description') as string)?.trim() ?? null;
    const price_range = (formData.get('price_range') as string)?.trim() ?? null;
    const neighborhood = (formData.get('neighborhood') as string)?.trim() ?? null;
    const image_url = (formData.get('image_url') as string)?.trim() ?? null;
    const verification_code = (formData.get('verification_code') as string)?.trim() ?? null;

    const { data: org, error: orgErr } = await supabase
      .from('restaurant_orgs')
      .insert({ name, market_id: (market as { id: string }).id })
      .select('id')
      .single();

    if (orgErr || !org) {
      return { ok: false, error: orgErr?.message ?? 'Failed to create restaurant org.' };
    }

    const orgId = (org as { id: string }).id;
    const marketId = (market as { id: string }).id;

    const { error: restErr } = await supabase.from('restaurants').insert({
      org_id: orgId,
      market_id: marketId,
      name,
      cuisine_tags: cuisine_tags.length > 0 ? cuisine_tags : null,
      address,
      description,
      price_range,
      neighborhood,
      image_url,
      verification_code,
      status: 'active',
    });

    if (restErr) return { ok: false, error: restErr.message };

    const { data: newRestaurant } = await supabase
      .from('restaurants')
      .select('id')
      .eq('org_id', orgId)
      .single();

    if (newRestaurant) {
      await supabase.from('restaurant_offers').insert({
        restaurant_id: (newRestaurant as { id: string }).id,
        discount_amount_cents: 1000,
        min_spend_cents: 4000,
        max_redemptions_per_month: 50,
        active: true,
      });
    }

    revalidatePath('/admin');
    revalidatePath('/locations');
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false, error: message };
  }
}

export async function deleteRestaurant(restaurantId: string): Promise<DeleteRestaurantResult> {
  try {
    await checkAdminPermissions();

    const supabase = getSupabaseAdmin();

    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('id, org_id')
      .eq('id', restaurantId)
      .single();
    if (!restaurant) return { ok: false, error: 'Restaurant not found.' };

    await supabase.from('restaurant_offers').delete().eq('restaurant_id', restaurantId);
    const { error: restErr } = await supabase.from('restaurants').delete().eq('id', restaurantId);
    if (restErr) return { ok: false, error: restErr.message };

    const orgId = (restaurant as { org_id: string }).org_id;
    const { data: others } = await supabase
      .from('restaurants')
      .select('id')
      .eq('org_id', orgId);
    if (!others?.length) {
      await supabase.from('restaurant_orgs').delete().eq('id', orgId);
    }

    revalidatePath('/admin');
    revalidatePath('/locations');
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false, error: message };
  }
}
