import 'server-only';

import { cookies } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  PARTNER_SESSION_COOKIE_NAME,
  hashPartnerSessionToken,
} from '@/lib/partner-session';

export type RequirePartnerSessionResult =
  | { ok: true; restaurantId: string; restaurantName: string; tokenHash: string }
  | { ok: false };

/**
 * Resolve the partner restaurant from the opaque session cookie.
 * Does not mutate cookies (safe from Server Components).
 */
export async function requirePartnerSession(): Promise<RequirePartnerSessionResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PARTNER_SESSION_COOKIE_NAME)?.value;
  if (!token) return { ok: false };

  const tokenHash = hashPartnerSessionToken(token);
  if (!tokenHash) return { ok: false };

  const admin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const { data: session, error: sessionError } = await admin
    .from('partner_sessions')
    .select('token_hash, restaurant_id, expires_at')
    .eq('token_hash', tokenHash)
    .gt('expires_at', nowIso)
    .maybeSingle();

  if (sessionError || !session) return { ok: false };

  const row = session as { token_hash: string; restaurant_id: string };
  const { data: restaurant, error: restaurantError } = await admin
    .from('restaurants')
    .select('id, name, status')
    .eq('id', row.restaurant_id)
    .eq('status', 'active')
    .maybeSingle();

  if (restaurantError || !restaurant) return { ok: false };

  const r = restaurant as { id: string; name: string };
  return {
    ok: true,
    restaurantId: r.id,
    restaurantName: r.name,
    tokenHash: row.token_hash,
  };
}
