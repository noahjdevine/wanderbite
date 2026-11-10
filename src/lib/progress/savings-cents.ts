import { ESTIMATED_SAVINGS_FALLBACK_CENTS } from '@/lib/progress/rules';

/**
 * Dollars Progress shows for verified visits.
 *
 * `useStoredSettlements` is true only after a successful settlement read while
 * `E07_ARRIVAL_SESSIONS_ENABLED` is exactly `true`. A whole non-negative
 * `storedCents` is a `consume_quote` total or a stored `use_sealed_base`
 * amount. Anything else uses today's sealed lowest tier, then the 1000-cent
 * fallback.
 *
 * `isEstimate` is false only when that read succeeded and every counted visit
 * had stored cents. No visits, any read-time visit, the 1000-cent fallback,
 * or the flag-off path stays estimated. Older visits are not backfilled.
 *
 * `correctedCents` is an admin savings adjustment. When it is a whole
 * non-negative amount it replaces both the stored snapshot and the read-time
 * figure for that visit, and that visit counts as known.
 */
export type VisitSavingsInput = {
  /** Today's read-time sealed lowest tier, when the item has one. */
  sealedCents?: number | null;
  /** Parsed stored cents. Null when this visit has no usable snapshot. */
  storedCents?: number | null;
  /** Admin-corrected cents for this visit. Wins over the stored snapshot. */
  correctedCents?: number | null;
};

export type VisitSavingsTotal = {
  cents: number;
  amount: number;
  isEstimate: boolean;
};

type ParsedSettlement = {
  snapshot:
    | {
        total_discount_cents?: number;
        discount_amount_cents?: number;
      }
    | null;
} | null;

function wholeCents(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * Cents from a row `recordedBoostSettlementFromRow` already accepted.
 * A missing snapshot, a sealed miss, or cents the parser would not store
 * returns null so the visit stays on today's read-time path.
 */
export function storedCentsFromParsedSettlement(recorded: ParsedSettlement): number | null {
  const snapshot = recorded?.snapshot;
  if (!snapshot) return null;
  if ('total_discount_cents' in snapshot) return wholeCents(snapshot.total_discount_cents);
  return wholeCents(snapshot.discount_amount_cents);
}

function readTimeCents(sealedCents: number | null | undefined): number {
  return sealedCents ?? ESTIMATED_SAVINGS_FALLBACK_CENTS;
}

export function savingsCentsForVisits(
  visits: readonly VisitSavingsInput[],
  options: { useStoredSettlements: boolean },
): VisitSavingsTotal {
  let cents = 0;
  let everyKnown = visits.length > 0;
  for (const visit of visits) {
    const corrected = wholeCents(visit.correctedCents);
    if (corrected != null) {
      cents += corrected;
      continue;
    }
    if (options.useStoredSettlements) {
      const stored = wholeCents(visit.storedCents);
      if (stored != null) {
        cents += stored;
        continue;
      }
    }
    everyKnown = false;
    cents += readTimeCents(visit.sealedCents);
  }
  return { cents, amount: cents / 100, isEstimate: !everyKnown };
}
