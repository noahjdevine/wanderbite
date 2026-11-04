import { createHash } from 'node:crypto';

/** SHA-256 of the fetched page bytes. The page HTML itself is not stored. */
export function contentHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}
