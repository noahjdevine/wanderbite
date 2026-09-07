import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? '';

if (!redisUrl) {
  console.warn(
    '[ratelimit] UPSTASH_REDIS_REST_URL is not set; rate limiting disabled.'
  );
}

const redis = redisUrl
  ? new Redis({
      url: redisUrl,
      token: process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
    })
  : null;

/** Verify limiter requires both Upstash vars; login/redeem stay URL-gated (fail-open). */
const verifyRedis =
  redisUrl?.trim() && redisToken
    ? new Redis({
        url: redisUrl.trim(),
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

/** Partner verify: 20 attempts per 5 minutes per hashed session. */
export const partnerVerifySessionLimiter = verifyRedis
  ? new Ratelimit({
      redis: verifyRedis,
      limiter: Ratelimit.slidingWindow(20, '5 m'),
      prefix: 'wanderbite:partner-verify-session',
    })
  : null;

/** Partner verify: 60 attempts per 5 minutes per client IP. */
export const partnerVerifyIpLimiter = verifyRedis
  ? new Ratelimit({
      redis: verifyRedis,
      limiter: Ratelimit.slidingWindow(60, '5 m'),
      prefix: 'wanderbite:partner-verify-ip',
    })
  : null;
