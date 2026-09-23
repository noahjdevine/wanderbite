import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeMailbox } from '@/lib/email-address';

export const ADVENTURE_REMINDERS_TOPIC = 'adventure_reminders';
export const UNSUBSCRIBE_KEY_VERSION = 1;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UnsubscribeClaims = {
  userId: string;
  topic: typeof ADVENTURE_REMINDERS_TOPIC;
  email: string;
  version: number;
};

function currentSecret(): string | null {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim();
  return secret ? secret : null;
}

function verificationSecrets(): string[] {
  const current = currentSecret();
  if (!current) return [];
  const previous = process.env.EMAIL_UNSUBSCRIBE_SECRET_PREVIOUS?.trim();
  return previous ? [current, previous] : [current];
}

function signBody(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function signaturesMatch(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export function signAdventureReminderUnsubscribe(input: {
  userId: string;
  email: string;
}): string | null {
  const secret = currentSecret();
  const email = normalizeMailbox(input.email);
  if (!secret || !email || !UUID.test(input.userId)) return null;

  const payload = {
    v: UNSUBSCRIBE_KEY_VERSION,
    u: input.userId,
    t: ADVENTURE_REMINDERS_TOPIC,
    e: email,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signBody(body, secret);
  return `v${UNSUBSCRIBE_KEY_VERSION}.${body}.${signature}`;
}

export function verifyAdventureReminderUnsubscribe(
  token: string | null | undefined,
): UnsubscribeClaims | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [prefix, body, signature] = parts;
  if (!prefix || !body || !signature) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const version = record.v;
  const userId = record.u;
  const topic = record.t;
  const email = typeof record.e === 'string' ? normalizeMailbox(record.e) : null;
  if (version !== UNSUBSCRIBE_KEY_VERSION || prefix !== `v${UNSUBSCRIBE_KEY_VERSION}`) {
    return null;
  }
  if (typeof userId !== 'string' || !UUID.test(userId)) return null;
  if (topic !== ADVENTURE_REMINDERS_TOPIC || !email) return null;

  const secrets = verificationSecrets();
  if (secrets.length === 0) return null;
  const matches = secrets.some((secret) => signaturesMatch(signature, signBody(body, secret)));
  if (!matches) return null;

  return {
    userId,
    topic: ADVENTURE_REMINDERS_TOPIC,
    email,
    version: UNSUBSCRIBE_KEY_VERSION,
  };
}

export function unsubscribeUrl(baseUrl: string, token: string): string {
  const root = baseUrl.replace(/\/+$/, '');
  return `${root}/email/unsubscribe?token=${encodeURIComponent(token)}`;
}
