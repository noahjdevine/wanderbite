import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { hashPartnerPin, verifyPartnerPin } from '@/lib/partner-pin';
import {
  filterPartnerPinInput,
  isPartnerLoginDisabled,
  parsePartnerPin,
} from '@/lib/partner-pin-format';
import { isRedemptionIssuanceDisabled } from '@/lib/redemption-issue';
import {
  bothLimitersAllow,
  evaluateLimiter,
  evaluateLimiterPair,
} from '@/lib/ratelimit';
import { parseUuid } from '@/lib/uuid';

const ROOT = path.resolve(__dirname, '../..');

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('G13-B2 PIN and UUID parsers', () => {
  it('keeps leading zeros and rejects non-digit or wrong-length PINs', () => {
    expect(parsePartnerPin('0042')).toBe('0042');
    expect(parsePartnerPin(' 123456 ')).toBe('123456');
    expect(parsePartnerPin('123')).toBeNull();
    expect(parsePartnerPin('1234567')).toBeNull();
    expect(parsePartnerPin('12ab')).toBeNull();
    expect(filterPartnerPinInput('00a42x')).toBe('0042');
  });

  it('hashes and verifies a leading-zero PIN as a string', async () => {
    const hash = await hashPartnerPin('0042');
    await expect(verifyPartnerPin('0042', hash)).resolves.toBe(true);
    await expect(verifyPartnerPin('42', hash)).resolves.toBe(false);
    await expect(hashPartnerPin('12')).rejects.toThrow('invalid_partner_pin');
  });

  it('parses restaurant UUIDs without the AI idempotency helper', () => {
    expect(parseUuid('50000000-0000-4000-8000-000000000001')).toBe(
      '50000000-0000-4000-8000-000000000001',
    );
    expect(parseUuid('not-a-uuid')).toBeNull();
    expect(source('src/app/actions/partner-auth.ts')).toMatch(/parseUuid/);
    expect(source('src/app/actions/partner-auth.ts')).not.toMatch(/parseIdempotencyUuid/);
  });
});

describe('G13-B2 kill switches', () => {
  it('fail-closes only on exact true', () => {
    expect(isPartnerLoginDisabled('true')).toBe(true);
    expect(isPartnerLoginDisabled('TRUE')).toBe(false);
    expect(isPartnerLoginDisabled('')).toBe(false);
    expect(isRedemptionIssuanceDisabled('true')).toBe(true);
    expect(isRedemptionIssuanceDisabled('TRUE')).toBe(false);
    expect(isRedemptionIssuanceDisabled(undefined)).toBe(false);
  });
});

describe('G13-B2 limiter three-state results', () => {
  it('distinguishes allow, rate_limited, and unavailable', async () => {
    const ok = { limit: vi.fn().mockResolvedValue({ success: true }) };
    const deny = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const boom = { limit: vi.fn().mockRejectedValue(new Error('redis down')) };
    const hang = { limit: vi.fn().mockReturnValue(new Promise(() => {})) };

    await expect(evaluateLimiterPair(ok, ok, 'restaurant:uuid:ip:digest', 'ip:digest')).resolves.toBe(
      'allowed',
    );
    await expect(evaluateLimiterPair(ok, deny, 'a', 'b')).resolves.toBe('rate_limited');
    await expect(evaluateLimiterPair(null, ok, 'a', 'b')).resolves.toBe('unavailable');
    await expect(evaluateLimiterPair(boom, ok, 'a', 'b')).resolves.toBe('unavailable');
    await expect(evaluateLimiterPair(ok, hang, 'a', 'b', 20)).resolves.toBe('unavailable');
    await expect(evaluateLimiter(deny, 'user-uuid')).resolves.toBe('rate_limited');
    await expect(evaluateLimiter(null, 'user-uuid')).resolves.toBe('unavailable');
    await expect(bothLimitersAllow(ok, deny, 'a', 'b')).resolves.toBe(false);
    await expect(bothLimitersAllow(ok, ok, 'a', 'b')).resolves.toBe(true);
  });
});

describe('G13-B2 source contracts', () => {
  it('fail-closes login and issuance on URL+token Redis and committed kill switches', () => {
    const ratelimit = source('src/lib/ratelimit.ts');
    expect(ratelimit).toMatch(/export const partnerLoginRestaurantIpLimiter = aiRedis/);
    expect(ratelimit).toMatch(/export const partnerLoginIpLimiter = aiRedis/);
    expect(ratelimit).toMatch(/export const redemptionIssueLimiter = aiRedis/);
    expect(ratelimit).toMatch(/Ratelimit\.slidingWindow\(5, '15 m'\)/);
    expect(ratelimit).toMatch(/Ratelimit\.slidingWindow\(30, '15 m'\)/);
    expect(ratelimit).toMatch(/restaurant:\$\{restaurantId\}:ip:\$\{ipDigest\}/);
    expect(ratelimit).not.toMatch(/export const partnerLoginLimiter = redis/);
    expect(ratelimit).not.toMatch(/export const redeemLimiter = redis/);

    const login = source('src/app/actions/partner-auth.ts');
    expect(login).toMatch(/isPartnerLoginDisabled/);
    expect(login).toMatch(/partner_login_rate_limited/);
    expect(login).toMatch(/partner_login_limiter_unavailable/);
    expect(login).not.toMatch(/x-real-ip/);
    expect(login).not.toMatch(/['"]unknown['"]/);

    const redeem = source('src/app/actions/redeem-challenge.ts');
    expect(redeem).toMatch(/isRedemptionIssuanceDisabled/);
    expect(redeem).toMatch(/redemption_issue_rate_limited/);
    expect(redeem).toMatch(/redemption_issue_limiter_unavailable/);
    expect(redeem).not.toMatch(/rpcError\.message/);

    const example = source('.env.example');
    expect(example).toMatch(/WANDERBITE_PARTNER_LOGIN_DISABLED=/);
    expect(example).toMatch(/WANDERBITE_REDEMPTION_ISSUANCE_DISABLED=/);
    expect(example).not.toMatch(/^WANDERBITE_PARTNER_LOGIN_DISABLED=true$/m);
    expect(example).not.toMatch(/^WANDERBITE_REDEMPTION_ISSUANCE_DISABLED=true$/m);
    expect(example).toMatch(/^WANDERBITE_AI_DISABLED=true$/m);
    expect(example).not.toMatch(/^CHECKOUT_ENABLED=true$/m);
  });

  it('aligns PIN inputs and avoids type=number', () => {
    const slug = source('src/app/partner/[slug]/partner-slug-login.tsx');
    const general = source('src/app/partner/partner-login-form.tsx');
    const admin = source('src/app/(site)/admin/admin-client.tsx');
    const field = source('src/components/partner/partner-pin-field.tsx');
    expect(field).toMatch(/type="password"/);
    expect(field).toMatch(/inputMode="numeric"/);
    expect(field).toMatch(/maxLength=\{PARTNER_PIN_MAX_DIGITS\}/);
    expect(slug).not.toMatch(/type="number"/);
    expect(slug).toMatch(/PartnerPinField/);
    expect(general).toMatch(/PartnerPinField/);
    expect(admin).toMatch(/PartnerPinField/);
    expect(admin).toMatch(/setRestaurantPin/);
    expect(source('src/app/(site)/admin/actions.ts')).toMatch(/parsePartnerPin/);
    expect(source('src/app/(site)/admin/actions.ts')).toMatch(/export async function setRestaurantPin/);
  });
});
