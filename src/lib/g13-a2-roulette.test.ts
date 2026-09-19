import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isBodyWithinByteLimit, ROULETTE_MAX_BODY_BYTES } from '@/lib/ai-bounds';
import {
  mintGuestCookieValue,
  parseGuestCookieValue,
} from '@/lib/ai-guest';
import { parseIdempotencyUuid, rouletteIdempotencyKey } from '@/lib/ai-idempotency';
import { isWanderbiteAiDisabled } from '@/lib/ai-kill-switch';

const ROOT = path.resolve(__dirname, '../..');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('G13-A2 kill switch', () => {
  it('fail-closes only on exact true', () => {
    vi.stubEnv('WANDERBITE_AI_DISABLED', 'true');
    expect(isWanderbiteAiDisabled()).toBe(true);
    vi.stubEnv('WANDERBITE_AI_DISABLED', 'TRUE');
    expect(isWanderbiteAiDisabled()).toBe(false);
    vi.stubEnv('WANDERBITE_AI_DISABLED', '');
    expect(isWanderbiteAiDisabled()).toBe(false);
  });
});

describe('G13-A2 guest cookie', () => {
  it('rejects a tampered HMAC', () => {
    vi.stubEnv('WANDERBITE_GUEST_SIGNING_SECRET', 'test-guest-signing-secret');
    const minted = mintGuestCookieValue();
    expect(minted).toBeTruthy();
    const guestId = parseGuestCookieValue(minted);
    expect(guestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(parseGuestCookieValue(`${minted}a`)).toBeNull();
    const forged = `v1.${randomUUID()}.${createHmac('sha256', 'other').update('x').digest('hex')}`;
    expect(parseGuestCookieValue(forged)).toBeNull();
  });
});

describe('G13-A2 idempotency and bounds', () => {
  it('namespaces the client UUID under the subject', () => {
    const uuid = '11111111-1111-4111-8111-111111111111';
    expect(parseIdempotencyUuid(uuid)).toBe(uuid);
    expect(rouletteIdempotencyKey('user:abc', uuid)).toBe(`roulette:user:abc:${uuid}`);
    expect(parseIdempotencyUuid('not-a-uuid')).toBeNull();
  });

  it('rejects oversized bodies before JSON parse', () => {
    expect(isBodyWithinByteLimit(ROULETTE_MAX_BODY_BYTES, ROULETTE_MAX_BODY_BYTES)).toBe(true);
    expect(isBodyWithinByteLimit(ROULETTE_MAX_BODY_BYTES + 1, null)).toBe(false);
    expect(isBodyWithinByteLimit(10, ROULETTE_MAX_BODY_BYTES + 1)).toBe(false);
  });
});

describe('G13-A2 roulette route and client contracts', () => {
  it('pins Haiku snapshot, maxDuration 60, and fail-closed billable AI', () => {
    const route = readFileSync(path.join(ROOT, 'src/app/api/roulette/route.ts'), 'utf8');
    const models = readFileSync(path.join(ROOT, 'src/lib/ai-budget/models.ts'), 'utf8');
    expect(route).toMatch(/export const maxDuration = 60/);
    expect(models).toMatch(/claude-haiku-4-5-20251001/);
    expect(route).toMatch(/ANTHROPIC_HAIKU_SNAPSHOT/);
    expect(route).not.toMatch(/model: 'claude-haiku-4-5'/);
    expect(route).toMatch(/isWanderbiteAiDisabled/);
    expect(route).toMatch(/allowBillableRoulette/);
    expect(route).toMatch(/rpcAiReserve/);
    expect(route).toMatch(/rpcAiDispatch/);
    expect(route).toMatch(/selectionMode/);
    expect(route).not.toMatch(/anthropicRaw\.slice/);
    expect(route.match(/fetch\('https:\/\/api\.anthropic\.com\/v1\/messages'/g)?.length).toBe(1);
    expect(route).not.toMatch(/CHECKOUT_ENABLED/);
  });

  it('reuses one client UUID on network retry and keeps auth transfer best-effort', () => {
    const client = readFileSync(path.join(ROOT, 'src/lib/roulette-api-client.ts'), 'utf8');
    expect(client).toMatch(/Idempotency-Key/);
    expect(client).toMatch(/postRouletteOnce\(payload, idempotencyKey\)/);
    const callback = readFileSync(path.join(ROOT, 'src/app/auth/callback/route.ts'), 'utf8');
    expect(callback).toMatch(/guest AI transfer skipped/);
    expect(callback).toMatch(/rpcAiTransferGuestToAccount/);
    const example = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    expect(example).toMatch(/^WANDERBITE_AI_DISABLED=true$/m);
    expect(example).not.toMatch(/^CHECKOUT_ENABLED=true$/m);
  });
});
