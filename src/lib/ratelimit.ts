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

/** Legacy URL-gated limiter. Billable AI uses `aiRedis` (URL+token) only. */
export const rouletteLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, '1 h'),
      prefix: 'wanderbite:roulette',
    })
  : null;

const aiRedis =
  redisUrl?.trim() && redisToken
    ? new Redis({
        url: redisUrl.trim(),
        token: redisToken,
      })
    : null;

/** 10 billable spins per hour per subject. Missing Redis denies billable AI. */
export const aiRouletteSubjectLimiter = aiRedis
  ? new Ratelimit({
      redis: aiRedis,
      limiter: Ratelimit.slidingWindow(10, '1 h'),
      prefix: 'wanderbite:ai-roulette-subject',
    })
  : null;

/** 20 billable spins per hour per hashed IP. Missing Redis denies billable AI. */
export const aiRouletteIpLimiter = aiRedis
  ? new Ratelimit({
      redis: aiRedis,
      limiter: Ratelimit.slidingWindow(20, '1 h'),
      prefix: 'wanderbite:ai-roulette-ip',
    })
  : null;

const AI_LIMIT_TIMEOUT_MS = 1_500;
export const PASSWORD_RESET_LIMIT_TIMEOUT_MS = 1_500;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('limiter_timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Both subject and hashed-IP limiters must succeed before a billable provider call. */
export async function allowBillableRoulette(
  subjectKey: string,
  ipHash: string,
): Promise<boolean> {
  if (!aiRouletteSubjectLimiter || !aiRouletteIpLimiter) return false;
  try {
    const [subject, ip] = await Promise.all([
      withTimeout(aiRouletteSubjectLimiter.limit(subjectKey), AI_LIMIT_TIMEOUT_MS),
      withTimeout(aiRouletteIpLimiter.limit(ipHash), AI_LIMIT_TIMEOUT_MS),
    ]);
    return subject.success && ip.success;
  } catch {
    return false;
  }
}

/** 3 reset emails per 60 minutes per email digest. URL+token Redis only. */
export const passwordResetEmailLimiter = aiRedis
  ? new Ratelimit({
      redis: aiRedis,
      limiter: Ratelimit.slidingWindow(3, '60 m'),
      prefix: 'wanderbite:password-reset-email',
    })
  : null;

/** 20 reset emails per 60 minutes per IP digest. URL+token Redis only. */
export const passwordResetIpLimiter = aiRedis
  ? new Ratelimit({
      redis: aiRedis,
      limiter: Ratelimit.slidingWindow(20, '60 m'),
      prefix: 'wanderbite:password-reset-ip',
    })
  : null;

export async function bothLimitersAllow(
  left: { limit: (id: string) => Promise<{ success: boolean }> } | null,
  right: { limit: (id: string) => Promise<{ success: boolean }> } | null,
  leftId: string,
  rightId: string,
  timeoutMs: number = PASSWORD_RESET_LIMIT_TIMEOUT_MS,
): Promise<boolean> {
  if (!left || !right) return false;
  try {
    const [a, b] = await Promise.all([
      withTimeout(left.limit(leftId), timeoutMs),
      withTimeout(right.limit(rightId), timeoutMs),
    ]);
    return a.success && b.success;
  } catch {
    return false;
  }
}

/**
 * Both email and IP digest buckets must succeed before Auth is invoked.
 * Missing Redis, timeout, throw, or deny fail closed. Parallel calls may
 * consume one counter if the other fails; that is accepted.
 */
export async function allowPasswordReset(
  emailDigest: string,
  ipDigest: string,
): Promise<boolean> {
  return bothLimitersAllow(
    passwordResetEmailLimiter,
    passwordResetIpLimiter,
    emailDigest,
    ipDigest,
  );
}

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

/** CSP reports: 40 posts per 5 minutes per client IP. Missing Redis drops reports in production. */
export const cspReportLimiter = verifyRedis
  ? new Ratelimit({
      redis: verifyRedis,
      limiter: Ratelimit.slidingWindow(40, '5 m'),
      prefix: 'wanderbite:csp-report-ip',
    })
  : null;
