export const ROULETTE_MAX_BODY_BYTES = 8_192;
/** Whole discovery message. Over this length is rejected, not clipped. */
export const ROULETTE_MAX_MESSAGE_CHARS = 500;
export const ROULETTE_MAX_STRING_CHARS = 200;
export const ROULETTE_MAX_DIETARY = 10;
export const ROULETTE_MAX_EXCLUDED = 20;
export const ROULETTE_MAX_RESTAURANTS_IN_PROMPT = 50;
export const ROULETTE_MAX_NAME_CHARS = 120;
export const ROULETTE_MAX_DESC_CHARS = 400;
export const ROULETTE_MAX_ADDRESS_CHARS = 200;
export const ROULETTE_MAX_PROMPT_BYTES = 80_000;
export const ROULETTE_MAX_RESULT_REASON_CHARS = 800;

export function clipChars(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

export function boundStringArray(values: unknown, maxItems: number): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const item of values) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.push(clipChars(trimmed, ROULETTE_MAX_STRING_CHARS));
    if (out.length >= maxItems) break;
  }
  return out;
}

export function isBodyWithinByteLimit(byteLength: number, declaredLength: number | null): boolean {
  if (byteLength > ROULETTE_MAX_BODY_BYTES) return false;
  if (declaredLength !== null && declaredLength > ROULETTE_MAX_BODY_BYTES) return false;
  return true;
}
