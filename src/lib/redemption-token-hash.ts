import { createHash } from 'node:crypto';

/** SHA-256 hex digest of the raw WB- code; stored in `redemptions.token_hash`. */
export function hashRedemptionToken(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}
