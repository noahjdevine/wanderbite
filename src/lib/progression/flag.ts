/** Exact string only. Unset, empty, and every other value stay off. */
export const PROGRESSION_LEDGER_FLAG = 'E09_PROGRESSION_LEDGER_ENABLED';

export function progressionLedgerEnabled(
  value: string | undefined = process.env.E09_PROGRESSION_LEDGER_ENABLED,
): boolean {
  return value === 'true';
}

/** Exact string only. Unset, empty, and every other value stay off. */
export const MEMBER_PROGRESSION_UI_FLAG = 'E09_MEMBER_PROGRESSION_UI_ENABLED';

export function memberProgressionUiEnabled(
  value: string | undefined = process.env.E09_MEMBER_PROGRESSION_UI_ENABLED,
): boolean {
  return value === 'true';
}
