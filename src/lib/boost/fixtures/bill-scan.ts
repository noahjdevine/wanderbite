import type { BillProposalInput } from '@/lib/boost/bill-proposal';
import type { ExclusionPolicy } from '@/lib/offers/calculator';

/** Tax and tip come off the eligible subtotal. No category exclusions. */
export const taxAndTipPolicy: ExclusionPolicy = {
  excludeTax: true,
  excludeTip: true,
  categories: [],
};

/**
 * Synthetic bill. Stripping tax and tip leaves 8200 cents, the eligible
 * subtotal in the E07-A1 quote example ($20 base + $5 Boost). The gross,
 * tax, and tip figures are not from a receipt.
 */
export const masterPlanEightyTwo: BillProposalInput = {
  bill: {
    grossCents: 10000,
    taxCents: 800,
    tipCents: 1000,
    categoryCents: [],
  },
  policy: taxAndTipPolicy,
  meta: {
    source: 'fixture',
    confidence: 1,
    checkIdentity: 'fixture-check-82',
    lineItems: [{ label: 'Food', cents: 8200, category: 'food' }],
  },
};

/**
 * Eligible 3800 cents after tax and tip. That is under the 4000-cent tier
 * in the quote tests. This fixture does not name a tier.
 */
export const belowMinimumBill: BillProposalInput = {
  bill: {
    grossCents: 5000,
    taxCents: 700,
    tipCents: 500,
    categoryCents: [],
  },
  policy: taxAndTipPolicy,
  meta: {
    source: 'fixture',
    confidence: 1,
    checkIdentity: 'fixture-check-below',
  },
};

/** Alcohol, tax, and tip come off. Eligible cents are 6000. */
export const categoryExcludedBill: BillProposalInput = {
  bill: {
    grossCents: 9000,
    taxCents: 600,
    tipCents: 900,
    categoryCents: [{ name: 'alcohol', cents: 1500 }],
  },
  policy: {
    excludeTax: true,
    excludeTip: true,
    categories: ['alcohol'],
  },
  meta: {
    source: 'fixture',
    confidence: 1,
    checkIdentity: 'fixture-check-alcohol',
    lineItems: [
      { label: 'Entree', cents: 6000, category: 'food' },
      { label: 'Wine', cents: 1500, category: 'alcohol' },
    ],
  },
};

/**
 * OCR stub with no gross. Line cents must not be summed into a subtotal.
 * No image bytes.
 */
export const uncertainOcrStub: BillProposalInput = {
  bill: {
    grossCents: null,
    taxCents: null,
    tipCents: null,
    categoryCents: [],
  },
  policy: taxAndTipPolicy,
  meta: {
    source: 'ocr_stub',
    confidence: 0.42,
    ambiguousLineItems: true,
    cardDataStripped: true,
    checkIdentity: 'fixture-check-uncertain',
    lineItems: [{ label: 'Unreadable item', cents: null, confidence: 0.2 }],
  },
};
