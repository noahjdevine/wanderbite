import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { partnerSessionCookieOptions } from '@/lib/partner-session';

export const AI_GUEST_COOKIE_NAME = 'wanderbite_ai_guest';
export const AI_GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

function guestSigningSecret(): string | null {
  const secret = process.env.WANDERBITE_GUEST_SIGNING_SECRET?.trim();
  return secret && secret.length >= 16 ? secret : null;
}

export function hasGuestSigningSecret(): boolean {
  return guestSigningSecret() !== null;
}

function signGuestId(guestId: string, secret: string): string {
  return createHmac('sha256', secret).update(`v1.${guestId}`).digest('hex');
}

/** Domain prefix is not the guest-cookie MAC (`v1.`). */
const DISCOVERY_REPLAY_PREFIX = 'discovery-replay.v1';

export function discoveryReplayMac(kind: 'message' | 'filter', value: string): string | null {
  const secret = guestSigningSecret();
  if (!secret) return null;
  return createHmac('sha256', secret)
    .update(`${DISCOVERY_REPLAY_PREFIX}.${kind}.${value}`)
    .digest('hex');
}

export function discoveryReplayMacEqual(actual: string, expected: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(actual) || !/^[0-9a-f]{64}$/i.test(expected)) return false;
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function mintGuestCookieValue(): string | null {
  const secret = guestSigningSecret();
  if (!secret) return null;
  const guestId = randomUUID();
  return `v1.${guestId}.${signGuestId(guestId, secret)}`;
}

export function parseGuestCookieValue(raw: string | undefined | null): string | null {
  const secret = guestSigningSecret();
  if (!secret || !raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const guestId = parts[1] ?? '';
  const mac = parts[2] ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(guestId)) {
    return null;
  }
  if (!/^[0-9a-f]{64}$/i.test(mac)) return null;
  const expected = signGuestId(guestId, secret);
  const a = Buffer.from(mac, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return guestId;
}

export function guestCookieSetOptions() {
  return partnerSessionCookieOptions(AI_GUEST_COOKIE_MAX_AGE);
}
