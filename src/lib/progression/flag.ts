/** Exact string only. Unset, empty, and every other value stay off. */
export const PROGRESSION_LEDGER_FLAG = 'E09_PROGRESSION_LEDGER_ENABLED';

export function progressionLedgerEnabled(
  value: string | undefined = process.env.E09_PROGRESSION_LEDGER_ENABLED,
): boolean {
  return value === 'true';
}
