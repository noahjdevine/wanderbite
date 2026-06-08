import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

if (!redisUrl || !redisToken) {
  console.warn(
    '[ratelimit] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is not set; rate limiting disabled.'
  );
}

const redis =
  redisUrl && redisToken
    ? new Redis({
        url: redisUrl,
        token: redisToken,
      })
    : null;

/** 5 attempts per 15 minutes (keyed by caller, e.g. restaurantId for partner login). */
export const partnerLoginLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, '15 m'),
      prefix: 'wanderbite:partner-login',
    })
  : null;

/** 3 attempts per 5 minutes per userId. */
export const redeemLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, '5 m'),
      prefix: 'wanderbite:redeem',
    })
  : null;

/** 3 attempts per 60 minutes per email. */
export const passwordResetLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, '60 m'),
      prefix: 'wanderbite:password-reset',
    })
  : null;

/** 10 spins per hour per IP. Roulette is expensive (DB read + LLM call). */
export const rouletteLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, '1 h'),
      prefix: 'wanderbite:roulette',
    })
  : null;

/**
 * Returns true when the request should proceed.
 * On Upstash auth/outage errors, fails open so product flows keep working.
 */
export async function checkRateLimit(
  limiter: Ratelimit | null,
  key: string
): Promise<boolean> {
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit(key);
    return success;
  } catch (err) {
    console.error('[ratelimit] Upstash error — allowing request:', err);
    return true;
  }
}
