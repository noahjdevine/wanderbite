/** Exact string only. Unset, empty, and every other value keep the stream route off. */
export const DISCOVER_STREAM_FLAG = 'DISCOVER_STREAM_ENABLED';

export function discoverStreamEnabled(
  value: string | undefined = process.env.DISCOVER_STREAM_ENABLED,
): boolean {
  return value === 'true';
}

/**
 * Exact string only. Unset, empty, and every other value keep the model pick.
 * When this is on, code chooses the restaurant and Haiku writes one sentence.
 * `selectionMode` is `ai` when that sentence is shown, and `random_fallback`
 * when the card uses the template sentence.
 */
export const DISCOVER_CODE_PICK_FLAG = 'DISCOVER_CODE_PICK_ENABLED';

export function discoverCodePickEnabled(
  value: string | undefined = process.env.DISCOVER_CODE_PICK_ENABLED,
): boolean {
  return value === 'true';
}
