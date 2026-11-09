import { describe, expect, it } from 'vitest';
import { ESTIMATED_SAVINGS_FALLBACK_CENTS } from '@/lib/progress/rules';
import { savingsCentsForVisits, storedCentsFromParsedSettlement } from '@/lib/progress/savings-cents';

describe('storedCentsFromParsedSettlement', () => {
  it('reads a consume_quote total and a stored sealed amount', () => {
    expect(
      storedCentsFromParsedSettlement({
        snapshot: { total_discount_cents: 1850, discount_amount_cents: 1000 },
      }),
    ).toBe(1850);
    expect(storedCentsFromParsedSettlement({ snapshot: { discount_amount_cents: 1200 } })).toBe(1200);
    expect(storedCentsFromParsedSettlement({ snapshot: { discount_amount_cents: 0 } })).toBe(0);
  });

  it('returns null for a miss, an empty row, or cents that are not a stored amount', () => {
    expect(storedCentsFromParsedSettlement(null)).toBeNull();
    expect(storedCentsFromParsedSettlement({ snapshot: null })).toBeNull();
    expect(storedCentsFromParsedSettlement({ snapshot: { total_discount_cents: -1 } })).toBeNull();
    expect(storedCentsFromParsedSettlement({ snapshot: { discount_amount_cents: 10.5 } })).toBeNull();
    expect(storedCentsFromParsedSettlement({ snapshot: {} })).toBeNull();
  });
});

describe('savingsCentsForVisits', () => {
  const off = { useStoredSettlements: false };
  const on = { useStoredSettlements: true };

  it('keeps today\'s sealed tier and the 1000-cent fallback when stored cents are off', () => {
    expect(
      savingsCentsForVisits(
        [
          { sealedCents: 1500, storedCents: 1850 },
          { sealedCents: null, storedCents: 1200 },
        ],
        off,
      ),
    ).toEqual({
      cents: 1500 + ESTIMATED_SAVINGS_FALLBACK_CENTS,
      amount: 25,
      isEstimate: true,
    });
    expect(savingsCentsForVisits([], off)).toEqual({ cents: 0, amount: 0, isEstimate: true });
  });

  it('counts a stored consume_quote total instead of the sealed tier', () => {
    expect(savingsCentsForVisits([{ sealedCents: 1500, storedCents: 1850 }], on)).toEqual({
      cents: 1850,
      amount: 18.5,
      isEstimate: false,
    });
  });

  it('counts a stored sealed amount', () => {
    expect(savingsCentsForVisits([{ sealedCents: 1500, storedCents: 1200 }], on)).toEqual({
      cents: 1200,
      amount: 12,
      isEstimate: false,
    });
  });

  it('treats a stored zero as a real amount', () => {
    expect(savingsCentsForVisits([{ sealedCents: 1500, storedCents: 0 }], on)).toEqual({
      cents: 0,
      amount: 0,
      isEstimate: false,
    });
  });

  it('uses the sealed tier, then 1000 cents, when a visit has no stored amount', () => {
    expect(savingsCentsForVisits([{ sealedCents: 1500, storedCents: null }], on)).toEqual({
      cents: 1500,
      amount: 15,
      isEstimate: true,
    });
    expect(savingsCentsForVisits([{ sealedCents: undefined, storedCents: null }], on)).toEqual({
      cents: ESTIMATED_SAVINGS_FALLBACK_CENTS,
      amount: 10,
      isEstimate: true,
    });
    expect(savingsCentsForVisits([{ sealedCents: 1500, storedCents: -5 }], on)).toEqual({
      cents: 1500,
      amount: 15,
      isEstimate: true,
    });
  });

  it('keeps the total estimated when any visit used read-time math or the fallback', () => {
    expect(
      savingsCentsForVisits(
        [
          { sealedCents: 1500, storedCents: 1850 },
          { sealedCents: 1200, storedCents: null },
        ],
        on,
      ),
    ).toEqual({ cents: 3050, amount: 30.5, isEstimate: true });
    expect(
      savingsCentsForVisits(
        [
          { sealedCents: 1500, storedCents: 1850 },
          { sealedCents: null, storedCents: null },
        ],
        on,
      ),
    ).toEqual({ cents: 2850, amount: 28.5, isEstimate: true });
  });

  it('uses a corrected amount instead of the sealed tier or the stored snapshot', () => {
    expect(
      savingsCentsForVisits([{ sealedCents: 1500, storedCents: 1850, correctedCents: 2500 }], off),
    ).toEqual({ cents: 2500, amount: 25, isEstimate: false });
    expect(
      savingsCentsForVisits([{ sealedCents: 1500, storedCents: 1850, correctedCents: 900 }], on),
    ).toEqual({ cents: 900, amount: 9, isEstimate: false });
    expect(savingsCentsForVisits([{ sealedCents: 1500, correctedCents: 0 }], off)).toEqual({
      cents: 0,
      amount: 0,
      isEstimate: false,
    });
  });

  it('keeps the total estimated when a corrected visit sits next to a read-time visit', () => {
    expect(
      savingsCentsForVisits(
        [
          { sealedCents: 1500, correctedCents: 2500 },
          { sealedCents: 1200, storedCents: null },
        ],
        off,
      ),
    ).toEqual({ cents: 3700, amount: 37, isEstimate: true });
    expect(
      savingsCentsForVisits(
        [
          { sealedCents: 1500, storedCents: 1850, correctedCents: 2500 },
          { sealedCents: 1200, storedCents: 1200 },
        ],
        on,
      ),
    ).toEqual({ cents: 3700, amount: 37, isEstimate: false });
  });

  it('drops the estimate only when every visit has stored cents', () => {
    expect(
      savingsCentsForVisits(
        [
          { sealedCents: 1500, storedCents: 1850 },
          { sealedCents: null, storedCents: 1200 },
        ],
        on,
      ),
    ).toEqual({ cents: 3050, amount: 30.5, isEstimate: false });
    expect(savingsCentsForVisits([], on)).toEqual({ cents: 0, amount: 0, isEstimate: true });
  });
});
