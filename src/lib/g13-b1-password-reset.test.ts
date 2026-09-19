import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  isPasswordResetDisabled,
  parseResetEmail,
  passwordResetRecoveryUrl,
  PASSWORD_RESET_RECOVERY_PATH,
  PASSWORD_RESET_VALIDATION_MESSAGE,
} from '@/lib/password-reset';
import { bothLimitersAllow } from '@/lib/ratelimit';

const ROOT = path.resolve(__dirname, '../..');

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('G13-B1 email validation and kill switch', () => {
  it('accepts a conservative local@domain and rejects empty, long, or malformed', () => {
    expect(parseResetEmail('  User@Example.COM ')).toBe('user@example.com');
    expect(parseResetEmail('')).toBeNull();
    expect(parseResetEmail('not-an-email')).toBeNull();
    expect(parseResetEmail('a@b')).toBeNull();
    expect(parseResetEmail('user@localhost')).toBeNull();
    expect(parseResetEmail('user name@example.com')).toBeNull();
    expect(parseResetEmail(`${'a'.repeat(65)}@example.com`)).toBeNull();
    expect(parseResetEmail(`${'a'.repeat(240)}@example.com`)).toBeNull();
  });

  it('fail-closes the kill switch only on exact true', () => {
    expect(isPasswordResetDisabled('true')).toBe(true);
    expect(isPasswordResetDisabled('TRUE')).toBe(false);
    expect(isPasswordResetDisabled('')).toBe(false);
    expect(isPasswordResetDisabled(undefined)).toBe(false);
  });

  it('requires an absolute http(s) origin for /auth/recovery', () => {
    expect(passwordResetRecoveryUrl('https://www.wanderbite.co/', '')).toBe(
      `https://www.wanderbite.co${PASSWORD_RESET_RECOVERY_PATH}`,
    );
    expect(passwordResetRecoveryUrl('', 'http://localhost:3000')).toBe(
      `http://localhost:3000${PASSWORD_RESET_RECOVERY_PATH}`,
    );
    expect(passwordResetRecoveryUrl('', '')).toBeNull();
    expect(passwordResetRecoveryUrl('not-a-url', '')).toBeNull();
    expect(passwordResetRecoveryUrl('ftp://example.com', '')).toBeNull();
  });
});

describe('G13-B1 fail-closed limiter pair', () => {
  it('allows only when both buckets succeed', async () => {
    const left = { limit: vi.fn().mockResolvedValue({ success: true }) };
    const right = { limit: vi.fn().mockResolvedValue({ success: true }) };
    await expect(bothLimitersAllow(left, right, 'email-digest', 'ip-digest')).resolves.toBe(
      true,
    );
    expect(left.limit).toHaveBeenCalledWith('email-digest');
    expect(right.limit).toHaveBeenCalledWith('ip-digest');
    expect(left.limit.mock.calls[0][0]).not.toMatch(/@/);
    expect(right.limit.mock.calls[0][0]).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it('denies when either limiter is missing, exhausted, throws, or times out', async () => {
    const ok = { limit: vi.fn().mockResolvedValue({ success: true }) };
    const deny = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const boom = { limit: vi.fn().mockRejectedValue(new Error('redis down')) };
    const hang = { limit: vi.fn().mockReturnValue(new Promise(() => {})) };

    await expect(bothLimitersAllow(null, ok, 'a', 'b')).resolves.toBe(false);
    await expect(bothLimitersAllow(ok, deny, 'a', 'b')).resolves.toBe(false);
    await expect(bothLimitersAllow(boom, ok, 'a', 'b')).resolves.toBe(false);
    await expect(bothLimitersAllow(ok, hang, 'a', 'b', 20)).resolves.toBe(false);
  });
});

describe('G13-B1 source contracts', () => {
  it('keeps partner login and redeem URL-gated fail-open and reset URL+token fail-closed', () => {
    const ratelimit = source('src/lib/ratelimit.ts');
    expect(ratelimit).toMatch(/export const partnerLoginLimiter = redis/);
    expect(ratelimit).toMatch(/export const redeemLimiter = redis/);
    expect(ratelimit).toMatch(/export const passwordResetEmailLimiter = aiRedis/);
    expect(ratelimit).toMatch(/export const passwordResetIpLimiter = aiRedis/);
    expect(ratelimit).toMatch(/Ratelimit\.slidingWindow\(3, '60 m'\)/);
    expect(ratelimit).toMatch(/Ratelimit\.slidingWindow\(20, '60 m'\)/);
    expect(ratelimit).toMatch(/PASSWORD_RESET_LIMIT_TIMEOUT_MS = 1_500/);
    expect(ratelimit).not.toMatch(/passwordResetLimiter/);
    expect(source('src/app/actions/partner-auth.ts')).toMatch(/partnerLoginLimiter/);
    expect(source('src/app/actions/partner-auth.ts')).toMatch(/x-real-ip/);
  });

  it('never returns Auth error.message and never puts raw email in Redis', () => {
    const auth = source('src/app/actions/auth.ts');
    const resetStart = auth.indexOf('export async function sendPasswordResetEmail');
    const resetEnd = auth.indexOf('export async function deleteAccount');
    const resetFn = auth.slice(resetStart, resetEnd);
    expect(auth).toMatch(/PASSWORD_RESET_UNAVAILABLE_MESSAGE/);
    expect(resetFn).toMatch(/allowPasswordReset\(emailDigest, ipDigest\)/);
    expect(resetFn).toMatch(/PASSWORD_RESET_VALIDATION_MESSAGE/);
    expect(resetFn).toMatch(/return unavailable\(\)/);
    expect(resetFn).toMatch(/resetPasswordForEmail/);
    expect(resetFn).not.toMatch(/error\.message/);
    expect(resetFn).not.toMatch(/limiter\.limit\(/);
    expect(resetFn).not.toMatch(/passwordResetLimiter/);
    expect(source('src/lib/password-reset.ts')).toContain(
      PASSWORD_RESET_VALIDATION_MESSAGE,
    );
  });

  it('leaves recovery completion off the request limiter and kill switch', () => {
    const recovery = source('src/app/auth/recovery/route.ts');
    const resetPage = source('src/app/(site)/reset-password/page.tsx');
    expect(recovery).not.toMatch(/allowPasswordReset/);
    expect(recovery).not.toMatch(/isPasswordResetDisabled/);
    expect(resetPage).not.toMatch(/allowPasswordReset/);
    expect(resetPage).not.toMatch(/isPasswordResetDisabled/);
    expect(resetPage).not.toMatch(/sendPasswordResetEmail/);
  });

  it('switches roulette to the trusted x-forwarded-for helper and keeps AI fail-closed', () => {
    const route = source('src/app/api/roulette/route.ts');
    expect(route).toMatch(/trustedClientIpFromHeaders/);
    expect(route).toMatch(/allowBillableRoulette/);
    expect(route).toMatch(/isWanderbiteAiDisabled/);
    expect(route).not.toMatch(/x-real-ip/);
    expect(route).not.toMatch(/getClientIp/);
    expect(route).not.toMatch(/CHECKOUT_ENABLED/);

    const example = source('.env.example');
    expect(example).toMatch(/^WANDERBITE_AI_DISABLED=true$/m);
    expect(example).not.toMatch(/^WANDERBITE_PASSWORD_RESET_DISABLED=true$/m);
    expect(example).not.toMatch(/^CHECKOUT_ENABLED=true$/m);
    expect(example).toMatch(/WANDERBITE_PASSWORD_RESET_DISABLED=/);
  });
});
