/** Independent per-credit minimum lowest-tier base (cents). Must match `public.credit_floor_cents()` in SQL. */
export const MINIMUM_CREDIT_BASE_CENTS = 1000;

export function meetsMinimumCreditBase(
  baseCents: number | null | undefined,
  minimumCents: number = MINIMUM_CREDIT_BASE_CENTS,
): boolean {
  if (baseCents == null || !Number.isFinite(baseCents)) return false;
  return baseCents >= minimumCents;
}
