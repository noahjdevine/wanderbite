import { createHash } from 'node:crypto';

function ipHashSecret(): string | null {
  const secret = process.env.WANDERBITE_IP_HASH_SECRET?.trim();
  return secret && secret.length >= 16 ? secret : null;
}

export function hasIpHashSecret(): boolean {
  return ipHashSecret() !== null;
}

export function hashClientIp(ip: string): string | null {
  const secret = ipHashSecret();
  if (!secret) return null;
  const normalized = ip.trim() || 'unknown';
  return `v1:${createHash('sha256').update(`v1:${secret}:${normalized}`).digest('hex')}`;
}
