'use server';

import { openMemberBoostArrival } from '@/lib/boost/arrival-session';
import { createSupabaseArrivalStore } from '@/lib/boost/arrival-store';
import { arrivalSessionsEnabled } from '@/lib/boost/flag';
import { assessMemberCheckIn } from '@/lib/boost/member-check-in';
import { requireUser } from '@/lib/auth/require-user';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { parseUuid } from '@/lib/uuid';

export type MemberBoostCheckInInput = {
  challengeItemId: string;
  idempotencyKey: string;
  location: {
    lat: number;
    lon: number;
    accuracy?: number | null;
    timestamp: number;
  };
  redemptionId?: string | null;
};

function disabled() {
  return { ok: false as const, code: 'disabled' as const };
}

function refuse(code: string) {
  return { ok: false as const, code };
}

function parseKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (key.length < 1 || key.length > 200) return null;
  return key;
}

/**
 * Member "I'm here" for one owned assigned bound item.
 * The restaurant id and pin come from that item, never from the browser.
 * Unset E07_ARRIVAL_SESSIONS_ENABLED returns disabled before any read.
 * Failures are codes only. Coordinates are not returned or logged.
 */
export async function checkInMemberBoost(input: MemberBoostCheckInInput) {
  if (!arrivalSessionsEnabled()) return disabled();
  const auth = await requireUser();
  if (!auth.ok) return refuse('forbidden');

  const challengeItemId = parseUuid(input?.challengeItemId);
  if (!challengeItemId) return refuse('not_found');
  const idempotencyKey = parseKey(input?.idempotencyKey);
  if (!idempotencyKey) return refuse('invalid_idempotency_key');

  let redemptionId: string | null = null;
  if (input.redemptionId != null && input.redemptionId !== '') {
    redemptionId = parseUuid(input.redemptionId);
    if (!redemptionId) return refuse('invalid_terms');
  }

  const admin = getSupabaseAdmin();
  const { data: item, error: itemError } = await admin
    .from('challenge_items')
    .select('id, restaurant_id, status, offer_version_id, cycle_id')
    .eq('id', challengeItemId)
    .maybeSingle();
  if (itemError) return refuse('unavailable');
  if (!item?.restaurant_id || !item.cycle_id) return refuse('not_found');

  const { data: cycle, error: cycleError } = await admin
    .from('challenge_cycles')
    .select('id, user_id')
    .eq('id', item.cycle_id)
    .maybeSingle();
  if (cycleError) return refuse('unavailable');
  if (!cycle) return refuse('not_found');
  if (cycle.user_id !== auth.userId) return refuse('forbidden');
  if (item.status !== 'assigned') return refuse('not_assigned');
  if (!item.offer_version_id) return refuse('unbound');

  const { data: restaurant, error: restaurantError } = await admin
    .from('restaurants')
    .select('id, lat, lon')
    .eq('id', item.restaurant_id)
    .maybeSingle();
  if (restaurantError) return refuse('unavailable');
  if (!restaurant || restaurant.id !== item.restaurant_id) return refuse('restaurant_location_unavailable');

  const now = new Date();
  const geo = assessMemberCheckIn({
    member: {
      lat: input.location?.lat,
      lon: input.location?.lon,
      accuracy: input.location?.accuracy,
      timestamp: input.location?.timestamp,
    },
    restaurant: { lat: restaurant.lat, lon: restaurant.lon },
    now,
  });
  if (!geo.ok) return geo;

  return openMemberBoostArrival(
    { challengeItemId, idempotencyKey, redemptionId },
    {
      restaurantId: item.restaurant_id,
      userId: auth.userId,
      now,
      store: createSupabaseArrivalStore(admin),
    },
  );
}
