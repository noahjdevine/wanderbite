'use server';

import { openBoostArrival, supersedeBoostArrival } from '@/lib/boost/arrival-session';
import { createSupabaseArrivalStore } from '@/lib/boost/arrival-store';
import { arrivalSessionsEnabled } from '@/lib/boost/flag';
import { requirePartnerSession } from '@/lib/require-partner-session';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type CreateBoostArrivalInput = {
  challengeItemId: string;
  idempotencyKey: string;
  eligibleSubtotalCents: number;
  redemptionId?: string | null;
};

function disabled() {
  return { ok: false as const, code: 'disabled' as const };
}

function forbidden() {
  return { ok: false as const, code: 'forbidden' as const };
}

/**
 * Partner check-in for one assigned bound item. Idempotent on
 * (restaurant, idempotency key). The restaurant id comes from the partner
 * session, never from the caller. Unset E07_ARRIVAL_SESSIONS_ENABLED does
 * not read the new tables.
 */
export async function createBoostArrivalSession(input: CreateBoostArrivalInput) {
  if (!arrivalSessionsEnabled()) return disabled();
  const session = await requirePartnerSession();
  if (!session.ok) return forbidden();
  return openBoostArrival(
    {
      challengeItemId: input.challengeItemId,
      idempotencyKey: input.idempotencyKey,
      eligibleSubtotalCents: input.eligibleSubtotalCents,
      redemptionId: input.redemptionId ?? null,
    },
    {
      restaurantId: session.restaurantId,
      tokenHash: session.tokenHash,
      now: new Date(),
      store: createSupabaseArrivalStore(getSupabaseAdmin()),
    },
  );
}

/** Staff-confirmed subtotal correction. Does not move session expiry. */
export async function supersedeBoostArrivalQuote(input: {
  sessionId: string;
  eligibleSubtotalCents: number;
}) {
  if (!arrivalSessionsEnabled()) return disabled();
  const session = await requirePartnerSession();
  if (!session.ok) return forbidden();
  return supersedeBoostArrival(
    {
      sessionId: input.sessionId,
      eligibleSubtotalCents: input.eligibleSubtotalCents,
    },
    {
      restaurantId: session.restaurantId,
      tokenHash: session.tokenHash,
      now: new Date(),
      store: createSupabaseArrivalStore(getSupabaseAdmin()),
    },
  );
}
