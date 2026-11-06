import {
  quoteOffer,
  selectBoost,
  selectQualifyingTier,
  type OfferBoost,
  type OfferTier,
} from '@/lib/offers/calculator';

/**
 * Pure Boost quote. Money, tier choice, and Boost windows come from the E01
 * calculator (`quoteOffer`, `selectQualifyingTier`, `selectBoost`). This module
 * does not read or write a database. A null offer version is an unbound
 * challenge item: refuse it. Do not invent the legacy 1000/4000 amounts.
 *
 * Boost eligibility uses `arrivalAt` in the offer timezone. `confirmedAt` is
 * only the bill-confirmation clock (deadline). Finishing after the Boost
 * window does not drop a bonus that was eligible at arrival.
 */
export const BOOST_QUOTE_REFUSAL_CODES = [
  'unbound',
  'withdrawn',
  'outside_validity',
  'invalid_subtotal',
  'invalid_arrival',
  'invalid_terms',
  'unknown_boost',
  'boost_not_at_arrival',
  'past_deadline',
  'already_superseded',
  'version_mismatch',
] as const;

export type BoostQuoteRefusalCode = (typeof BOOST_QUOTE_REFUSAL_CODES)[number];

export type BoostQuoteRefusal = {
  ok: false;
  code: BoostQuoteRefusalCode;
};

export type BoostQuoteReason =
  | 'quoted'
  | 'below_minimum'
  | 'capped'
  | 'boost_applied'
  | 'boost_locked';

export type SealedBoostOfferVersion = {
  id: string;
  timezone: string;
  validFrom: Date;
  validUntil: Date;
  withdrawn: boolean;
  tiers: OfferTier[];
  boosts: OfferBoost[];
};

export type BoostQuote = {
  quote_version: number;
  offer_version_id: string;
  tier_id: string | null;
  base_discount_cents: number;
  boost_id: string | null;
  boost_discount_cents: number;
  total_discount_cents: number;
  eligible_subtotal_cents: number;
  below_minimum: boolean;
  reasons: BoostQuoteReason[];
  /** Copied on supersede. Never moved later. */
  expires_at: string;
  status: 'active' | 'superseded';
  superseded_at: string | null;
  arrival_at: string;
  locked_boost_id: string | null;
};

export type BoostQuoteResult = { ok: true; quote: BoostQuote } | BoostQuoteRefusal;

export type SupersedeBoostQuoteResult =
  | { ok: true; previous: BoostQuote; next: BoostQuote }
  | BoostQuoteRefusal;

function refuse(code: BoostQuoteRefusalCode): BoostQuoteRefusal {
  return { ok: false, code };
}

function validInstant(value: Date | null | undefined): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** Sealed tiers have no id column. The published threshold is unique per version. */
export function boostTierId(thresholdCents: number): string {
  return `threshold:${thresholdCents}`;
}

function termsAreSealed(version: SealedBoostOfferVersion): boolean {
  if (!version.id || !version.timezone.trim()) return false;
  if (!validInstant(version.validFrom) || !validInstant(version.validUntil)) return false;
  if (version.validUntil.getTime() <= version.validFrom.getTime()) return false;
  if (!Array.isArray(version.tiers) || version.tiers.length < 1) return false;
  if (!Array.isArray(version.boosts)) return false;
  for (const tier of version.tiers) {
    if (!Number.isInteger(tier.thresholdCents) || !Number.isInteger(tier.discountCents)) return false;
    if (tier.thresholdCents <= 0 || tier.discountCents <= 0) return false;
  }
  for (const boost of version.boosts) {
    if (!boost.id || !Number.isInteger(boost.bonusCents) || boost.bonusCents <= 0) return false;
  }
  return true;
}

function earliestInstant(bounds: Date[]): Date {
  return bounds.reduce((earliest, instant) =>
    instant.getTime() < earliest.getTime() ? instant : earliest,
  );
}

export function quoteBoost(input: {
  offerVersion: SealedBoostOfferVersion | null;
  eligibleSubtotalCents: number;
  arrivalAt: Date;
  lockedBoostId?: string | null;
  confirmedAt?: Date | null;
  redemptionDeadline?: Date | null;
  /** Session expiry. Clamped so it cannot be later than the offer or the visit deadline. */
  expiresAt?: Date | null;
}): BoostQuoteResult {
  if (!input.offerVersion) return refuse('unbound');
  const version = input.offerVersion;
  if (!termsAreSealed(version)) return refuse('invalid_terms');
  if (!Number.isInteger(input.eligibleSubtotalCents) || input.eligibleSubtotalCents < 0) {
    return refuse('invalid_subtotal');
  }
  if (!validInstant(input.arrivalAt)) return refuse('invalid_arrival');
  const confirmedAt = input.confirmedAt ?? input.arrivalAt;
  if (!validInstant(confirmedAt)) return refuse('invalid_arrival');
  const deadline = input.redemptionDeadline ?? null;
  if (deadline != null && !validInstant(deadline)) return refuse('invalid_arrival');
  if (input.expiresAt != null && !validInstant(input.expiresAt)) return refuse('invalid_arrival');

  if (version.withdrawn) return refuse('withdrawn');
  const arrivalMs = input.arrivalAt.getTime();
  if (arrivalMs < version.validFrom.getTime() || arrivalMs >= version.validUntil.getTime()) {
    return refuse('outside_validity');
  }

  const lockedId = input.lockedBoostId ?? null;
  let boosts = version.boosts;
  if (lockedId != null) {
    if (!lockedId) return refuse('unknown_boost');
    const locked = version.boosts.filter((boost) => boost.id === lockedId);
    if (locked.length !== 1) return refuse('unknown_boost');
    boosts = locked;
  }

  const quoted = quoteOffer({
    mode: 'bound',
    tiers: version.tiers,
    boosts,
    timeZone: version.timezone,
    validFrom: version.validFrom,
    validUntil: version.validUntil,
    current: true,
    withdrawn: false,
    eligibleSubtotalCents: input.eligibleSubtotalCents,
    at: confirmedAt,
    checkInAt: input.arrivalAt,
    redemptionDeadline: deadline,
  });

  if (quoted.reason === 'past_deadline') return refuse('past_deadline');
  if (quoted.reason === 'ineligible') return refuse('outside_validity');

  const belowMinimum = quoted.reason === 'below_minimum';
  if (lockedId && !belowMinimum && quoted.boostCents === 0) {
    return refuse('boost_not_at_arrival');
  }

  const tier = belowMinimum
    ? null
    : selectQualifyingTier(version.tiers, input.eligibleSubtotalCents);
  const chosen = belowMinimum
    ? null
    : selectBoost(boosts, input.arrivalAt, version.timezone, version.validUntil);

  let base = belowMinimum ? 0 : Math.max(0, quoted.tierCents);
  let boostDiscount = belowMinimum ? 0 : Math.max(0, quoted.boostCents);
  const total = belowMinimum
    ? 0
    : Math.max(0, Math.min(quoted.discountCents, input.eligibleSubtotalCents));
  // Noah 2026-11-05: when the total is capped, reduce the Boost first so the
  // stored parts sum to total_discount_cents. A base that still exceeds the
  // total is reduced only after the Boost is zero. Below minimum stays 0 + 0.
  const capped = !belowMinimum && base + boostDiscount > total;
  if (capped) {
    boostDiscount = Math.min(boostDiscount, Math.max(0, total - base));
    if (base + boostDiscount > total) base = total - boostDiscount;
  }
  const appliedBoost = chosen && boostDiscount > 0 ? chosen : null;

  const reasons: BoostQuoteReason[] = [];
  if (belowMinimum) {
    reasons.push('below_minimum');
  } else {
    reasons.push('quoted');
    if (capped) reasons.push('capped');
    if (appliedBoost) {
      reasons.push('boost_applied');
      if (lockedId && appliedBoost.id === lockedId) reasons.push('boost_locked');
    }
  }

  const expiryBounds = [version.validUntil];
  if (deadline) expiryBounds.push(deadline);
  if (input.expiresAt) expiryBounds.push(input.expiresAt);

  return {
    ok: true,
    quote: {
      quote_version: 1,
      offer_version_id: version.id,
      tier_id: tier && tier.discountCents === base ? boostTierId(tier.thresholdCents) : null,
      base_discount_cents: base,
      boost_id: appliedBoost?.id ?? null,
      boost_discount_cents: boostDiscount,
      total_discount_cents: total,
      eligible_subtotal_cents: input.eligibleSubtotalCents,
      below_minimum: belowMinimum,
      reasons,
      expires_at: earliestInstant(expiryBounds).toISOString(),
      status: 'active',
      superseded_at: null,
      arrival_at: input.arrivalAt.toISOString(),
      locked_boost_id: lockedId,
    },
  };
}

/**
 * Bill correction. Returns a new quote and the previous quote marked superseded.
 * Expiry, arrival, and the locked Boost are copied. A later offer `valid_until`
 * on the terms does not move `expires_at`.
 */
export function supersedeBoostQuote(
  previous: BoostQuote,
  input: {
    offerVersion: SealedBoostOfferVersion | null;
    eligibleSubtotalCents: number;
    supersededAt: Date;
    redemptionDeadline?: Date | null;
  },
): SupersedeBoostQuoteResult {
  if (previous.status !== 'active' || previous.superseded_at) return refuse('already_superseded');
  if (!input.offerVersion) return refuse('unbound');
  if (input.offerVersion.id !== previous.offer_version_id) return refuse('version_mismatch');
  if (!validInstant(input.supersededAt)) return refuse('invalid_arrival');
  const arrivalAt = new Date(previous.arrival_at);
  if (!validInstant(arrivalAt)) return refuse('invalid_arrival');

  const result = quoteBoost({
    offerVersion: input.offerVersion,
    eligibleSubtotalCents: input.eligibleSubtotalCents,
    arrivalAt,
    lockedBoostId: previous.locked_boost_id,
    confirmedAt: input.supersededAt,
    redemptionDeadline: input.redemptionDeadline,
  });
  if (!result.ok) return result;

  return {
    ok: true,
    previous: {
      ...previous,
      status: 'superseded',
      superseded_at: input.supersededAt.toISOString(),
    },
    next: {
      ...result.quote,
      quote_version: previous.quote_version + 1,
      expires_at: previous.expires_at,
      arrival_at: previous.arrival_at,
      locked_boost_id: previous.locked_boost_id,
      status: 'active',
      superseded_at: null,
    },
  };
}
