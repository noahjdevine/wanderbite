import 'server-only';

import {
  arrivalSessionExpiresAt,
  qualifyingArrivalBoostId,
  sealBoostOfferVersion,
} from '@/lib/boost/arrival';
import type {
  ArrivalQuoteRecord,
  ArrivalSessionRecord,
  ArrivalStore,
} from '@/lib/boost/arrival-store';
import { quoteBoost, supersedeBoostQuote, type BoostQuote } from '@/lib/boost/quote';
import { parseUuid } from '@/lib/uuid';

export const ARRIVAL_SESSION_REFUSAL_CODES = [
  'disabled',
  'forbidden',
  'unavailable',
  'not_found',
  'restaurant_mismatch',
  'not_assigned',
  'unbound',
  'withdrawn',
  'outside_validity',
  'past_deadline',
  'invalid_subtotal',
  'invalid_arrival',
  'invalid_terms',
  'invalid_idempotency_key',
  'session_open',
  'session_closed',
  'already_superseded',
  'version_mismatch',
  'unknown_boost',
  'boost_not_at_arrival',
  'redemption_mismatch',
] as const;

export type ArrivalRefusalCode = (typeof ARRIVAL_SESSION_REFUSAL_CODES)[number];

export type ArrivalRefusal = { ok: false; code: ArrivalRefusalCode };

export type ArrivalSessionSuccess = {
  ok: true;
  session: ArrivalSessionRecord;
  quote: ArrivalQuoteRecord;
};

export type SupersedeArrivalSuccess = {
  ok: true;
  session: ArrivalSessionRecord;
  previous: ArrivalQuoteRecord;
  quote: ArrivalQuoteRecord;
};

export type ArrivalContext = {
  restaurantId: string;
  tokenHash: string;
  now: Date;
  store: ArrivalStore;
};

const TOKEN_HASH = /^[0-9a-f]{64}$/;

function refuse(code: ArrivalRefusalCode): ArrivalRefusal {
  return { ok: false, code };
}

function validInstant(value: Date | null): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function sameInstant(left: string, right: string): boolean {
  const a = new Date(left).getTime();
  const b = new Date(right).getTime();
  return !Number.isNaN(a) && a === b;
}

function parseKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (key.length < 1 || key.length > 200) return null;
  return key;
}

function parseSubtotal(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

async function loadActive(
  store: ArrivalStore,
  session: ArrivalSessionRecord,
): Promise<ArrivalSessionSuccess | ArrivalRefusal> {
  const quote = await store.findActiveQuote(session.id);
  if (!quote) return refuse('unavailable');
  return { ok: true, session, quote };
}

function quoteFromRow(session: ArrivalSessionRecord, quote: ArrivalQuoteRecord): BoostQuote {
  return {
    quote_version: quote.quoteVersion,
    offer_version_id: quote.offerVersionId,
    tier_id: quote.tierId,
    base_discount_cents: quote.baseDiscountCents,
    boost_id: quote.boostId,
    boost_discount_cents: quote.boostDiscountCents,
    total_discount_cents: quote.totalDiscountCents,
    eligible_subtotal_cents: quote.eligibleSubtotalCents,
    below_minimum: quote.belowMinimum,
    reasons: quote.reasons,
    expires_at: session.expiresAt,
    status: 'active',
    superseded_at: null,
    arrival_at: session.arrivalAt,
    locked_boost_id: session.lockedBoostId,
  };
}

/**
 * Open or return the arrival session for this partner restaurant.
 * The same idempotency key returns the stored session and quote and does not
 * move expires_at. A second open session for the same challenge item is refused.
 * Staff-confirmed cents only. No bill scan and no redemption QR.
 */
export async function openBoostArrival(
  input: {
    challengeItemId: string;
    idempotencyKey: string;
    eligibleSubtotalCents: number;
    redemptionId?: string | null;
  },
  ctx: ArrivalContext,
): Promise<ArrivalSessionSuccess | ArrivalRefusal> {
  if (!validInstant(ctx.now)) return refuse('invalid_arrival');
  if (!TOKEN_HASH.test(ctx.tokenHash)) return refuse('unavailable');
  const challengeItemId = parseUuid(input.challengeItemId);
  if (!challengeItemId) return refuse('not_found');
  const idempotencyKey = parseKey(input.idempotencyKey);
  if (!idempotencyKey) return refuse('invalid_idempotency_key');
  const subtotal = parseSubtotal(input.eligibleSubtotalCents);
  if (subtotal == null) return refuse('invalid_subtotal');

  let redemptionId: string | null = null;
  if (input.redemptionId != null && input.redemptionId !== '') {
    redemptionId = parseUuid(input.redemptionId);
    if (!redemptionId) return refuse('invalid_terms');
  }

  const existing = await ctx.store.findSessionByKey(ctx.restaurantId, idempotencyKey);
  if (existing) return loadActive(ctx.store, existing);

  const item = await ctx.store.findItem(challengeItemId);
  if (!item) return refuse('not_found');
  if (item.restaurantId !== ctx.restaurantId) return refuse('restaurant_mismatch');
  if (item.status !== 'assigned') return refuse('not_assigned');
  if (!item.offerVersionId) return refuse('unbound');

  const versionRow = await ctx.store.findVersion(item.offerVersionId, ctx.restaurantId);
  if (!versionRow) return refuse('unbound');
  const version = sealBoostOfferVersion(versionRow);
  if (!version) return refuse('invalid_terms');
  if (
    versionRow.boostSessionMinutes != null &&
    (!Number.isInteger(versionRow.boostSessionMinutes) || versionRow.boostSessionMinutes <= 0)
  ) {
    return refuse('invalid_terms');
  }

  const deadline = item.redemptionDeadline ? new Date(item.redemptionDeadline) : null;
  if (item.redemptionDeadline && !validInstant(deadline)) return refuse('invalid_arrival');

  const expiresAt = arrivalSessionExpiresAt({
    arrivalAt: ctx.now,
    validUntil: version.validUntil,
    redemptionDeadline: deadline,
    boostSessionMinutes: versionRow.boostSessionMinutes,
  });

  let quoted: ReturnType<typeof quoteBoost>;
  try {
    quoted = quoteBoost({
      offerVersion: version,
      eligibleSubtotalCents: subtotal,
      arrivalAt: ctx.now,
      confirmedAt: ctx.now,
      redemptionDeadline: deadline,
      expiresAt,
    });
  } catch {
    return refuse('invalid_terms');
  }
  if (!quoted.ok) return quoted;
  if (!expiresAt || new Date(quoted.quote.expires_at).getTime() !== expiresAt.getTime()) {
    return refuse('invalid_terms');
  }
  const quote = quoted.quote;
  if (quote.base_discount_cents + quote.boost_discount_cents !== quote.total_discount_cents) {
    return refuse('invalid_terms');
  }

  const opened = await ctx.store.openSession({
    restaurantId: ctx.restaurantId,
    challengeItemId,
    offerVersionId: version.id,
    redemptionId,
    lockedBoostId: qualifyingArrivalBoostId(version, ctx.now, quote),
    arrivalAt: ctx.now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    idempotencyKey,
    createdByTokenHash: ctx.tokenHash,
    tierId: quote.tier_id,
    baseDiscountCents: quote.base_discount_cents,
    boostId: quote.boost_id,
    boostDiscountCents: quote.boost_discount_cents,
    totalDiscountCents: quote.total_discount_cents,
    eligibleSubtotalCents: quote.eligible_subtotal_cents,
    belowMinimum: quote.below_minimum,
    reasons: quote.reasons,
  });

  if (opened.status === 'session_open') return refuse('session_open');
  if (opened.status === 'restaurant_mismatch') return refuse('restaurant_mismatch');
  if (opened.status === 'version_mismatch') return refuse('version_mismatch');
  if (opened.status === 'redemption_mismatch') return refuse('redemption_mismatch');
  if (opened.status !== 'created' && opened.status !== 'existing') return refuse('unavailable');

  const session = await ctx.store.findSession(opened.sessionId, ctx.restaurantId);
  if (!session) return refuse('unavailable');
  return loadActive(ctx.store, session);
}

async function supersedeOnce(
  input: { sessionId: string; eligibleSubtotalCents: number },
  ctx: ArrivalContext,
  allowRetry: boolean,
): Promise<SupersedeArrivalSuccess | ArrivalRefusal> {
  const session = await ctx.store.findSession(input.sessionId, ctx.restaurantId);
  if (!session) return refuse('not_found');
  if (session.status !== 'open') return refuse('session_closed');
  const previous = await ctx.store.findActiveQuote(session.id);
  if (!previous) return refuse('already_superseded');

  const item = await ctx.store.findItem(session.challengeItemId);
  if (!item || item.restaurantId !== ctx.restaurantId) return refuse('restaurant_mismatch');
  if (item.offerVersionId !== session.offerVersionId) return refuse('version_mismatch');

  const versionRow = await ctx.store.findVersion(session.offerVersionId, ctx.restaurantId);
  if (!versionRow) return refuse('invalid_terms');
  const version = sealBoostOfferVersion(versionRow);
  if (!version) return refuse('invalid_terms');

  const deadline = item.redemptionDeadline ? new Date(item.redemptionDeadline) : null;
  if (item.redemptionDeadline && !validInstant(deadline)) return refuse('invalid_arrival');

  const previousQuote = quoteFromRow(session, previous);
  let result: ReturnType<typeof supersedeBoostQuote>;
  try {
    result = supersedeBoostQuote(previousQuote, {
      offerVersion: version,
      eligibleSubtotalCents: input.eligibleSubtotalCents,
      supersededAt: ctx.now,
      redemptionDeadline: deadline,
    });
  } catch {
    return refuse('invalid_terms');
  }
  if (!result.ok) return result;
  const next = result.next;
  if (next.base_discount_cents + next.boost_discount_cents !== next.total_discount_cents) {
    return refuse('invalid_terms');
  }
  if (!sameInstant(next.expires_at, session.expiresAt)) return refuse('invalid_terms');
  if (!sameInstant(next.arrival_at, session.arrivalAt)) return refuse('invalid_terms');
  if (next.locked_boost_id !== session.lockedBoostId) return refuse('invalid_terms');

  const saved = await ctx.store.supersedeQuote({
    sessionId: session.id,
    restaurantId: ctx.restaurantId,
    supersededAt: ctx.now.toISOString(),
    quoteVersion: next.quote_version,
    tierId: next.tier_id,
    baseDiscountCents: next.base_discount_cents,
    boostId: next.boost_id,
    boostDiscountCents: next.boost_discount_cents,
    totalDiscountCents: next.total_discount_cents,
    eligibleSubtotalCents: next.eligible_subtotal_cents,
    belowMinimum: next.below_minimum,
    reasons: next.reasons,
    expiresAt: session.expiresAt,
  });

  if (saved.status === 'conflict' && allowRetry) return supersedeOnce(input, ctx, false);
  if (saved.status === 'not_found') return refuse('not_found');
  if (saved.status === 'session_closed') return refuse('session_closed');
  if (saved.status === 'no_active_quote') return refuse('already_superseded');
  if (saved.status !== 'created') return refuse('unavailable');

  const stored = await ctx.store.findSession(session.id, ctx.restaurantId);
  const active = stored ? await ctx.store.findActiveQuote(stored.id) : null;
  if (!stored || !active) return refuse('unavailable');
  return {
    ok: true,
    session: stored,
    previous: { ...previous, supersededAt: ctx.now.toISOString() },
    quote: active,
  };
}

/** Bill correction. Copies expiry, arrival, and the locked Boost. Does not extend the session. */
export async function supersedeBoostArrival(
  input: { sessionId: string; eligibleSubtotalCents: number },
  ctx: ArrivalContext,
): Promise<SupersedeArrivalSuccess | ArrivalRefusal> {
  if (!validInstant(ctx.now)) return refuse('invalid_arrival');
  if (!TOKEN_HASH.test(ctx.tokenHash)) return refuse('unavailable');
  const sessionId = parseUuid(input.sessionId);
  if (!sessionId) return refuse('not_found');
  const subtotal = parseSubtotal(input.eligibleSubtotalCents);
  if (subtotal == null) return refuse('invalid_subtotal');
  return supersedeOnce({ sessionId, eligibleSubtotalCents: subtotal }, ctx, true);
}
