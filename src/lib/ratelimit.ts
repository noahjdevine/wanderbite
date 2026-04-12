import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;

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
