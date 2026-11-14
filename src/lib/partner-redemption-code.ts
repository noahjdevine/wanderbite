/**
 * Partner entry for a redemption code.
 * Issued codes are `WB-` plus 5 characters from the alphabet in
 * `redeem-challenge.ts` (no 0, O, 1, or I). `token_hash` is the SHA-256 of
 * that canonical string. The server normalizes before hashing.
 */

export const REDEMPTION_CODE_PREFIX = 'WB-';
export const REDEMPTION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REDEMPTION_CODE_LENGTH = 5;

const CODE_BODY = new RegExp(`^[${REDEMPTION_CODE_ALPHABET}]{${REDEMPTION_CODE_LENGTH}}$`);

export const PARTNER_CODE_HINT =
  'Enter the 5 letters/numbers after WB- — with or without WB-.';

export const PARTNER_CODE_NOT_FOUND_MESSAGE =
  "We couldn't find that code. Check the 5 characters after WB- and try again.";

/**
 * Trim, drop internal whitespace, and uppercase.
 * Accepts `WB-XXXXX`, `WBXXXXX`, `wb xxxxx`, or bare `XXXXX`.
 * A compact string of exactly 5 characters is the body, even when it starts
 * with WB. `WB-` or `WB` is a prefix only when the string is longer than that.
 * Returns `WB-XXXXX`, or null when the result is not that shape.
 */
export function normalizePartnerRedemptionCode(raw: string): string | null {
  const compact = raw.trim().replace(/\s+/g, '').toUpperCase();
  if (!compact) return null;
  let body = compact;
  if (compact.length > REDEMPTION_CODE_LENGTH) {
    if (body.startsWith(REDEMPTION_CODE_PREFIX)) {
      body = body.slice(REDEMPTION_CODE_PREFIX.length);
    } else if (body.startsWith('WB')) {
      body = body.slice(2);
    }
  }
  if (!CODE_BODY.test(body)) return null;
  return `${REDEMPTION_CODE_PREFIX}${body}`;
}

/** What the partner input shows. A complete code snaps to the canonical form. */
export function partnerCodeInputValue(raw: string): string {
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  return normalizePartnerRedemptionCode(compact) ?? compact;
}
