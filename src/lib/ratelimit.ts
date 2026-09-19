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

/** Verify limiter requires both Upstash vars. */
const verifyRedis =
  redisUrl?.trim() && redisToken
    ? new Redis({
        url: redisUrl.trim(),
        token: redisToken,
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
export const FAIL_CLOSED_LIMIT_TIMEOUT_MS = 1_500;

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

export type FailClosedLimitResult = 'allowed' | 'rate_limited' | 'unavailable';

type LimiterLike = {
  limit: (id: string) => Promise<{ success: boolean }>;
} | null;

export async function evaluateLimiter(
  limiter: LimiterLike,
  id: string,
  timeoutMs: number = FAIL_CLOSED_LIMIT_TIMEOUT_MS,
): Promise<FailClosedLimitResult> {
  if (!limiter) return 'unavailable';
  try {
    const result = await withTimeout(limiter.limit(id), timeoutMs);
    return result.success ? 'allowed' : 'rate_limited';
  } catch {
    return 'unavailable';
  }
}

export async function evaluateLimiterPair(
  left: LimiterLike,
  right: LimiterLike,
  leftId: string,
  rightId: string,
  timeoutMs: number = PASSWORD_RESET_LIMIT_TIMEOUT_MS,
): Promise<FailClosedLimitResult> {
  if (!left || !right) return 'unavailable';
  try {
    const [a, b] = await Promise.all([
      withTimeout(left.limit(leftId), timeoutMs),
      withTimeout(right.limit(rightId), timeoutMs),
    ]);
    if (!a.success || !b.success) return 'rate_limited';
    return 'allowed';
  } catch {
    return 'unavailable';
  }
}

/**
 * Boolean wrapper for password reset. Exhausted buckets, missing Redis,
 * timeout, and throw all return false so B1 public behavior is unchanged.
 */
export async function bothLimitersAllow(
  left: LimiterLike,
  right: LimiterLike,
  leftId: string,
  rightId: string,
  timeoutMs: number = PASSWORD_RESET_LIMIT_TIMEOUT_MS,
): Promise<boolean> {
  return (await evaluateLimiterPair(left, right, leftId, rightId, timeoutMs)) === 'allowed';
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

/** 5 PIN logins per 15 minutes per restaurant UUID + IP digest. */
export const partnerLoginRestaurantIpLimiter = aiRedis
  ? new Ratelimit({
      redis: aiRedis,
      limiter: Ratelimit.slidingWindow(5, '15 m'),
      prefix: 'wanderbite:partner-login-restaurant-ip',
    })
  : null;

/** 30 PIN logins per 15 minutes per IP digest across restaurants. */
export const partnerLoginIpLimiter = aiRedis
  ? new Ratelimit({
      redis: aiRedis,
      limiter: Ratelimit.slidingWindow(30, '15 m'),
      prefix: 'wanderbite:partner-login-ip',
    })
  : null;

export async function evaluatePartnerLoginLimit(
  restaurantId: string,
  ipDigest: string,
): Promise<FailClosedLimitResult> {
  return evaluateLimiterPair(
    partnerLoginRestaurantIpLimiter,
    partnerLoginIpLimiter,
    `restaurant:${restaurantId}:ip:${ipDigest}`,
    `ip:${ipDigest}`,
  );
}

/** 3 new QR issuances per 5 minutes per user UUID. */
export const redemptionIssueLimiter = aiRedis
  ? new Ratelimit({
      redis: aiRedis,
      limiter: Ratelimit.slidingWindow(3, '5 m'),
      prefix: 'wanderbite:redemption-issue',
    })
  : null;

export async function evaluateRedemptionIssueLimit(
  userId: string,
): Promise<FailClosedLimitResult> {
  return evaluateLimiter(redemptionIssueLimiter, userId);
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
