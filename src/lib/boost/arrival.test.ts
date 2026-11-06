import { addMinutes } from 'date-fns';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOOST_SESSION_MINUTES,
  arrivalSessionExpiresAt,
  qualifyingArrivalBoostId,
  sealBoostOfferVersion,
} from '@/lib/boost/arrival';
import { quoteBoost, type BoostQuote, type SealedBoostOfferVersion } from '@/lib/boost/quote';
import type { WeeklyBoost } from '@/lib/offers/calculator';

const arrival = new Date('2026-09-19T03:30:00.000Z');
const validUntil = new Date('2026-12-01T06:00:00.000Z');

const friday: WeeklyBoost = {
  id: 'boost-5',
  kind: 'weekly',
  startIsodow: 5,
  startMinute: 22 * 60,
  endMinute: 2 * 60,
  bonusCents: 500,
};

function version(): SealedBoostOfferVersion {
  return {
    id: 'version-1',
    timezone: 'America/Chicago',
    validFrom: new Date('2026-09-01T05:00:00.000Z'),
    validUntil,
    withdrawn: false,
    tiers: [{ thresholdCents: 1000, discountCents: 2000 }],
    boosts: [friday],
  };
}

describe('arrival session expiry', () => {
  it('uses 240 minutes when boost_session_minutes is null', () => {
    const expires = arrivalSessionExpiresAt({
      arrivalAt: arrival,
      validUntil,
      redemptionDeadline: null,
      boostSessionMinutes: null,
    });
    expect(expires?.toISOString()).toBe(addMinutes(arrival, DEFAULT_BOOST_SESSION_MINUTES).toISOString());
    expect(DEFAULT_BOOST_SESSION_MINUTES).toBe(240);
  });

  it('uses a stored duration, then the earliest of validity and the visit deadline', () => {
    const stored = arrivalSessionExpiresAt({
      arrivalAt: arrival,
      validUntil,
      redemptionDeadline: new Date('2026-09-20T00:00:00.000Z'),
      boostSessionMinutes: 30,
    });
    expect(stored?.toISOString()).toBe(addMinutes(arrival, 30).toISOString());

    const deadline = new Date('2026-09-19T04:00:00.000Z');
    const byDeadline = arrivalSessionExpiresAt({
      arrivalAt: arrival,
      validUntil,
      redemptionDeadline: deadline,
      boostSessionMinutes: null,
    });
    expect(byDeadline?.toISOString()).toBe(deadline.toISOString());

    const until = new Date('2026-09-19T04:10:00.000Z');
    const byOffer = arrivalSessionExpiresAt({
      arrivalAt: arrival,
      validUntil: until,
      redemptionDeadline: null,
      boostSessionMinutes: null,
    });
    expect(byOffer?.toISOString()).toBe(until.toISOString());
  });

  it('rejects a non-positive stored duration', () => {
    expect(
      arrivalSessionExpiresAt({
        arrivalAt: arrival,
        validUntil,
        redemptionDeadline: null,
        boostSessionMinutes: 0,
      }),
    ).toBeNull();
  });
});

describe('sealed terms and the arrival lock', () => {
  it('reads snake_case offer terms and refuses a malformed boost', () => {
    const sealed = sealBoostOfferVersion({
      id: 'version-1',
      timezone: 'America/Chicago',
      validFrom: '2026-09-01T05:00:00.000Z',
      validUntil: validUntil.toISOString(),
      withdrawnFromSelectionAt: null,
      tiers: [{ threshold_cents: 4000, discount_cents: 1000 }],
      boosts: [
        {
          id: 'boost-5',
          kind: 'weekly',
          start_isodow: 5,
          start_minute: 22 * 60,
          end_minute: 2 * 60,
          bonus_cents: 500,
        },
      ],
      boostSessionMinutes: null,
    });
    expect(sealed?.boosts[0]).toMatchObject({ id: 'boost-5', kind: 'weekly', bonusCents: 500 });
    expect(
      sealBoostOfferVersion({
        id: 'version-1',
        timezone: 'America/Chicago',
        validFrom: '2026-09-01T05:00:00.000Z',
        validUntil: validUntil.toISOString(),
        withdrawnFromSelectionAt: '2026-09-02T00:00:00.000Z',
        tiers: [{ threshold_cents: 4000, discount_cents: 1000 }],
        boosts: [{ id: 'bad', kind: 'weekly' }],
        boostSessionMinutes: null,
      }),
    ).toBeNull();
  });

  it('keeps the qualifying Boost id when the cap removes the whole bonus', () => {
    const offer = version();
    const quoted = quoteBoost({
      offerVersion: offer,
      eligibleSubtotalCents: 1500,
      arrivalAt: arrival,
    });
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    expect(quoted.quote.boost_id).toBeNull();
    expect(quoted.quote.boost_discount_cents).toBe(0);
    expect(qualifyingArrivalBoostId(offer, arrival, quoted.quote)).toBe('boost-5');
    const plain = { ...quoted.quote, reasons: ['quoted'] as BoostQuote['reasons'], boost_id: null };
    expect(qualifyingArrivalBoostId(offer, arrival, plain)).toBeNull();
  });
});
