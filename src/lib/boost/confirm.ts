import type { SealedBase } from '@/lib/offers/sealed-base';

/**
 * Pure plan for how confirmation should treat an arrival session and its
 * active quote. No database, no verify RPC, and no savings write.
 *
 * Instants are absolute. This module does not apply the E01 fall-back clock
 * face. A 1:30 AM visit deadline is whichever ISO instant the caller passes.
 * Session `expiresAt` in the past is not a refusal and is not moved. A locked
 * Boost still applies after that window until `redemptionDeadline`.
 *
 * `boost_quotes` has no restaurant or challenge-item column. Those quote
 * fields are optional caller context: omitted means unknown, not a mismatch.
 * `offerVersionId`, `sessionId`, and `expiresAt` are on the quote row.
 */
export const BOOST_CONFIRMATION_REFUSALS = [
  'missing_quote',
  'session_closed',
  'past_deadline',
  'mismatch',
  'invalid_quote',
] as const;

export type BoostConfirmationRefusal = (typeof BOOST_CONFIRMATION_REFUSALS)[number];

/** Fields confirmation reads. Extra stored columns are not required. */
export type BoostConfirmationSession = {
  id: string;
  status: 'open' | 'closed';
  expiresAt: string;
  lockedBoostId: string | null;
  challengeItemId: string;
  restaurantId: string;
  offerVersionId: string;
};

/**
 * Active quote row, plus optional restaurant and item when the caller has
 * them from the visit. Those two are not columns on `boost_quotes`.
 */
export type BoostConfirmationQuote = {
  id: string;
  sessionId: string;
  offerVersionId: string;
  quoteVersion: number;
  baseDiscountCents: number;
  boostDiscountCents: number;
  totalDiscountCents: number;
  eligibleSubtotalCents: number;
  belowMinimum: boolean;
  tierId: string | null;
  boostId: string | null;
  expiresAt: string;
  supersededAt: string | null;
  restaurantId?: string | null;
  challengeItemId?: string | null;
};

/** Quote parts copied for a later savings write. Not persisted in C1. */
export type BoostQuoteSavings = {
  quote_id: string;
  quote_version: number;
  base_discount_cents: number;
  boost_discount_cents: number;
  total_discount_cents: number;
  eligible_subtotal_cents: number;
  below_minimum: boolean;
  tier_id: string | null;
  boost_id: string | null;
  locked_boost_id: string | null;
  expires_at: string;
};

export type BoostConfirmationProgress = {
  kind: 'visit_verified';
  total_discount_cents: number | null;
  quote_id: string | null;
};

export type BoostSettlementSnapshot = BoostQuoteSavings | SealedBase | null;

/**
 * A prior settlement. `snapshot: null` is a recorded sealed miss, distinct
 * from omitting `recorded` (not settled yet).
 */
export type RecordedBoostSettlement = {
  snapshot: BoostSettlementSnapshot;
};

export type PlanBoostConfirmationInput = {
  now: Date;
  redemptionDeadline: Date | null;
  session: BoostConfirmationSession | null;
  quote: BoostConfirmationQuote | null;
  sealedBase: SealedBase | null;
  recorded?: RecordedBoostSettlement | null;
};

export type BoostConfirmationPlan =
  | {
      ok: true;
      kind: 'use_sealed_base';
      reason: 'no_session';
      snapshot: SealedBase | null;
      progress: BoostConfirmationProgress;
    }
  | { ok: true; kind: 'needs_subtotal' }
  | {
      ok: true;
      kind: 'consume_quote';
      snapshot: BoostQuoteSavings;
      progress: BoostConfirmationProgress;
    }
  | {
      ok: true;
      kind: 'already_settled';
      snapshot: BoostSettlementSnapshot;
      progress: BoostConfirmationProgress;
    }
  | { ok: false; kind: BoostConfirmationRefusal };

function validInstant(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function sameInstant(left: string, right: string): boolean {
  const a = Date.parse(left);
  const b = Date.parse(right);
  return Number.isFinite(a) && a === b;
}

function progressFor(snapshot: BoostSettlementSnapshot): BoostConfirmationProgress {
  if (snapshot == null) {
    return { kind: 'visit_verified', total_discount_cents: null, quote_id: null };
  }
  if ('quote_id' in snapshot) {
    return {
      kind: 'visit_verified',
      total_discount_cents: snapshot.total_discount_cents,
      quote_id: snapshot.quote_id,
    };
  }
  return {
    kind: 'visit_verified',
    total_discount_cents: snapshot.discount_amount_cents,
    quote_id: null,
  };
}

function wholeCents(value: number): boolean {
  return Number.isInteger(value);
}

function quoteIsActiveMath(quote: BoostConfirmationQuote): boolean {
  if (quote.supersededAt != null) return false;
  if (!quote.id || !quote.sessionId || !quote.offerVersionId) return false;
  if (quote.tierId === '' || quote.boostId === '') return false;
  const base = quote.baseDiscountCents;
  const boost = quote.boostDiscountCents;
  const total = quote.totalDiscountCents;
  const eligible = quote.eligibleSubtotalCents;
  if (!wholeCents(quote.quoteVersion) || quote.quoteVersion < 1) return false;
  if (!wholeCents(base) || !wholeCents(boost) || !wholeCents(total) || !wholeCents(eligible)) {
    return false;
  }
  if (base < 0 || boost < 0 || total < 0 || eligible < 0) return false;
  if (base + boost !== total) return false;
  if (total > eligible) return false;
  return true;
}

/**
 * Check-in stores eligible subtotal 0, and that quote is below minimum.
 * `eligibleSubtotalCents === 0` is the placeholder. `belowMinimum` with no
 * positive subtotal is the same case: there is no staff-confirmed amount.
 * A positive eligible subtotal is that evidence, even when it misses the tier.
 * That under-tier total stays the quote's own cents. This helper does not
 * invent the 1000-cent display fallback from getMemberProgress.
 */
function isPlaceholderQuote(quote: BoostConfirmationQuote): boolean {
  const noStaffSubtotal = quote.eligibleSubtotalCents <= 0;
  return quote.eligibleSubtotalCents === 0 || (quote.belowMinimum && noStaffSubtotal);
}

function identitiesDisagree(session: BoostConfirmationSession, quote: BoostConfirmationQuote): boolean {
  if (!session.id || !session.restaurantId || !session.challengeItemId || !session.offerVersionId) {
    return true;
  }
  if (quote.sessionId !== session.id) return true;
  if (quote.offerVersionId !== session.offerVersionId) return true;
  if (!sameInstant(quote.expiresAt, session.expiresAt)) return true;
  if (quote.restaurantId != null && quote.restaurantId !== session.restaurantId) return true;
  if (quote.challengeItemId != null && quote.challengeItemId !== session.challengeItemId) return true;
  return false;
}

function savingsFrom(session: BoostConfirmationSession, quote: BoostConfirmationQuote): BoostQuoteSavings {
  return {
    quote_id: quote.id,
    quote_version: quote.quoteVersion,
    base_discount_cents: quote.baseDiscountCents,
    boost_discount_cents: quote.boostDiscountCents,
    total_discount_cents: quote.totalDiscountCents,
    eligible_subtotal_cents: quote.eligibleSubtotalCents,
    below_minimum: quote.belowMinimum,
    tier_id: quote.tierId,
    boost_id: quote.boostId,
    locked_boost_id: session.lockedBoostId,
    expires_at: quote.expiresAt,
  };
}

/**
 * Classify one confirmation. Does not read or write a quote, session, or
 * redemption. `recorded` wins, so a replay cannot apply a second discount.
 */
export function planBoostConfirmation(input: PlanBoostConfirmationInput): BoostConfirmationPlan {
  if (input.recorded != null) {
    return {
      ok: true,
      kind: 'already_settled',
      snapshot: input.recorded.snapshot,
      progress: progressFor(input.recorded.snapshot),
    };
  }

  const session = input.session;
  if (!session) {
    return {
      ok: true,
      kind: 'use_sealed_base',
      reason: 'no_session',
      snapshot: input.sealedBase,
      progress: progressFor(input.sealedBase),
    };
  }

  const deadline = input.redemptionDeadline;
  if (deadline != null && validInstant(input.now) && validInstant(deadline)) {
    if (input.now.getTime() >= deadline.getTime()) {
      return { ok: false, kind: 'past_deadline' };
    }
  } else if (!validInstant(input.now) || (deadline != null && !validInstant(deadline))) {
    // An unreadable clock cannot prove the visit is still open, so this does not consume.
    return { ok: false, kind: 'invalid_quote' };
  }

  if (session.status !== 'open') return { ok: false, kind: 'session_closed' };

  const quote = input.quote;
  if (!quote) return { ok: false, kind: 'missing_quote' };
  if (identitiesDisagree(session, quote)) return { ok: false, kind: 'mismatch' };
  if (!quoteIsActiveMath(quote)) return { ok: false, kind: 'invalid_quote' };
  if (isPlaceholderQuote(quote)) return { ok: true, kind: 'needs_subtotal' };

  const snapshot = savingsFrom(session, quote);
  return {
    ok: true,
    kind: 'consume_quote',
    snapshot,
    progress: progressFor(snapshot),
  };
}
