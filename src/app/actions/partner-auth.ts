'use server';

import { cookies } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const PARTNER_COOKIE_NAME = 'partner_restaurant_id';
const PARTNER_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type PartnerLoginResult =
  | { ok: true; restaurantName: string }
  | { ok: false; error: string };

/** Verify restaurant PIN and set partner session cookie. */
export async function loginPartner(
  restaurantId: string,
  pin: string
): Promise<PartnerLoginResult> {
  const trimmedPin = pin?.trim();
  if (!restaurantId || !trimmedPin) {
    return { ok: false, error: 'Select a restaurant and enter your PIN.' };
  }

  const admin = getSupabaseAdmin();
  const { data: restaurant, error } = await admin
    .from('restaurants')
    .select('id, name, pin')
    .eq('id', restaurantId)
    .maybeSingle();

  if (error || !restaurant) {
    return { ok: false, error: 'Restaurant not found.' };
  }

  const r = restaurant as { id: string; name: string; pin: string | null };
  if (!r.pin || r.pin.trim() !== trimmedPin) {
    return { ok: false, error: 'Invalid PIN.' };
  }

  const cookieStore = await cookies();
  cookieStore.set(PARTNER_COOKIE_NAME, r.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: PARTNER_COOKIE_MAX_AGE,
    path: '/',
  });

  return { ok: true, restaurantName: r.name };
}

export type PartnerSession =
  | { ok: true; restaurantId: string; restaurantName: string }
  | { ok: false };

/** Read current partner session from cookie. */
export async function getPartnerSession(): Promise<PartnerSession> {
  const cookieStore = await cookies();
  const restaurantId = cookieStore.get(PARTNER_COOKIE_NAME)?.value;
  if (!restaurantId) return { ok: false };

  const admin = getSupabaseAdmin();
  const { data: restaurant } = await admin
    .from('restaurants')
    .select('id, name')
    .eq('id', restaurantId)
    .maybeSingle();

  if (!restaurant) return { ok: false };
  const r = restaurant as { id: string; name: string };
  return { ok: true, restaurantId: r.id, restaurantName: r.name };
}

/** Clear partner session (logout). */
export async function logoutPartner(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(PARTNER_COOKIE_NAME);
}

export type PartnerStatsResult =
  | { ok: true; totalRedemptionsThisMonth: number }
  | { ok: false; error: string };

/** Total verified redemptions for this restaurant in the current month. */
export async function getPartnerRedemptionsThisMonth(
  restaurantId: string
): Promise<PartnerStatsResult> {
  const admin = getSupabaseAdmin();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  const isoStart = startOfMonth.toISOString();

  const { count, error } = await admin
    .from('redemptions')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .eq('status', 'verified')
    .gte('verified_at', isoStart);

  if (error) return { ok: false, error: error.message };
  return { ok: true, totalRedemptionsThisMonth: count ?? 0 };
}
