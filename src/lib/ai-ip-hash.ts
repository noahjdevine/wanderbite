import { createHash } from 'node:crypto';

function ipHashSecret(): string | null {
  const secret = process.env.WANDERBITE_IP_HASH_SECRET?.trim();
  return secret && secret.length >= 16 ? secret : null;
}

export function hasIpHashSecret(): boolean {
  return ipHashSecret() !== null;
}

function digest(domain: string, value: string): string | null {
  const secret = ipHashSecret();
  if (!secret) return null;
  const material = `${domain}:${secret}:${value}`;
  return `v1:${createHash('sha256').update(material).digest('hex')}`;
}

/**
 * Preserve this output for a real IP so live roulette buckets stay stable.
 * Callers must pass a validated IPv4/IPv6 address, never "unknown".
 */
export function hashClientIp(ip: string): string | null {
  const normalized = ip.trim();
  if (!normalized) return null;
  return digest('v1', normalized);
}

/** Domain-separated email identity. Redis receives this digest, never the email. */
export function hashResetEmail(normalizedEmail: string): string | null {
  const email = normalizedEmail.trim().toLowerCase();
  if (!email) return null;
  return digest('v1:email', email);
}
