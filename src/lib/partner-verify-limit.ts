import 'server-only';

import { partnerVerifyIpLimiter, partnerVerifySessionLimiter } from '@/lib/ratelimit';

export const VERIFY_UNAVAILABLE_MESSAGE =
  'Verification is temporarily unavailable. Please try again later.';
export const VERIFY_THROTTLED_MESSAGE =
  'Too many attempts. Please try again later.';
export const VERIFY_LIMITER_TIMEOUT_MS = 2000;

export type PartnerVerifyLimitResult = 'allow' | 'throttled' | 'unavailable';

export function isUpstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('rate limit timeout')), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function failClosedWithoutLimiter(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Session bucket 20/5m and IP bucket 60/5m. Missing Upstash in production,
 * or a throw/reject/timeout from either limiter, refuses verify.
 */
export async function enforcePartnerVerifyLimit(args: {
  sessionTokenHash: string;
  ip: string;
}): Promise<PartnerVerifyLimitResult> {
  if (!isUpstashConfigured() || !partnerVerifySessionLimiter || !partnerVerifyIpLimiter) {
    return failClosedWithoutLimiter() ? 'unavailable' : 'allow';
  }

  try {
    const session = await withTimeout(
      partnerVerifySessionLimiter.limit(`session:${args.sessionTokenHash}`),
      VERIFY_LIMITER_TIMEOUT_MS,
    );
    if (!session.success) return 'throttled';

    const ip = await withTimeout(
      partnerVerifyIpLimiter.limit(`ip:${args.ip}`),
      VERIFY_LIMITER_TIMEOUT_MS,
    );
    if (!ip.success) return 'throttled';

    return 'allow';
  } catch {
    return 'unavailable';
  }
}
