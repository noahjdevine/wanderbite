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

const AVG_TICKET_SIZE = 45;

function maskEmail(email: string | null): string {
  if (!email || !email.includes('@')) return '—';
  const [local, domain] = email.split('@');
  if (!local?.length) return '—';
  return `${local[0]}***@${domain}`;
}

export type PartnerAnalyticsResult =
  | {
      ok: true;
      revenueFormatted: string;
      totalRedemptionsAllTime: number;
      totalRedemptionsThisMonth: number;
      historicalVolume: { monthLabel: string; count: number }[];
      recentCustomers: { emailMasked: string; verifiedAt: string }[];
    }
  | { ok: false; error: string };

/**
 * Fetches analytics for the partner dashboard: revenue estimate, 6-month volume, recent guests.
 */
export async function getPartnerAnalytics(
  restaurantId: string
): Promise<PartnerAnalyticsResult> {
  const admin = getSupabaseAdmin();

  // Start of current month (UTC) for "this month" and 6-month window
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const isoSixMonthsAgo = sixMonthsAgo.toISOString();
  const isoStartOfMonth = startOfMonth.toISOString();

  // Total verified redemptions (all time) for revenue
  const { count: totalVerified, error: countErr } = await admin
    .from('redemptions')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .eq('status', 'verified');

  if (countErr) return { ok: false, error: countErr.message };
  const total = totalVerified ?? 0;
  const revenueFormatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(total * AVG_TICKET_SIZE);

  // This month count
  const { count: thisMonthCount, error: monthErr } = await admin
    .from('redemptions')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .eq('status', 'verified')
    .gte('verified_at', isoStartOfMonth);

  if (monthErr) return { ok: false, error: monthErr.message };

  // Last 6 months: fetch verified redemptions with verified_at in range, then group by month
  const { data: lastSixMonthsRows, error: histErr } = await admin
    .from('redemptions')
    .select('verified_at')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'verified')
    .gte('verified_at', isoSixMonthsAgo);

  if (histErr) return { ok: false, error: histErr.message };

  const monthCounts: Record<string, number> = {};
  const monthLabels: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
    monthCounts[key] = 0;
    monthLabels.push(label);
  }

  for (const row of lastSixMonthsRows ?? []) {
    const r = row as { verified_at: string };
    const date = new Date(r.verified_at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (monthCounts[key] !== undefined) monthCounts[key]++;
  }

  const historicalVolume = monthLabels.map((monthLabel, idx) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - idx), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { monthLabel, count: monthCounts[key] ?? 0 };
  });

  // Recent customers: last 5–10 verified redemptions with user email
  const { data: recentRows, error: recentErr } = await admin
    .from('redemptions')
    .select('verified_at, user_id')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'verified')
    .order('verified_at', { ascending: false })
    .limit(10);

  if (recentErr) return { ok: false, error: recentErr.message };

  const userIds = [
    ...new Set(
      (recentRows ?? [])
        .map((r: unknown) => (r as { user_id: string | null }).user_id)
        .filter(Boolean)
    ),
  ] as string[];
  const emailByUserId: Record<string, string | null> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from('user_profiles')
      .select('id, email')
      .in('id', userIds);
    for (const p of profiles ?? []) {
      const row = p as { id: string; email: string | null };
      emailByUserId[row.id] = row.email ?? null;
    }
  }

  const recentCustomers = (recentRows ?? []).map((row: unknown) => {
    const r = row as { verified_at: string; user_id: string | null };
    const email = r.user_id ? emailByUserId[r.user_id] ?? null : null;
    return {
      emailMasked: maskEmail(email),
      verifiedAt: r.verified_at
        ? new Date(r.verified_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '—',
    };
  });

  return {
    ok: true,
    revenueFormatted,
    totalRedemptionsAllTime: total,
    totalRedemptionsThisMonth: thisMonthCount ?? 0,
    historicalVolume,
    recentCustomers,
  };
}
