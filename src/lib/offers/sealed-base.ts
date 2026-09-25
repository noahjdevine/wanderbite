import type { Json } from '@/types/database.types';

export type SealedBase = {
  discount_amount_cents: number;
  min_spend_cents: number;
};

/** Lowest published tier by qualifying spend. Boosts are not included. */
export function lowestSealedBase(tiers: Json | null | undefined): SealedBase | null {
  if (!Array.isArray(tiers)) return null;
  const objects = tiers.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    return [entry as { threshold_cents?: unknown; discount_cents?: unknown }];
  });
  const sorted = [...objects].sort(
    (a, b) => Number(a.threshold_cents) - Number(b.threshold_cents),
  );
  const lowest = sorted[0];
  if (!lowest) return null;
  const discount = Number(lowest.discount_cents);
  const threshold = Number(lowest.threshold_cents);
  if (!Number.isInteger(discount) || !Number.isInteger(threshold)) return null;
  return { discount_amount_cents: discount, min_spend_cents: threshold };
}

export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return `$${cents % 100 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}`;
}
