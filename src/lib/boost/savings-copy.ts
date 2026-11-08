import { formatCents } from '@/lib/offers/sealed-base';
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

type ChallengeOffer =
  | { available: false }
  | { available: true; discount_amount_cents: number; min_spend_cents: number };

function wholeSavingsCents(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * Challenges ticket offer line.
 * A verified visit with a stored whole-cent settlement shows that saved amount.
 * The sealed offer stays a separate "Offer" line. Anything else keeps today's offer.
 * This does not recompute a quote and does not invent the 1000-cent fallback.
 */
export function challengeTicketOffer(input: {
  offer: ChallengeOffer;
  visitStatus?: VisitStatus | null;
  storedSavingsCents?: number | null;
}): { amount: string; requirement: string } {
  const stored = wholeSavingsCents(input.storedSavingsCents);
  const counted = input.visitStatus != null && visitStatusCountsAsVisit(input.visitStatus);
  if (counted && stored != null) {
    const requirement = input.offer.available
      ? `Offer ${formatCents(input.offer.discount_amount_cents)} off ${formatCents(input.offer.min_spend_cents)}+`
      : '';
    return { amount: `Saved ${formatCents(stored)}`, requirement };
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
