import { describe, expect, it } from 'vitest';
import {
  applyExclusions,
  classifyFlatOffers,
  pairSavingsModel,
  quoteOffer,
  type OfferTier,
  type WeeklyBoost,
} from '@/lib/offers/calculator';

const tiers: OfferTier[] = [
  { thresholdCents: 4000, discountCents: 1000 },
  { thresholdCents: 8000, discountCents: 2000 },
];

const fridayNight: WeeklyBoost = {
  id: 'boost-b',
  kind: 'weekly',
  startIsodow: 5,
  startMinute: 22 * 60,
  endMinute: 2 * 60,
  bonusCents: 500,
};

const base = {
  tiers,
  boosts: [fridayNight],
  timeZone: 'America/Chicago',
  validFrom: new Date('2026-09-01T05:00:00.000Z'),
  validUntil: new Date('2026-10-01T05:00:00.000Z'),
  current: true,
  withdrawn: false,
  eligibleSubtotalCents: 4000,
  checkInAt: null as Date | null,
  redemptionDeadline: null as Date | null,
};

describe('offer calculator', () => {
  it('treats the spend threshold as inclusive and does not sum tiers', () => {
    const under = quoteOffer({
      ...base,
      mode: 'selection',
      at: new Date('2026-09-15T18:00:00.000Z'),
      eligibleSubtotalCents: 3999,
    });
    const exact = quoteOffer({
      ...base,
      mode: 'selection',
      at: new Date('2026-09-15T18:00:00.000Z'),
      eligibleSubtotalCents: 4000,
    });
    const over = quoteOffer({
      ...base,
      mode: 'selection',
      at: new Date('2026-09-15T18:00:00.000Z'),
      eligibleSubtotalCents: 4001,
    });
    expect(under.reason).toBe('below_minimum');
    expect(exact.tierCents).toBe(1000);
    expect(over.tierCents).toBe(1000);
    expect(over.discountCents).toBe(1000);
  });

  it('applies one Boost and caps the discount at the eligible subtotal', () => {
    const larger: WeeklyBoost = { ...fridayNight, id: 'boost-a', bonusCents: 800 };
    const quote = quoteOffer({
      ...base,
      mode: 'selection',
      boosts: [fridayNight, larger],
      at: new Date('2026-09-19T03:30:00.000Z'),
      checkInAt: new Date('2026-09-19T03:30:00.000Z'),
      eligibleSubtotalCents: 1500,
      tiers: [{ thresholdCents: 1000, discountCents: 1000 }],
    });
    expect(quote.boostCents).toBe(800);
    expect(quote.discountCents).toBe(1500);
  });

  it('keeps Friday 22:00 through Saturday 02:00 half-open', () => {
    const inside = quoteOffer({
      ...base,
      mode: 'selection',
      at: new Date('2026-09-19T05:30:00.000Z'),
      checkInAt: new Date('2026-09-19T05:30:00.000Z'),
    });
    const edge = quoteOffer({
      ...base,
      mode: 'selection',
      at: new Date('2026-09-19T07:00:00.000Z'),
      checkInAt: new Date('2026-09-19T07:00:00.000Z'),
    });
    expect(inside.boostCents).toBe(500);
    expect(edge.boostCents).toBe(0);
  });

  it('does not treat a spring-forward gap as inside a weekly window', () => {
    const gapWindow: WeeklyBoost = {
      id: 'gap',
      kind: 'weekly',
      startIsodow: 7,
      startMinute: 2 * 60 + 15,
      endMinute: 2 * 60 + 45,
      bonusCents: 300,
    };
    const before = quoteOffer({
      ...base,
      mode: 'selection',
      boosts: [gapWindow],
      validFrom: new Date('2026-03-01T06:00:00.000Z'),
      validUntil: new Date('2026-04-01T05:00:00.000Z'),
      at: new Date('2026-03-08T07:59:00.000Z'),
      checkInAt: new Date('2026-03-08T07:59:00.000Z'),
    });
    const after = quoteOffer({
      ...base,
      mode: 'selection',
      boosts: [gapWindow],
      validFrom: new Date('2026-03-01T06:00:00.000Z'),
      validUntil: new Date('2026-04-01T05:00:00.000Z'),
      at: new Date('2026-03-08T08:00:00.000Z'),
      checkInAt: new Date('2026-03-08T08:00:00.000Z'),
    });
    expect(before.boostCents).toBe(0);
    expect(after.boostCents).toBe(0);
  });

  it('drops the Boost after valid_until and zeroes the quote at the deadline', () => {
    const during = quoteOffer({
      ...base,
      mode: 'bound',
      at: new Date('2026-10-02T17:00:00.000Z'),
      checkInAt: new Date('2026-10-02T17:00:00.000Z'),
      redemptionDeadline: new Date('2026-10-15T05:00:00.000Z'),
    });
    const ended = quoteOffer({
      ...base,
      mode: 'bound',
      at: new Date('2026-10-15T05:00:00.000Z'),
      checkInAt: new Date('2026-09-19T03:30:00.000Z'),
      redemptionDeadline: new Date('2026-10-15T05:00:00.000Z'),
    });
    expect(during.tierCents).toBe(1000);
    expect(during.boostCents).toBe(0);
    expect(ended).toMatchObject({ discountCents: 0, applied: false, reason: 'past_deadline' });
  });

  it('labels the pair floor as model input', () => {
    const thin = pairSavingsModel(
      [{ thresholdCents: 4000, discountCents: 500 }],
      [{ thresholdCents: 4000, discountCents: 500 }],
    );
    const enough = pairSavingsModel(tiers, tiers);
    expect(thin.label).toBe('model input');
    expect(thin.ok).toBe(false);
    expect(enough.ok).toBe(true);
    expect(enough.qualifyingSpendCents).toBe(8000);
  });

  it('reports ambiguous flat offers and does not map them', () => {
    const report = classifyFlatOffers([
      {
        restaurantId: 'a',
        active: true,
        discountAmountCents: 1000,
        minSpendCents: 4000,
      },
      {
        restaurantId: 'b',
        active: true,
        discountAmountCents: null,
        minSpendCents: 4000,
      },
    ]);
    expect(report.mapped).toEqual([
      { restaurantId: 'a', thresholdCents: 4000, discountCents: 1000 },
    ]);
    expect(report.ambiguous).toEqual([{ restaurantId: 'b', reason: 'amounts' }]);
  });

  it('applies stored exclusions before a caller passes the subtotal', () => {
    expect(
      applyExclusions(
        {
          grossCents: 5000,
          taxCents: 400,
          tipCents: 800,
          categoryCents: [{ name: 'alcohol', cents: 600 }],
        },
        { excludeTax: true, excludeTip: true, categories: ['alcohol'] },
      ),
    ).toBe(3200);
  });
});
