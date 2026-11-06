import { addMinutes } from 'date-fns';
import type { Json } from '@/types/database.types';
import { selectBoost, type OfferBoost, type OfferTier } from '@/lib/offers/calculator';
import type { BoostQuote, SealedBoostOfferVersion } from '@/lib/boost/quote';

/** Noah 2026-11-05: a null boost_session_minutes lasts 4 hours. */
export const DEFAULT_BOOST_SESSION_MINUTES = 240;

export type OfferVersionTermsRow = {
  id: string;
  timezone: string;
  validFrom: string;
  validUntil: string;
  withdrawnFromSelectionAt: string | null;
  tiers: Json;
  boosts: Json;
  boostSessionMinutes: number | null;
};

function isRecord(value: Json): value is { [key: string]: Json | undefined } {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseTiers(value: Json): OfferTier[] | null {
  if (!Array.isArray(value) || value.length < 1) return null;
  const tiers: OfferTier[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const threshold = entry.threshold_cents;
    const discount = entry.discount_cents;
    if (typeof threshold !== 'number' || typeof discount !== 'number') return null;
    if (!Number.isInteger(threshold) || !Number.isInteger(discount)) return null;
    tiers.push({ thresholdCents: threshold, discountCents: discount });
  }
  return tiers;
}

function parseBoosts(value: Json): OfferBoost[] | null {
  if (!Array.isArray(value)) return null;
  const boosts: OfferBoost[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const id = entry.id;
    const bonus = entry.bonus_cents;
    if (typeof id !== 'string' || !id) return null;
    if (typeof bonus !== 'number' || !Number.isInteger(bonus)) return null;
    if (entry.kind === 'dated') {
      if (typeof entry.start !== 'string' || typeof entry.end !== 'string') return null;
      boosts.push({ id, kind: 'dated', start: entry.start, end: entry.end, bonusCents: bonus });
      continue;
    }
    if (entry.kind === 'weekly') {
      const startIsodow = entry.start_isodow;
      const startMinute = entry.start_minute;
      const endMinute = entry.end_minute;
      if (
        typeof startIsodow !== 'number' ||
        typeof startMinute !== 'number' ||
        typeof endMinute !== 'number' ||
        !Number.isInteger(startIsodow) ||
        !Number.isInteger(startMinute) ||
        !Number.isInteger(endMinute)
      ) {
        return null;
      }
      boosts.push({
        id,
        kind: 'weekly',
        startIsodow,
        startMinute,
        endMinute,
        bonusCents: bonus,
      });
      continue;
    }
    return null;
  }
  return boosts;
}

/** Sealed JSON from offer_versions. A malformed term list is refused, not dropped. */
export function sealBoostOfferVersion(row: OfferVersionTermsRow): SealedBoostOfferVersion | null {
  const tiers = parseTiers(row.tiers);
  const boosts = parseBoosts(row.boosts);
  if (!tiers || !boosts) return null;
  const validFrom = new Date(row.validFrom);
  const validUntil = new Date(row.validUntil);
  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime())) return null;
  return {
    id: row.id,
    timezone: row.timezone,
    validFrom,
    validUntil,
    withdrawn: row.withdrawnFromSelectionAt != null,
    tiers,
    boosts,
  };
}

/**
 * Session end. A duration from arrival, then the earliest of that instant,
 * offer valid_until, and the visit deadline when one is set. Null minutes
 * use 240. A non-positive stored duration is invalid.
 */
export function arrivalSessionExpiresAt(input: {
  arrivalAt: Date;
  validUntil: Date;
  redemptionDeadline: Date | null;
  boostSessionMinutes: number | null;
}): Date | null {
  if (!(input.arrivalAt instanceof Date) || Number.isNaN(input.arrivalAt.getTime())) return null;
  if (!(input.validUntil instanceof Date) || Number.isNaN(input.validUntil.getTime())) return null;
  const minutes =
    input.boostSessionMinutes == null ? DEFAULT_BOOST_SESSION_MINUTES : input.boostSessionMinutes;
  if (!Number.isInteger(minutes) || minutes <= 0) return null;
  const bounds = [addMinutes(input.arrivalAt, minutes), input.validUntil];
  if (input.redemptionDeadline) {
    if (Number.isNaN(input.redemptionDeadline.getTime())) return null;
    bounds.push(input.redemptionDeadline);
  }
  const earliest = bounds.reduce((soonest, instant) =>
    instant.getTime() < soonest.getTime() ? instant : soonest,
  );
  if (earliest.getTime() <= input.arrivalAt.getTime()) return null;
  return earliest;
}

/**
 * Lock the Boost that qualified at arrival. When the cap reduces that bonus
 * to zero, quote.boost_id is null and the qualifying id is still the lock so
 * a later subtotal can apply it and a larger Boost cannot replace it.
 */
export function qualifyingArrivalBoostId(
  version: SealedBoostOfferVersion,
  arrivalAt: Date,
  quote: BoostQuote,
): string | null {
  if (quote.below_minimum) return null;
  if (quote.boost_id) return quote.boost_id;
  if (!quote.reasons.includes('capped')) return null;
  return selectBoost(version.boosts, arrivalAt, version.timezone, version.validUntil)?.id ?? null;
}
