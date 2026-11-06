import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { quoteOffer, type OfferTier, type WeeklyBoost } from '@/lib/offers/calculator';
import {
  quoteBoost,
  supersedeBoostQuote,
  type SealedBoostOfferVersion,
} from '@/lib/boost/quote';

const ROOT = path.resolve(__dirname, '../../..');

const fridayNight: WeeklyBoost = {
  id: 'boost-5',
  kind: 'weekly',
  startIsodow: 5,
  startMinute: 22 * 60,
  endMinute: 2 * 60,
  bonusCents: 500,
};

const tiers: OfferTier[] = [
  { thresholdCents: 4000, discountCents: 1000 },
  { thresholdCents: 8000, discountCents: 2000 },
];

function version(overrides: Partial<SealedBoostOfferVersion> = {}): SealedBoostOfferVersion {
  return {
    id: 'version-1',
    timezone: 'America/Chicago',
    validFrom: new Date('2026-09-01T05:00:00.000Z'),
    validUntil: new Date('2026-12-01T06:00:00.000Z'),
    withdrawn: false,
    tiers,
    boosts: [fridayNight],
    ...overrides,
  };
}

const outsideBoost = new Date('2026-09-15T18:00:00.000Z');
const fridayArrival = new Date('2026-09-19T03:30:00.000Z');
const afterWindow = new Date('2026-09-19T08:00:00.000Z');

function quoteOk(
  input: Parameters<typeof quoteBoost>[0],
): Extract<ReturnType<typeof quoteBoost>, { ok: true }>['quote'] {
  const result = quoteBoost(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.quote;
}

describe('boost quote', () => {
  it('prices the master-plan example at $20 plus a $5 Boost on an $82 subtotal', () => {
    const offer = version({
      tiers: [{ thresholdCents: 8000, discountCents: 2000 }],
    });
    const quote = quoteOk({
      offerVersion: offer,
      eligibleSubtotalCents: 8200,
      arrivalAt: fridayArrival,
    });
    const viaCalculator = quoteOffer({
      mode: 'bound',
      tiers: offer.tiers,
      boosts: offer.boosts,
      timeZone: offer.timezone,
      validFrom: offer.validFrom,
      validUntil: offer.validUntil,
      current: true,
      withdrawn: false,
      eligibleSubtotalCents: 8200,
      at: fridayArrival,
      checkInAt: fridayArrival,
      redemptionDeadline: null,
    });
    expect(quote.total_discount_cents).toBe(2500);
    expect(quote.base_discount_cents).toBe(2000);
    expect(quote.boost_discount_cents).toBe(500);
    expect(quote.boost_id).toBe('boost-5');
    expect(quote.tier_id).toBe('threshold:8000');
    expect(quote.total_discount_cents).toBe(viaCalculator.discountCents);
    expect(quote.below_minimum).toBe(false);
    expect(quote.reasons).toEqual(['quoted', 'boost_applied']);
  });

  it('drops every Boost when arrival is outside the windows and keeps the base tier', () => {
    const quote = quoteOk({
      offerVersion: version(),
      eligibleSubtotalCents: 8200,
      arrivalAt: outsideBoost,
    });
    expect(quote.boost_id).toBeNull();
    expect(quote.boost_discount_cents).toBe(0);
    expect(quote.base_discount_cents).toBe(2000);
    expect(quote.total_discount_cents).toBe(2000);
    expect(quote.reasons).toEqual(['quoted']);
  });

  it('keeps a locked Boost when the bill is confirmed after the window closes', () => {
    const large: WeeklyBoost = { ...fridayNight, id: 'boost-large', bonusCents: 800 };
    const offer = version({ boosts: [fridayNight, large] });
    const unlocked = quoteOk({
      offerVersion: offer,
      eligibleSubtotalCents: 8200,
      arrivalAt: fridayArrival,
      confirmedAt: afterWindow,
    });
    const locked = quoteOk({
      offerVersion: offer,
      eligibleSubtotalCents: 8200,
      arrivalAt: fridayArrival,
      confirmedAt: afterWindow,
      lockedBoostId: 'boost-5',
    });
    expect(unlocked.boost_id).toBe('boost-large');
    expect(unlocked.boost_discount_cents).toBe(800);
    expect(locked.boost_id).toBe('boost-5');
    expect(locked.boost_discount_cents).toBe(500);
    expect(locked.total_discount_cents).toBe(2500);
    expect(locked.reasons).toContain('boost_locked');
    expect(locked.arrival_at).toBe(fridayArrival.toISOString());
  });

  it('picks one tier at each threshold and does not sum tiers', () => {
    const offer = version();
    const cases = [
      { cents: 3999, tier: null, base: 0, below: true },
      { cents: 4000, tier: 'threshold:4000', base: 1000, below: false },
      { cents: 4001, tier: 'threshold:4000', base: 1000, below: false },
      { cents: 7999, tier: 'threshold:4000', base: 1000, below: false },
      { cents: 8000, tier: 'threshold:8000', base: 2000, below: false },
      { cents: 8001, tier: 'threshold:8000', base: 2000, below: false },
    ];
    for (const row of cases) {
      const quote = quoteOk({
        offerVersion: offer,
        eligibleSubtotalCents: row.cents,
        arrivalAt: outsideBoost,
      });
      expect(quote.tier_id, String(row.cents)).toBe(row.tier);
      expect(quote.base_discount_cents, String(row.cents)).toBe(row.base);
      expect(quote.total_discount_cents, String(row.cents)).toBe(row.base);
      expect(quote.below_minimum, String(row.cents)).toBe(row.below);
      expect(quote.boost_id, String(row.cents)).toBeNull();
    }
  });

  it('returns no discount below the lowest tier minimum', () => {
    const quote = quoteOk({
      offerVersion: version(),
      eligibleSubtotalCents: 3999,
      arrivalAt: fridayArrival,
    });
    expect(quote.total_discount_cents).toBe(0);
    expect(quote.base_discount_cents).toBe(0);
    expect(quote.boost_discount_cents).toBe(0);
    expect(quote.below_minimum).toBe(true);
    expect(quote.tier_id).toBeNull();
    expect(quote.boost_id).toBeNull();
    expect(quote.reasons).toEqual(['below_minimum']);
  });

  it('caps the total at the eligible subtotal and never goes negative', () => {
    const offer = version({
      tiers: [{ thresholdCents: 1000, discountCents: 1000 }],
      boosts: [{ ...fridayNight, bonusCents: 800 }],
    });
    const quote = quoteOk({
      offerVersion: offer,
      eligibleSubtotalCents: 1500,
      arrivalAt: fridayArrival,
    });
    expect(quote.base_discount_cents).toBe(1000);
    expect(quote.boost_discount_cents).toBe(500);
    expect(quote.boost_id).toBe('boost-5');
    expect(quote.total_discount_cents).toBe(1500);
    expect(quote.base_discount_cents + quote.boost_discount_cents).toBe(quote.total_discount_cents);
    expect(quote.total_discount_cents).toBeLessThanOrEqual(quote.eligible_subtotal_cents);
    expect(quote.total_discount_cents).toBeGreaterThanOrEqual(0);
    expect(quote.reasons).toEqual(['quoted', 'capped', 'boost_applied']);
  });

  it('reduces the base only after the Boost is zero when the base alone exceeds the subtotal', () => {
    const quote = quoteOk({
      offerVersion: version({
        tiers: [{ thresholdCents: 1000, discountCents: 2000 }],
        boosts: [{ ...fridayNight, bonusCents: 500 }],
      }),
      eligibleSubtotalCents: 1500,
      arrivalAt: fridayArrival,
    });
    expect(quote.boost_discount_cents).toBe(0);
    expect(quote.boost_id).toBeNull();
    expect(quote.base_discount_cents).toBe(1500);
    expect(quote.total_discount_cents).toBe(1500);
    expect(quote.base_discount_cents + quote.boost_discount_cents).toBe(quote.total_discount_cents);
    expect(quote.reasons).toEqual(['quoted', 'capped']);
  });

  it('refuses an unbound item instead of a fallback amount', () => {
    const result = quoteBoost({
      offerVersion: null,
      eligibleSubtotalCents: 8200,
      arrivalAt: fridayArrival,
    });
    expect(result).toEqual({ ok: false, code: 'unbound' });
    expect(JSON.stringify(result)).not.toMatch(/1000|4000/);
  });

  it('refuses a withdrawn version and an arrival outside published validity', () => {
    const offer = version();
    expect(
      quoteBoost({
        offerVersion: version({ withdrawn: true }),
        eligibleSubtotalCents: 8200,
        arrivalAt: fridayArrival,
      }),
    ).toEqual({ ok: false, code: 'withdrawn' });
    expect(
      quoteBoost({
        offerVersion: offer,
        eligibleSubtotalCents: 8200,
        arrivalAt: offer.validUntil,
      }),
    ).toEqual({ ok: false, code: 'outside_validity' });
    expect(
      quoteBoost({
        offerVersion: offer,
        eligibleSubtotalCents: 8200,
        arrivalAt: new Date(offer.validFrom.getTime() - 1),
      }),
    ).toEqual({ ok: false, code: 'outside_validity' });
    expect(
      quoteBoost({
        offerVersion: offer,
        eligibleSubtotalCents: 82.5,
        arrivalAt: fridayArrival,
      }),
    ).toEqual({ ok: false, code: 'invalid_subtotal' });
    expect(
      quoteBoost({
        offerVersion: offer,
        eligibleSubtotalCents: -1,
        arrivalAt: fridayArrival,
      }),
    ).toEqual({ ok: false, code: 'invalid_subtotal' });
  });

  it('refuses a locked Boost that does not contain the arrival', () => {
    expect(
      quoteBoost({
        offerVersion: version(),
        eligibleSubtotalCents: 8200,
        arrivalAt: outsideBoost,
        lockedBoostId: 'boost-5',
      }),
    ).toEqual({ ok: false, code: 'boost_not_at_arrival' });
    expect(
      quoteBoost({
        offerVersion: version(),
        eligibleSubtotalCents: 8200,
        arrivalAt: fridayArrival,
        lockedBoostId: 'missing',
      }),
    ).toEqual({ ok: false, code: 'unknown_boost' });
  });

  it('keeps Friday 22:00 through Saturday 02:00 half-open across midnight', () => {
    const offer = version();
    const insideEvening = quoteOk({
      offerVersion: offer,
      eligibleSubtotalCents: 8200,
      arrivalAt: new Date('2026-09-19T03:30:00.000Z'),
    });
    const insideMorning = quoteOk({
      offerVersion: offer,
      eligibleSubtotalCents: 8200,
      arrivalAt: new Date('2026-09-19T05:30:00.000Z'),
    });
    const edge = quoteOk({
      offerVersion: offer,
      eligibleSubtotalCents: 8200,
      arrivalAt: new Date('2026-09-19T07:00:00.000Z'),
    });
    expect(insideEvening.boost_discount_cents).toBe(500);
    expect(insideMorning.boost_discount_cents).toBe(500);
    expect(edge.boost_id).toBeNull();
    expect(edge.total_discount_cents).toBe(2000);
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
    const spanning: WeeklyBoost = {
      id: 'span',
      kind: 'weekly',
      startIsodow: 7,
      startMinute: 60,
      endMinute: 3 * 60 + 30,
      bonusCents: 300,
    };
    const offer = version({
      validFrom: new Date('2026-03-01T06:00:00.000Z'),
      validUntil: new Date('2026-04-01T05:00:00.000Z'),
      boosts: [gapWindow],
    });
    const before = quoteOk({
      offerVersion: offer,
      eligibleSubtotalCents: 8200,
      arrivalAt: new Date('2026-03-08T07:59:00.000Z'),
    });
    const after = quoteOk({
      offerVersion: offer,
      eligibleSubtotalCents: 8200,
      arrivalAt: new Date('2026-03-08T08:00:00.000Z'),
    });
    expect(before.boost_id).toBeNull();
    expect(after.boost_id).toBeNull();

    const open = version({
      validFrom: offer.validFrom,
      validUntil: offer.validUntil,
      boosts: [spanning],
    });
    expect(
      quoteOk({
        offerVersion: open,
        eligibleSubtotalCents: 8200,
        arrivalAt: new Date('2026-03-08T07:30:00.000Z'),
      }).boost_id,
    ).toBe('span');
    expect(
      quoteOk({
        offerVersion: open,
        eligibleSubtotalCents: 8200,
        arrivalAt: new Date('2026-03-08T08:00:00.000Z'),
      }).boost_id,
    ).toBe('span');
    expect(
      quoteOk({
        offerVersion: open,
        eligibleSubtotalCents: 8200,
        arrivalAt: new Date('2026-03-08T08:30:00.000Z'),
      }).boost_id,
    ).toBeNull();
  });

  it('matches both fall-back clock faces and excludes the time after the repeated hour', () => {
    const repeated: WeeklyBoost = {
      id: 'fallback',
      kind: 'weekly',
      startIsodow: 7,
      startMinute: 60,
      endMinute: 120,
      bonusCents: 300,
    };
    const offer = version({ boosts: [repeated] });
    const first = quoteOk({
      offerVersion: offer,
      eligibleSubtotalCents: 8200,
      arrivalAt: new Date('2026-11-01T06:30:00.000Z'),
    });
    const second = quoteOk({
      offerVersion: offer,
      eligibleSubtotalCents: 8200,
      arrivalAt: new Date('2026-11-01T07:30:00.000Z'),
    });
    const after = quoteOk({
      offerVersion: offer,
      eligibleSubtotalCents: 8200,
      arrivalAt: new Date('2026-11-01T08:30:00.000Z'),
    });
    expect(first.boost_id).toBe('fallback');
    expect(second.boost_id).toBe('fallback');
    expect(after.boost_id).toBeNull();
  });

  it('does not move expiry later when the subtotal is corrected', () => {
    const offer = version();
    const original = quoteOk({
      offerVersion: offer,
      eligibleSubtotalCents: 8200,
      arrivalAt: fridayArrival,
      lockedBoostId: 'boost-5',
    });
    const laterOffer = version({
      validUntil: new Date('2030-01-01T06:00:00.000Z'),
    });
    const correctedAt = new Date('2026-09-20T18:00:00.000Z');
    const result = supersedeBoostQuote(original, {
      offerVersion: laterOffer,
      eligibleSubtotalCents: 7999,
      supersededAt: correctedAt,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(original.status).toBe('active');
    expect(original.superseded_at).toBeNull();
    expect(result.previous.status).toBe('superseded');
    expect(result.previous.superseded_at).toBe(correctedAt.toISOString());
    expect(result.previous.total_discount_cents).toBe(2500);
    expect(result.next.quote_version).toBe(2);
    expect(result.next.total_discount_cents).toBe(1500);
    expect(result.next.base_discount_cents).toBe(1000);
    expect(result.next.boost_id).toBe('boost-5');
    expect(result.next.expires_at).toBe(original.expires_at);
    expect(result.next.expires_at).toBe(offer.validUntil.toISOString());
    expect(new Date(result.next.expires_at).getTime()).toBeLessThan(laterOffer.validUntil.getTime());
    expect(result.next.arrival_at).toBe(original.arrival_at);
    expect(result.next.status).toBe('active');
    expect(
      supersedeBoostQuote(result.previous, {
        offerVersion: offer,
        eligibleSubtotalCents: 8200,
        supersededAt: correctedAt,
      }),
    ).toEqual({ ok: false, code: 'already_superseded' });
  });

  it('refuses a correction after the visit deadline and leaves the prior expiry in place', () => {
    const offer = version();
    const deadline = new Date('2026-09-19T12:00:00.000Z');
    const original = quoteOk({
      offerVersion: offer,
      eligibleSubtotalCents: 8200,
      arrivalAt: fridayArrival,
      redemptionDeadline: deadline,
    });
    const result = supersedeBoostQuote(original, {
      offerVersion: offer,
      eligibleSubtotalCents: 9000,
      supersededAt: deadline,
      redemptionDeadline: deadline,
    });
    expect(result).toEqual({ ok: false, code: 'past_deadline' });
    expect(original.expires_at).toBe(deadline.toISOString());
    expect(original.status).toBe('active');
  });

  it('clamps a requested expiry so it is not later than the offer', () => {
    const offer = version();
    const sooner = new Date(fridayArrival.getTime() + 60 * 60 * 1000);
    const bounded = quoteOk({
      offerVersion: offer,
      eligibleSubtotalCents: 8200,
      arrivalAt: fridayArrival,
      expiresAt: sooner,
    });
    const tooLate = quoteOk({
      offerVersion: offer,
      eligibleSubtotalCents: 8200,
      arrivalAt: fridayArrival,
      expiresAt: new Date('2031-01-01T00:00:00.000Z'),
    });
    expect(bounded.expires_at).toBe(sooner.toISOString());
    expect(tooLate.expires_at).toBe(offer.validUntil.toISOString());
  });

  it('stays a pure module with no app, database, or server entry', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/boost/quote.ts'), 'utf8');
    expect(source).not.toMatch(/supabase|from 'next|use server/);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || full.includes(`${path.sep}boost${path.sep}`)) continue;
        const text = readFileSync(full, 'utf8');
        if (text.includes("@/lib/boost/quote") || text.includes('lib/boost/quote')) hits.push(full);
      }
    };
    walk(path.join(ROOT, 'src/app'));
    expect(hits).toEqual([]);
  });
});
