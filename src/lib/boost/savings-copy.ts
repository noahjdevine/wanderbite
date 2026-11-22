import { formatCents } from '@/lib/offers/sealed-base';
import { SAVINGS_CORRECTION_NOTE } from '@/lib/progress/savings-cents';
import { visitStatusCountsAsVisit, type VisitStatus } from '@/lib/visits/visit-status';

/**
 * What partner redeem and the member QR may show after confirmation planning.
 * `needs_subtotal` is a signal only. It is not a dollar amount.
 */
export type ConfirmedQuoteSavings = {
  totalDiscountCents: number;
  baseDiscountCents: number;
  boostDiscountCents: number;
};

export type BoostSavingsView =
  | { kind: 'quote'; savings: ConfirmedQuoteSavings }
  | { kind: 'needs_subtotal' }
  | { kind: 'hidden' };

export type VerifyBoostFields = {
  hideDiscountAmount: boolean;
  confirmedTotalDiscountCents: number | null;
  confirmedBaseDiscountCents: number | null;
  confirmedBoostDiscountCents: number | null;
  needsSubtotal: boolean;
};

/** Quote totals are shown. Every other plan keeps today's hide rule. */
export function verifyBoostFields(versionBound: boolean, view: BoostSavingsView): VerifyBoostFields {
  if (view.kind === 'quote') {
    return {
      hideDiscountAmount: false,
      confirmedTotalDiscountCents: view.savings.totalDiscountCents,
      confirmedBaseDiscountCents: view.savings.baseDiscountCents,
      confirmedBoostDiscountCents: view.savings.boostDiscountCents,
      needsSubtotal: false,
    };
  }
  return {
    hideDiscountAmount: versionBound,
    confirmedTotalDiscountCents: null,
    confirmedBaseDiscountCents: null,
    confirmedBoostDiscountCents: null,
    needsSubtotal: view.kind === 'needs_subtotal',
  };
}

/** Member QR line. Null means do not add a dollar figure. */
export function qrConfirmedDiscountLabel(cents: number): string {
  return `${formatCents(cents)} off`;
}

export function qrLabelForView(view: BoostSavingsView): string | null {
  if (view.kind !== 'quote') return null;
  return qrConfirmedDiscountLabel(view.savings.totalDiscountCents);
}

/** Partner redeem sentence. Null keeps today's verified copy. */
export function redeemSavingsCopy(input: {
  confirmedTotalDiscountCents?: number | null;
  confirmedBaseDiscountCents?: number | null;
  confirmedBoostDiscountCents?: number | null;
  needsSubtotal?: boolean;
}): string | null {
  if (input.needsSubtotal) return 'Bill needs confirm';
  if (input.confirmedTotalDiscountCents == null) return null;
  const total = qrConfirmedDiscountLabel(input.confirmedTotalDiscountCents);
  const base = input.confirmedBaseDiscountCents;
  const boost = input.confirmedBoostDiscountCents;
  if (base == null || boost == null) return total;
  return `${total} (${formatCents(base)} base + ${formatCents(boost)} Boost)`;
}

export type RedeemSettlementLines = {
  discount: string;
  boost: string;
  total: string;
};

/**
 * Partner result lines from stored settlement cents.
 * Null when any part is missing. This does not recompute a quote.
 */
export function redeemSettlementLines(input: {
  confirmedBaseDiscountCents?: number | null;
  confirmedBoostDiscountCents?: number | null;
  confirmedTotalDiscountCents?: number | null;
}): RedeemSettlementLines | null {
  const base = wholeSavingsCents(input.confirmedBaseDiscountCents);
  const boost = wholeSavingsCents(input.confirmedBoostDiscountCents);
  const total = wholeSavingsCents(input.confirmedTotalDiscountCents);
  if (base == null || boost == null || total == null) return null;
  return {
    discount: `Discount ${formatCents(base)}`,
    boost: `Boost ${formatCents(boost)}`,
    total: `Wanderbite covers ${formatCents(total)}`,
  };
}

/**
 * Staff sentence after a confirmed quote that missed the offer minimum.
 * The covered amount is the quote total. This does not invent a base-only price.
 */
export function belowMinimumQuoteCopy(input: {
  belowMinimum: boolean;
  totalDiscountCents: number;
  minSpendCents?: number | null;
}): string | null {
  const total = wholeSavingsCents(input.totalDiscountCents);
  if (!input.belowMinimum || total == null) return null;
  const minimum =
    typeof input.minSpendCents === 'number' &&
    Number.isInteger(input.minSpendCents) &&
    input.minSpendCents > 0
      ? ` of ${formatCents(input.minSpendCents)}`
      : '';
  return `This bill is below the offer minimum${minimum}, so the Boost does not apply. Wanderbite covers ${formatCents(total)} on this quote. You can still verify the visit.`;
}

/** Ticket line for a sealed Boost bonus. Null hides it. */
export function challengeBoostLine(bonusCents: number | null | undefined): string | null {
  const bonus = wholeSavingsCents(bonusCents);
  if (bonus == null || bonus <= 0) return null;
  return `+${formatCents(bonus)} Boost`;
}

/**
 * The check-in placeholder has no staff-confirmed subtotal.
 * Eligible subtotal 0 is that placeholder. `belowMinimum` with no positive
 * subtotal is the same case. A positive subtotal is staff evidence, including
 * when it misses the tier.
 */
export function quoteStillNeedsSubtotal(quote: {
  eligibleSubtotalCents: number;
  belowMinimum: boolean;
}): boolean {
  const noStaffSubtotal = quote.eligibleSubtotalCents <= 0;
  return quote.eligibleSubtotalCents === 0 || (quote.belowMinimum && noStaffSubtotal);
}

export const BOOST_BILL_BEFORE_VERIFY_MESSAGE =
  'This guest locked a Boost. Enter the eligible bill subtotal, then verify the code.';

export const BOOST_LOCK_PENDING_NOTE =
  'Boost is locked. It will apply once the restaurant confirms the bill.';

type ChallengeOffer =
  | { available: false }
  | { available: true; discount_amount_cents: number; min_spend_cents: number };

function wholeSavingsCents(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * Cents the Challenges card shows for one visit.
 * A whole non-negative correction replaces the stored snapshot.
 * No correction keeps that snapshot. Neither one invents the 1000-cent fallback.
 */
export function challengeVisitSavings(input: {
  storedCents?: number | null;
  correctedCents?: number | null;
}): { cents: number | null; corrected: boolean } {
  const corrected = wholeSavingsCents(input.correctedCents);
  if (corrected != null) return { cents: corrected, corrected: true };
  const stored = wholeSavingsCents(input.storedCents);
  if (stored != null) return { cents: stored, corrected: false };
  return { cents: null, corrected: false };
}

/**
 * Challenges ticket offer line.
 * A verified visit with a stored whole-cent settlement shows that saved amount.
 * A savings correction uses the same cents and the Progress fix note.
 * The sealed offer stays a separate "Offer" line. Anything else keeps today's offer.
 * This does not recompute a quote and does not invent the 1000-cent fallback.
 */
export function challengeTicketOffer(input: {
  offer: ChallengeOffer;
  visitStatus?: VisitStatus | null;
  storedSavingsCents?: number | null;
  savingsCorrected?: boolean;
}): { amount: string; requirement: string; note?: string } {
  const stored = wholeSavingsCents(input.storedSavingsCents);
  const counted = input.visitStatus != null && visitStatusCountsAsVisit(input.visitStatus);
  if (counted && stored != null) {
    const requirement = input.offer.available
      ? `Offer ${formatCents(input.offer.discount_amount_cents)} off ${formatCents(input.offer.min_spend_cents)}+`
      : '';
    const amount = `Saved ${formatCents(stored)}`;
    return input.savingsCorrected
      ? { amount, requirement, note: SAVINGS_CORRECTION_NOTE }
      : { amount, requirement };
  }
  if (!input.offer.available) return { amount: 'Offer unavailable', requirement: '' };
  return {
    amount: `${formatCents(input.offer.discount_amount_cents)} off`,
    requirement: `when you spend ${formatCents(input.offer.min_spend_cents)}+`,
  };
}

/**
 * Partner dashboard title. A confirmed quote wins over the sealed line.
 * `needs_subtotal` does not fall through to sealed cents or to $0.
 */
export function partnerVerifiedOfferLine(input: {
  hideDiscountAmount: boolean;
  sealedDiscountCents: number | null;
  sealedMinSpendCents: number | null;
  confirmedTotalDiscountCents?: number | null;
  confirmedBaseDiscountCents?: number | null;
  confirmedBoostDiscountCents?: number | null;
  needsSubtotal?: boolean;
}): string {
  if (input.needsSubtotal) return 'Valid — bill needs confirm';
  const confirmed = redeemSavingsCopy(input);
  if (confirmed) return `Valid — ${confirmed}`;
  if (input.sealedDiscountCents != null && input.sealedMinSpendCents != null) {
    return `Valid — ${formatCents(input.sealedDiscountCents)} off ${formatCents(input.sealedMinSpendCents)}`;
  }
  if (input.hideDiscountAmount) return 'Valid';
  return 'Valid — $10 discount applied';
}
