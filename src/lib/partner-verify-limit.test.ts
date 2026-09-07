import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const limitSession = vi.fn();
const limitIp = vi.fn();

vi.mock('@/lib/ratelimit', () => ({
  partnerVerifySessionLimiter: { limit: (...args: unknown[]) => limitSession(...args) },
  partnerVerifyIpLimiter: { limit: (...args: unknown[]) => limitIp(...args) },
}));

describe('enforcePartnerVerifyLimit', () => {
  beforeEach(() => {
    vi.resetModules();
    limitSession.mockReset();
    limitIp.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
    limitSession.mockResolvedValue({ success: true });
    limitIp.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows when both buckets succeed', async () => {
    const { enforcePartnerVerifyLimit } = await import('@/lib/partner-verify-limit');
    await expect(
      enforcePartnerVerifyLimit({ sessionTokenHash: 'abc', ip: '1.1.1.1' }),
    ).resolves.toBe('allow');
    expect(limitSession).toHaveBeenCalledWith('session:abc');
    expect(limitIp).toHaveBeenCalledWith('ip:1.1.1.1');
  });

  it('throttles when the session bucket is exhausted', async () => {
    limitSession.mockResolvedValue({ success: false });
    const { enforcePartnerVerifyLimit } = await import('@/lib/partner-verify-limit');
    await expect(
      enforcePartnerVerifyLimit({ sessionTokenHash: 'abc', ip: '1.1.1.1' }),
    ).resolves.toBe('throttled');
    expect(limitIp).not.toHaveBeenCalled();
  });

  it('throttles when the IP bucket is exhausted', async () => {
    limitIp.mockResolvedValue({ success: false });
    const { enforcePartnerVerifyLimit } = await import('@/lib/partner-verify-limit');
    await expect(
      enforcePartnerVerifyLimit({ sessionTokenHash: 'abc', ip: '1.1.1.1' }),
    ).resolves.toBe('throttled');
  });

  it('fails closed in production when either Upstash env var is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
    const { enforcePartnerVerifyLimit } = await import('@/lib/partner-verify-limit');
    await expect(
      enforcePartnerVerifyLimit({ sessionTokenHash: 'abc', ip: '1.1.1.1' }),
    ).resolves.toBe('unavailable');
    expect(limitSession).not.toHaveBeenCalled();
    expect(limitIp).not.toHaveBeenCalled();
  });

  it('fails closed in production when the token is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const { enforcePartnerVerifyLimit } = await import('@/lib/partner-verify-limit');
    await expect(
      enforcePartnerVerifyLimit({ sessionTokenHash: 'abc', ip: '1.1.1.1' }),
    ).resolves.toBe('unavailable');
    expect(limitSession).not.toHaveBeenCalled();
  });

  it('allows in non-production when Upstash is unset', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const { enforcePartnerVerifyLimit } = await import('@/lib/partner-verify-limit');
    await expect(
      enforcePartnerVerifyLimit({ sessionTokenHash: 'abc', ip: '1.1.1.1' }),
    ).resolves.toBe('allow');
    expect(limitSession).not.toHaveBeenCalled();
  });

  it('fails closed when the session limiter throws', async () => {
    limitSession.mockRejectedValue(new Error('redis down'));
    const { enforcePartnerVerifyLimit } = await import('@/lib/partner-verify-limit');
    await expect(
      enforcePartnerVerifyLimit({ sessionTokenHash: 'abc', ip: '1.1.1.1' }),
    ).resolves.toBe('unavailable');
    expect(limitIp).not.toHaveBeenCalled();
  });

  it('fails closed when the IP limiter throws', async () => {
    limitIp.mockRejectedValue(new Error('redis down'));
    const { enforcePartnerVerifyLimit } = await import('@/lib/partner-verify-limit');
    await expect(
      enforcePartnerVerifyLimit({ sessionTokenHash: 'abc', ip: '1.1.1.1' }),
    ).resolves.toBe('unavailable');
  });

  it('fails closed when a limiter call times out', async () => {
    const { withTimeout } = await import('@/lib/partner-verify-limit');
    await expect(withTimeout(new Promise(() => {}), 20)).rejects.toThrow('rate limit timeout');
  });
});
