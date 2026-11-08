import { describe, expect, it } from 'vitest';
import {
  partnerVerifiedOfferLine,
  qrLabelForView,
  redeemSavingsCopy,
  verifyBoostFields,
  type BoostSavingsView,
} from '@/lib/boost/savings-copy';

const quote: BoostSavingsView = {
  kind: 'quote',
  savings: { totalDiscountCents: 2500, baseDiscountCents: 2000, boostDiscountCents: 500 },
};

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
