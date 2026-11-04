import { beforeEach, describe, expect, it, vi } from 'vitest';

const ledger = vi.hoisted(() => ({
  events: [] as string[],
  fetchCalls: 0,
  versions: vi.fn(),
  quote: vi.fn(),
  headroom: vi.fn(),
  reserve: vi.fn(),
  dispatch: vi.fn(),
  failBefore: vi.fn(),
  assumed: vi.fn(),
  release: vi.fn(),
  settle: vi.fn(),
  reconcile: vi.fn(),
  revealCalls: [] as string[],
}));

vi.mock('@/lib/ai-budget/rpcs', () => ({
  rpcAiCurrentVersions: () => ledger.versions(),
  rpcAiQuoteMaxCost: (...args: unknown[]) => ledger.quote(...args),
  rpcAiOpsHeadroom: () => ledger.headroom(),
  rpcAiReserve: (...args: unknown[]) => ledger.reserve(...args),
  rpcAiDispatch: (...args: unknown[]) => ledger.dispatch(...args),
  rpcAiFailBeforeDispatch: (...args: unknown[]) => ledger.failBefore(...args),
  rpcAiMarkAssumedSpent: (...args: unknown[]) => ledger.assumed(...args),
  rpcAiReleaseCustomerAllowance: (...args: unknown[]) => ledger.release(...args),
  rpcAiSettle: (...args: unknown[]) => ledger.settle(...args),
  rpcAiReconcile: (...args: unknown[]) => ledger.reconcile(...args),
}));

vi.mock('@/lib/challenges/generate', () => ({
  loadMonthlyChallengePool: async () => ({
    ok: true,
    kind: 'pool',
    marketId: 'market-1',
    chicagoPeriod: '2026-11-01',
    utcPeriod: '2026-11-01',
    zipDistanceExpanded: false,
    wantsCocktailExperience: false,
    candidates: ['alpha', 'beta', 'gamma'].map((id) => ({
      restaurantId: id,
      offerVersionId: null,
      baseSavingsCents: 2000,
      minSpendCents: 5000,
      distanceTier: 'requested',
      restaurant: { id, name: id, cuisine_tags: ['thai'] },
    })),
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    rpc: async (_fn: string, args: { p_selection_source: string; p_restaurant_ids: string[] }) => {
      ledger.events.push('reveal');
      ledger.revealCalls.push(args.p_selection_source);
      return {
        data: [{
          outcome: 'created',
          cycle_id: 'cycle-1',
          reveal_id: 'reveal-1',
          period_key: '2026-11-01',
          restaurant_ids: args.p_restaurant_ids,
          selection_source: args.p_selection_source,
          brief: { occasion: '', discovery_level: '', summary: '', surprise_me: false },
          item_reasons: args.p_restaurant_ids.map((id) => ({
            restaurant_id: id,
            template_id: 'deterministic_pair_v1',
            text: `${id} fallback`,
          })),
        }],
        error: null,
      };
    },
  }),
}));

import { rankMonthlyReveal, useRankTimeoutForTests } from '@/lib/challenges/ai-rank';
import { revealMonthlyChallengeForUser } from '@/lib/challenges/reveal';

const brief = {
  occasion: '',
  discovery_level: '',
  summary: '',
  surprise_me: true,
};

const candidates = ['alpha', 'beta'].map((id) => ({
  id,
  name: id,
  cuisines: ['thai'],
  distanceTier: 'requested' as const,
  baseSavingsCents: 2000,
  minSpendCents: 5000,
}));

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

describe('reveal ranking deadline', () => {
  beforeEach(() => {
    ledger.events.length = 0;
    ledger.fetchCalls = 0;
    ledger.revealCalls.length = 0;
    ledger.versions.mockReset();
    ledger.quote.mockReset();
    ledger.headroom.mockReset();
    ledger.reserve.mockReset();
    ledger.dispatch.mockReset();
    ledger.failBefore.mockReset();
    ledger.assumed.mockReset();
    ledger.release.mockReset();
    ledger.settle.mockReset();
    ledger.reconcile.mockReset();
    ledger.versions.mockResolvedValue({ price_version_id: 'price-1', config_version_id: 'config-1' });
    ledger.quote.mockResolvedValue(2500);
    ledger.headroom.mockResolvedValue([{ bucket_kind: 'global', remaining_microdollars: 1_000_000_000 }]);
    ledger.reserve.mockResolvedValue({ acquired: true, request_id: 'req-1' });
    ledger.dispatch.mockResolvedValue({ acquired: true, request_id: 'req-1' });
    ledger.failBefore.mockImplementation(async () => {
      ledger.events.push('fail_before');
    });
    ledger.assumed.mockImplementation(async () => {
      ledger.events.push('assumed');
    });
    ledger.release.mockImplementation(async () => {
      ledger.events.push('release');
    });
    ledger.settle.mockImplementation(async () => {
      ledger.events.push('settle');
    });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      ledger.fetchCalls += 1;
      await new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        if (signal.aborted) {
          reject(abortError());
          return;
        }
        signal.addEventListener('abort', () => reject(abortError()), { once: true });
      });
      return new Response('', { status: 500 });
    }));
    useRankTimeoutForTests(null);
    process.env.E04_MONTHLY_REVEAL_ENABLED = 'true';
    process.env.E04_AI_RANKING_ENABLED = 'true';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    delete process.env.WANDERBITE_AI_DISABLED;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('makes no model or ledger calls when the flags are unset', async () => {
    delete process.env.E04_MONTHLY_REVEAL_ENABLED;
    delete process.env.E04_AI_RANKING_ENABLED;
    const ranked = await rankMonthlyReveal({ brief, candidates, timeoutMs: 30 });
    expect(ranked).toBeNull();
    expect(ledger.versions).not.toHaveBeenCalled();
    expect(ledger.quote).not.toHaveBeenCalled();
    expect(ledger.reserve).not.toHaveBeenCalled();
    expect(ledger.fetchCalls).toBe(0);
  });

  it('makes no fetch when the deadline passes before dispatch', async () => {
    ledger.reserve.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { acquired: true, request_id: 'req-slow' };
    });
    const ranked = await rankMonthlyReveal({ brief, candidates, timeoutMs: 15 });
    expect(ranked).toBeNull();
    expect(ledger.fetchCalls).toBe(0);
    expect(ledger.dispatch).not.toHaveBeenCalled();
    expect(ledger.failBefore).toHaveBeenCalledWith('req-slow');
  });

  it('closes the reservation before returning and the reveal commits the deterministic pair', async () => {
    useRankTimeoutForTests(30);
    const result = await revealMonthlyChallengeForUser('user-1', { surpriseMe: true });
    expect(ledger.fetchCalls).toBe(1);
    expect(ledger.events.indexOf('assumed')).toBeGreaterThanOrEqual(0);
    expect(ledger.events.indexOf('assumed')).toBeLessThan(ledger.events.indexOf('reveal'));
    expect(ledger.events).toContain('release');
    expect(ledger.revealCalls).toEqual(['deterministic_fallback']);
    expect(result).toMatchObject({ ok: true, selectionSource: 'deterministic_fallback' });
    const quoteArgs = ledger.quote.mock.calls[0]?.[0] as { modelId: string; provider: string; usageUnits: Record<string, number> };
    expect(quoteArgs.modelId).toBe('claude-haiku-4-5-20251001');
    expect(quoteArgs.provider).toBe('anthropic');
    expect(quoteArgs.usageUnits.input).toBeGreaterThan(0);
    expect(quoteArgs.usageUnits.output).toBe(300);
  });
});
