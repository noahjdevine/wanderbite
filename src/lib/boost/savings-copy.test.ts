import { describe, expect, it } from 'vitest';
import {
  challengeTicketOffer,
  challengeVisitSavings,
  partnerVerifiedOfferLine,
  qrLabelForView,
  redeemSavingsCopy,
  verifyBoostFields,
  type BoostSavingsView,
} from '@/lib/boost/savings-copy';
import { SAVINGS_CORRECTION_NOTE } from '@/lib/progress/savings-cents';

const quote: BoostSavingsView = {
  kind: 'quote',
  savings: { totalDiscountCents: 2500, baseDiscountCents: 2000, boostDiscountCents: 500 },
};

const offer = { available: true as const, discount_amount_cents: 1000, min_spend_cents: 4000 };

describe('challenge ticket offer', () => {
  it('shows a stored settlement on a verified visit and keeps the offer beside it', () => {
    expect(
      challengeTicketOffer({ offer, visitStatus: 'verified', storedSavingsCents: 1500 }),
    ).toEqual({ amount: 'Saved $15', requirement: 'Offer $10 off $40+' });
    expect(
      challengeTicketOffer({ offer, visitStatus: 'note_added', storedSavingsCents: 0 }),
    ).toEqual({ amount: 'Saved $0', requirement: 'Offer $10 off $40+' });
  });

  it('keeps the offer when there is no stored settlement or the visit is not verified', () => {
    expect(challengeTicketOffer({ offer, visitStatus: 'verified', storedSavingsCents: null })).toEqual({
      amount: '$10 off',
      requirement: 'when you spend $40+',
    });
    expect(challengeTicketOffer({ offer, visitStatus: 'verified' })).toEqual({
      amount: '$10 off',
      requirement: 'when you spend $40+',
    });
    expect(
      challengeTicketOffer({ offer, visitStatus: 'ready', storedSavingsCents: 1500 }),
    ).toEqual({ amount: '$10 off', requirement: 'when you spend $40+' });
    expect(
      challengeTicketOffer({ offer, visitStatus: 'code_issued', storedSavingsCents: 1500 }),
    ).toEqual({ amount: '$10 off', requirement: 'when you spend $40+' });
    expect(
      challengeTicketOffer({ offer, visitStatus: 'verified', storedSavingsCents: 10.5 }),
    ).toEqual({ amount: '$10 off', requirement: 'when you spend $40+' });
    expect(
      challengeTicketOffer({
        offer: { available: false },
        visitStatus: 'verified',
        storedSavingsCents: 1500,
      }),
    ).toEqual({ amount: 'Saved $15', requirement: '' });
  });

  it('shows a corrected amount with the Progress note and leaves an uncorrected visit alone', () => {
    expect(
      challengeTicketOffer({
        offer,
        visitStatus: 'verified',
        storedSavingsCents: 1500,
        savingsCorrected: true,
      }),
    ).toEqual({
      amount: 'Saved $15',
      requirement: 'Offer $10 off $40+',
      note: SAVINGS_CORRECTION_NOTE,
    });
    expect(SAVINGS_CORRECTION_NOTE).toBe('Corrected after review');
    expect(
      challengeTicketOffer({ offer, visitStatus: 'verified', storedSavingsCents: 1000 }),
    ).toEqual({ amount: 'Saved $10', requirement: 'Offer $10 off $40+' });
    expect(
      challengeTicketOffer({
        offer,
        visitStatus: 'note_added',
        storedSavingsCents: 1500,
        savingsCorrected: true,
      }).note,
    ).toBe(SAVINGS_CORRECTION_NOTE);
    expect(
      challengeTicketOffer({
        offer,
        visitStatus: 'ready',
        storedSavingsCents: 1500,
        savingsCorrected: true,
      }),
    ).toEqual({ amount: '$10 off', requirement: 'when you spend $40+' });
  });
});

describe('challenge visit savings', () => {
  it('uses corrected cents and does not invent the 1000-cent fallback', () => {
    expect(challengeVisitSavings({ storedCents: 1000, correctedCents: 1500 })).toEqual({
      cents: 1500,
      corrected: true,
    });
    expect(challengeVisitSavings({ storedCents: 1000, correctedCents: null })).toEqual({
      cents: 1000,
      corrected: false,
    });
    expect(challengeVisitSavings({ storedCents: null, correctedCents: undefined })).toEqual({
      cents: null,
      corrected: false,
    });
    expect(challengeVisitSavings({ correctedCents: 0 })).toEqual({ cents: 0, corrected: true });
    expect(challengeVisitSavings({ storedCents: 10.5, correctedCents: -1 })).toEqual({
      cents: null,
      corrected: false,
    });
  });
});

describe('boost savings copy', () => {
  it('shows a consume_quote total and its parts', () => {
    expect(qrLabelForView(quote)).toBe('$25 off');
    expect(redeemSavingsCopy(verifyBoostFields(true, quote))).toBe('$25 off ($20 base + $5 Boost)');
    expect(partnerVerifiedOfferLine({
      ...verifyBoostFields(true, quote),
      sealedDiscountCents: 1500,
      sealedMinSpendCents: 4000,
    })).toBe('Valid — $25 off ($20 base + $5 Boost)');
    expect(verifyBoostFields(true, quote).hideDiscountAmount).toBe(false);
  });

  it('does not invent $0 for a bill that still needs confirm', () => {
    const fields = verifyBoostFields(true, { kind: 'needs_subtotal' });
    expect(fields.confirmedTotalDiscountCents).toBeNull();
    expect(fields.needsSubtotal).toBe(true);
    expect(fields.hideDiscountAmount).toBe(true);
    expect(qrLabelForView({ kind: 'needs_subtotal' })).toBeNull();
    expect(redeemSavingsCopy(fields)).toBe('Bill needs confirm');
    expect(redeemSavingsCopy(fields)).not.toContain('$0');
    expect(partnerVerifiedOfferLine({
      ...fields,
      sealedDiscountCents: 1500,
      sealedMinSpendCents: 4000,
    })).toBe('Valid — bill needs confirm');
  });

  it('keeps today\'s sealed and legacy lines when nothing was confirmed', () => {
    const hidden = verifyBoostFields(true, { kind: 'hidden' });
    expect(qrLabelForView({ kind: 'hidden' })).toBeNull();
    expect(redeemSavingsCopy(hidden)).toBeNull();
    expect(partnerVerifiedOfferLine({
      hideDiscountAmount: true,
      sealedDiscountCents: 1500,
      sealedMinSpendCents: 4000,
    })).toBe('Valid — $15 off $40');
    expect(partnerVerifiedOfferLine({
      hideDiscountAmount: false,
      sealedDiscountCents: null,
      sealedMinSpendCents: null,
    })).toBe('Valid — $10 discount applied');
    expect(partnerVerifiedOfferLine({
      hideDiscountAmount: true,
      sealedDiscountCents: null,
      sealedMinSpendCents: null,
    })).toBe('Valid');
  });
});
