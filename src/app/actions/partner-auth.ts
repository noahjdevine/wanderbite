'use server';

import { cookies, headers } from 'next/headers';
import { verifyPartnerPin } from '@/lib/partner-pin';
import {
  LEGACY_PARTNER_COOKIE_NAME,
  PARTNER_ANALYTICS_UNAVAILABLE_MESSAGE,
  PARTNER_COOKIE_KIOSK_MAX_AGE,
  PARTNER_COOKIE_MAX_AGE,
  PARTNER_LOGOUT_FAILED_MESSAGE,
  PARTNER_SESSION_COOKIE_NAME,
  PARTNER_SESSION_EXPIRED_MESSAGE,
  PARTNER_SESSION_START_FAILED_MESSAGE,
  generatePartnerSessionToken,
  hashPartnerSessionToken,
  partnerSessionCookieExpireOptions,
  partnerSessionCookieOptions,
  sessionExpiresAt,
} from '@/lib/partner-session';
import { requirePartnerSession } from '@/lib/require-partner-session';
import { partnerLoginLimiter } from '@/lib/ratelimit';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type PartnerLoginResult =
  | { ok: true; restaurantName: string }
  | { ok: false; error: string };

export type PartnerLogoutResult =
  | { ok: true }
  | { ok: false; error: string };

async function expireNamedPartnerCookie(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  name: string,
) {
  cookieStore.set(name, '', partnerSessionCookieExpireOptions());
}

/** Verify restaurant PIN and set hashed partner session cookie. */
export async function loginPartner(
  restaurantId: string,
  pin: string,
  options?: { rememberDevice?: boolean }
): Promise<PartnerLoginResult> {
  const trimmedPin = pin?.trim();
  if (!restaurantId || !trimmedPin) {
    return { ok: false, error: 'Select a restaurant and enter your PIN.' };
  }

  if (partnerLoginLimiter) {
    const hdrs = await headers();
    const forwarded = hdrs.get('x-forwarded-for') ?? '';
    const ip = forwarded.split(',')[0]?.trim() || hdrs.get('x-real-ip') || 'unknown';
    const key = `${restaurantId}:${ip}`;
    const { success } = await partnerLoginLimiter.limit(key);
    if (!success) {
      return {
        ok: false,
        error: 'Too many attempts. Please try again later.',
      };
    }
  }

  const admin = getSupabaseAdmin();
  const { data: restaurant, error } = await admin
    .from('restaurants')
    .select('id, name, pin_hash, status')
    .eq('id', restaurantId)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !restaurant) {
    return { ok: false, error: 'Restaurant not found.' };
  }

  const row = restaurant as { id: string; name: string; pin_hash: string | null };
  const validPin = await verifyPartnerPin(trimmedPin, row.pin_hash);
  if (!validPin) {
    return { ok: false, error: 'Invalid PIN.' };
  }

  const cookieStore = await cookies();
  const previousToken = cookieStore.get(PARTNER_SESSION_COOKIE_NAME)?.value;
  const previousHash = previousToken ? hashPartnerSessionToken(previousToken) : null;

  const maxAge = options?.rememberDevice ? PARTNER_COOKIE_KIOSK_MAX_AGE : PARTNER_COOKIE_MAX_AGE;
  const { token, tokenHash } = generatePartnerSessionToken();
  const { error: insertError } = await admin.from('partner_sessions').insert({
    token_hash: tokenHash,
    restaurant_id: row.id,
    expires_at: sessionExpiresAt(maxAge),
  });

  if (insertError) {
    console.error('partner session insert failed');
    return { ok: false, error: PARTNER_SESSION_START_FAILED_MESSAGE };
  }

  try {
    cookieStore.set(PARTNER_SESSION_COOKIE_NAME, token, partnerSessionCookieOptions(maxAge));
  } catch {
    const { error: rollbackError } = await admin
      .from('partner_sessions')
      .delete()
      .eq('token_hash', tokenHash);
    if (rollbackError) {
      console.error('partner session cookie-set rollback failed');
    }
    return { ok: false, error: PARTNER_SESSION_START_FAILED_MESSAGE };
  }

  if (previousHash && previousHash !== tokenHash) {
    const { error: revokeError } = await admin
      .from('partner_sessions')
      .delete()
      .eq('token_hash', previousHash);
    if (revokeError) {
      console.error('previous partner session revoke failed after login');
    }
  }

  expireNamedPartnerCookie(cookieStore, LEGACY_PARTNER_COOKIE_NAME);
  return { ok: true, restaurantName: row.name };
}

export type PartnerSession =
  | { ok: true; restaurantId: string; restaurantName: string }
  | { ok: false };

/** Read current partner session from the opaque cookie. */
export async function getPartnerSession(): Promise<PartnerSession> {
  const session = await requirePartnerSession();
  if (!session.ok) return { ok: false };
  return {
    ok: true,
    restaurantId: session.restaurantId,
    restaurantName: session.restaurantName,
  };
}

/** Clear partner session (logout). */
export async function logoutPartner(): Promise<PartnerLogoutResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PARTNER_SESSION_COOKIE_NAME)?.value;
  const tokenHash = token ? hashPartnerSessionToken(token) : null;

  if (tokenHash) {
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('partner_sessions')
      .delete()
      .eq('token_hash', tokenHash);
    if (error) {
      console.error('partner session logout delete failed');
      return { ok: false, error: PARTNER_LOGOUT_FAILED_MESSAGE };
    }
  }

  expireNamedPartnerCookie(cookieStore, PARTNER_SESSION_COOKIE_NAME);
  expireNamedPartnerCookie(cookieStore, LEGACY_PARTNER_COOKIE_NAME);
  return { ok: true };
}

export type PartnerStatsResult =
  | { ok: true; totalRedemptionsThisMonth: number }
  | { ok: false; error: string };

/** Total verified redemptions for the session restaurant in the current month. */
export async function getPartnerRedemptionsThisMonth(): Promise<PartnerStatsResult> {
  const session = await requirePartnerSession();
  if (!session.ok) {
    return { ok: false, error: PARTNER_SESSION_EXPIRED_MESSAGE };
  }

  const admin = getSupabaseAdmin();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  const isoStart = startOfMonth.toISOString();

  const { count, error } = await admin
    .from('redemptions')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', session.restaurantId)
    .eq('status', 'verified')
    .gte('verified_at', isoStart);

  if (error) {
    console.error('partner monthly redemptions query failed');
    return { ok: false, error: PARTNER_ANALYTICS_UNAVAILABLE_MESSAGE };
  }
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
export async function getPartnerAnalytics(): Promise<PartnerAnalyticsResult> {
  const session = await requirePartnerSession();
  if (!session.ok) {
    return { ok: false, error: PARTNER_SESSION_EXPIRED_MESSAGE };
  }

  const restaurantId = session.restaurantId;
  const admin = getSupabaseAdmin();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const isoSixMonthsAgo = sixMonthsAgo.toISOString();
  const isoStartOfMonth = startOfMonth.toISOString();

  const { count: totalVerified, error: countErr } = await admin
    .from('redemptions')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .eq('status', 'verified');

  if (countErr) {
    console.error('partner analytics all-time count failed');
    return { ok: false, error: PARTNER_ANALYTICS_UNAVAILABLE_MESSAGE };
  }
  const total = totalVerified ?? 0;
  const revenueFormatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(total * AVG_TICKET_SIZE);

  const { count: thisMonthCount, error: monthErr } = await admin
    .from('redemptions')
    .select('*', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .eq('status', 'verified')
    .gte('verified_at', isoStartOfMonth);

  if (monthErr) {
    console.error('partner analytics month count failed');
    return { ok: false, error: PARTNER_ANALYTICS_UNAVAILABLE_MESSAGE };
  }

  const { data: lastSixMonthsRows, error: histErr } = await admin
    .from('redemptions')
    .select('verified_at')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'verified')
    .gte('verified_at', isoSixMonthsAgo);

  if (histErr) {
    console.error('partner analytics history query failed');
    return { ok: false, error: PARTNER_ANALYTICS_UNAVAILABLE_MESSAGE };
  }

  const monthCounts: Record<string, number> = {};
  const monthLabels: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
    monthCounts[key] = 0;
    monthLabels.push(label);
  }

  for (const histRow of lastSixMonthsRows ?? []) {
    const r = histRow as { verified_at: string };
    const date = new Date(r.verified_at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (monthCounts[key] !== undefined) monthCounts[key]++;
  }

  const historicalVolume = monthLabels.map((monthLabel, idx) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - idx), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { monthLabel, count: monthCounts[key] ?? 0 };
  });

  const { data: recentRows, error: recentErr } = await admin
    .from('redemptions')
    .select('verified_at, user_id')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'verified')
    .order('verified_at', { ascending: false })
    .limit(10);

  if (recentErr) {
    console.error('partner analytics recent guests query failed');
    return { ok: false, error: PARTNER_ANALYTICS_UNAVAILABLE_MESSAGE };
  }

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
      const profileRow = p as { id: string; email: string | null };
      emailByUserId[profileRow.id] = profileRow.email ?? null;
    }
  }

  const recentCustomers = (recentRows ?? []).map((recent: unknown) => {
    const r = recent as { verified_at: string; user_id: string | null };
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
