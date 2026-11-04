import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DISCOVER_AI_PICK_LOG,
  DISCOVER_FALLBACK_LOG,
  DISCOVER_FALLBACK_REASONS,
  fallbackReasonForReplayMiss,
  fallbackReasonForReserveDenial,
  logDiscoverAiPick,
  logDiscoverFallback,
  modelPickFallbackReason,
  prerequisiteFallbackReason,
  type DiscoverFallbackLog,
} from '@/lib/discover/fallback-reason';

const ROOT = path.resolve(__dirname, '../../..');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('prerequisite fallback reasons', () => {
  const ready = {
    aiDisabled: false,
    hasApiKey: true,
    hasGuestSigningSecret: true,
    hasIpHashSecret: true,
    hasIpHash: true,
    hasSubject: true,
  };

  it('returns null when every gate is open', () => {
    expect(prerequisiteFallbackReason(ready)).toBeNull();
  });

  it('prefers the kill switch over a missing key', () => {
    expect(prerequisiteFallbackReason({ ...ready, aiDisabled: true, hasApiKey: false })).toBe(
      'ai_disabled',
    );
  });

  it('groups a missing key or either secret as missing_config', () => {
    expect(prerequisiteFallbackReason({ ...ready, hasApiKey: false })).toBe('missing_config');
    expect(prerequisiteFallbackReason({ ...ready, hasGuestSigningSecret: false })).toBe(
      'missing_config',
    );
    expect(
      prerequisiteFallbackReason({
        ...ready,
        hasIpHashSecret: false,
        hasIpHash: false,
      }),
    ).toBe('missing_config');
  });

  it('uses missing_identity for no IP hash or no subject once config is present', () => {
    expect(prerequisiteFallbackReason({ ...ready, hasIpHash: false })).toBe('missing_identity');
    expect(prerequisiteFallbackReason({ ...ready, hasSubject: false })).toBe('missing_identity');
  });
});

describe('reserve and model reasons', () => {
  it('maps the ledger budget denials and a transferred guest', () => {
    for (const deny of [
      'insufficient_budget',
      'guest_turns_exhausted',
      'paid_core_reserve',
      'zero_quote',
    ]) {
      expect(fallbackReasonForReserveDenial(deny)).toBe('budget_exceeded');
    }
    expect(fallbackReasonForReserveDenial('guest_already_transferred')).toBe('guest_transferred');
    expect(fallbackReasonForReserveDenial('')).toBe('missing_metadata');
    expect(fallbackReasonForReserveDenial(null)).toBe('missing_metadata');
  });

  it('classifies a replay miss without an unknown code', () => {
    expect(
      fallbackReasonForReplayMiss({ denyReason: 'insufficient_budget', payload: null }),
    ).toBe('budget_exceeded');
    expect(
      fallbackReasonForReplayMiss({ denyReason: 'guest_already_transferred', payload: null }),
    ).toBe('guest_transferred');
    expect(fallbackReasonForReplayMiss({ denyReason: '', payload: null })).toBe('missing_metadata');
    expect(
      fallbackReasonForReplayMiss({
        denyReason: '',
        payload: { restaurantId: 'left-the-pool' },
      }),
    ).toBe('invalid_pick');
    expect(
      fallbackReasonForReplayMiss({
        denyReason: 'paid_core_reserve',
        payload: { restaurantId: 'left-the-pool' },
      }),
    ).toBe('budget_exceeded');
  });

  it('lets a provider failure win over an unparsed or out-of-pool id', () => {
    expect(
      modelPickFallbackReason({ providerFailed: true, parsedId: null, pickValid: false }),
    ).toBe('provider_error');
    expect(
      modelPickFallbackReason({ providerFailed: false, parsedId: null, pickValid: false }),
    ).toBe('parse_failed');
    expect(
      modelPickFallbackReason({ providerFailed: false, parsedId: 'other', pickValid: false }),
    ).toBe('invalid_pick');
    expect(
      modelPickFallbackReason({ providerFailed: false, parsedId: 'rest-1', pickValid: true }),
    ).toBeNull();
  });
});

describe('discover log lines', () => {
  it('writes one fallback object and omits providerStatus when absent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const entry: DiscoverFallbackLog = {
      reason: 'rate_limited',
      requestId: '11111111-1111-4111-8111-111111111111',
      memberType: 'guest',
      poolSize: 4,
      dietaryFilterCount: 1,
    };
    logDiscoverFallback(entry);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toBe(DISCOVER_FALLBACK_LOG);
    expect(warn.mock.calls[0]?.[1]).toEqual(entry);
    expect(Object.keys(warn.mock.calls[0]?.[1] as object)).toEqual([
      'reason',
      'requestId',
      'memberType',
      'poolSize',
      'dietaryFilterCount',
    ]);
  });

  it('adds providerStatus only as a number', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logDiscoverFallback({
      reason: 'provider_error',
      requestId: 'req-1',
      memberType: 'member',
      poolSize: 2,
      dietaryFilterCount: 0,
      providerStatus: 503,
    });
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ providerStatus: 503 });
  });

  it('writes the AI success line with requestId and poolSize only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logDiscoverAiPick({ requestId: 'req-1', poolSize: 8 });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]).toEqual([DISCOVER_AI_PICK_LOG, { requestId: 'req-1', poolSize: 8 }]);
  });

  it('keeps the reason union closed', () => {
    expect(DISCOVER_FALLBACK_REASONS).not.toContain('unknown');
    expect(DISCOVER_FALLBACK_REASONS).not.toContain('no_candidates');
  });
});

describe('paths that do not pick a Discover fallback', () => {
  it('leaves recipe Q&A and the budget helpers off the random_fallback path', () => {
    const qa = readFileSync(path.join(ROOT, 'src/lib/recipes/qa-turn.ts'), 'utf8');
    const accounting = readFileSync(path.join(ROOT, 'src/lib/ai-budget/accounting.ts'), 'utf8');
    const rpcs = readFileSync(path.join(ROOT, 'src/lib/ai-budget/rpcs.ts'), 'utf8');
    expect(qa).not.toMatch(/randomFallback|random_fallback/);
    expect(accounting).not.toMatch(/randomFallback|random_fallback/);
    expect(rpcs).not.toMatch(/randomFallback|random_fallback/);
  });
});
