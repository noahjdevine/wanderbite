import { isIP } from 'node:net';

/**
 * Trusted client IP for production on Vercel: first `x-forwarded-for` hop
 * after Vercel overwrites the header. No `x-real-ip` fallback.
 * Revisit if Vercel Trusted Proxy is enabled.
 */
export function trustedClientIpFromHeaders(
  headers: Pick<Headers, 'get'>,
): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (!forwarded) return null;
  const first = forwarded.split(',')[0]?.trim() ?? '';
  if (!first) return null;
  const version = isIP(first);
  return version === 4 || version === 6 ? first : null;
}
