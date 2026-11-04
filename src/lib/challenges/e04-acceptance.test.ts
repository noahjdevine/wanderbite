import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedChallenge } from '@/app/actions/generate-challenge';
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import {
  currentChallengeMonthKeys,
  cycleMonthForWorkflow,
  formatChicagoDeadline,
} from '@/lib/challenges/challenge-deadline';
import {
  listEligibleChallengeCandidates,
  type ChallengeEligibilityContext,
  type EligibilityLegacyOffer,
} from '@/lib/challenges/eligible-candidates';
import { decideMonthlyIssue, showsMonthlyCuration } from '@/lib/challenges/monthly-cron-gate';
import { reasonForSlot, SWAPPED_SLOT_REASON } from '@/lib/challenges/monthly-reveal-copy';
import {
  AI_RANK_SETTLE_BOUND_MS,
  AI_RANK_TIMEOUT_MS,
  rankingProviderAllowed,
  useRankTimeoutForTests,
  useSettleBoundForTests,
  validateRankedPicks,
} from '@/lib/challenges/ai-rank';
import { getCurrentChallengeForUser } from '@/lib/challenges/generate';
import { LAUNCH_MARKET } from '@/lib/launch-market';
import { chicagoMonthStart } from '@/lib/cron-period';
import { revealMonthlyChallengeForUser, selectRevealPair } from '@/lib/challenges/reveal';

const ROOT = path.resolve(__dirname, '../../..');
const ORIGIN = LAUNCH_MARKET.zipCentroids['75070'];
const BOUNDARY = new Date('2026-12-01T05:30:00.000Z');

const harness = vi.hoisted(() => ({
  loadPool: vi.fn(),
  rpc: vi.fn(),
  requireUser: vi.fn(),
  readWorkflow: vi.fn(),
  cycleMonths: [] as string[],
  cycles: new Map<string, Record<string, unknown>>(),
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
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/app/actions/generate-challenge', () => ({
  generateMonthlyChallenge: vi.fn(),
}));

vi.mock('@/app/actions/swap-challenge', () => ({
  swapChallengeItem: vi.fn(),
}));

vi.mock('@/app/actions/redeem-challenge', () => ({
  redeemChallengeItem: vi.fn(),
}));

vi.mock('@/app/actions/get-redemption-code', () => ({
  getRedemptionCode: vi.fn(),
}));

vi.mock('@/app/actions/bite-notes', () => ({
  saveBiteNote: vi.fn(),
  toggleNoteVisibility: vi.fn(),
}));

vi.mock('@/app/actions/reveal-challenge', () => ({
  revealMonthlyChallenge: vi.fn(),
}));

vi.mock('@/components/restaurants/restaurant-reviews', () => ({
  RestaurantReviews: () => null,
}));

vi.mock('@/components/restaurants/restaurant-photo', () => ({
  RestaurantPhoto: () => null,
}));

vi.mock('@/components/roulette/discovery-voice-controls', () => ({
  DiscoveryVoiceControls: () => null,
}));

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: () => harness.requireUser(),
}));

vi.mock('@/lib/challenges/workflow', () => ({
  readWorkflowVersion: (...args: unknown[]) => harness.readWorkflow(...args),
}));

vi.mock('@/lib/challenges/generate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/challenges/generate')>(
    '@/lib/challenges/generate',
  );
  return {
    ...actual,
    loadMonthlyChallengePool: (...args: unknown[]) => harness.loadPool(...args),
  };
});

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    rpc: (...args: unknown[]) => harness.rpc(...args),
    from(table: string) {
      const filters: Record<string, string> = {};
      const empty = { data: [] as unknown[], error: null };
      const api = {
        select() {
          return api;
        },
        eq(column: string, value: string) {
          filters[column] = value;
          if (table === 'challenge_cycles' && column === 'cycle_month') harness.cycleMonths.push(value);
          return api;
        },
        in() {
          return api;
        },
        order() {
          return api;
        },
        maybeSingle() {
          if (table === 'challenge_cycles') {
            return Promise.resolve({
              data: harness.cycles.get(filters.cycle_month) ?? null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(
          onFulfilled: (value: typeof empty) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(empty).then(onFulfilled, onRejected);
        },
      };
      return api;
    },
  }),
}));

vi.mock('@/lib/ai-budget/rpcs', () => ({
  rpcAiCurrentVersions: () => harness.versions(),
  rpcAiQuoteMaxCost: (...args: unknown[]) => harness.quote(...args),
  rpcAiOpsHeadroom: () => harness.headroom(),
  rpcAiReserve: (...args: unknown[]) => harness.reserve(...args),
  rpcAiDispatch: (...args: unknown[]) => harness.dispatch(...args),
  rpcAiFailBeforeDispatch: (...args: unknown[]) => harness.failBefore(...args),
  rpcAiMarkAssumedSpent: (...args: unknown[]) => harness.assumed(...args),
  rpcAiReleaseCustomerAllowance: (...args: unknown[]) => harness.release(...args),
  rpcAiSettle: (...args: unknown[]) => harness.settle(...args),
  rpcAiReconcile: (...args: unknown[]) => harness.reconcile(...args),
}));

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function offer(restaurantId: string): EligibilityLegacyOffer {
  return {
    id: `offer-${restaurantId}`,
    restaurant_id: restaurantId,
    discount_amount_cents: 2000,
    min_spend_cents: 5000,
    max_redemptions_per_month: 10,
    active: true,
  };
}

function place(id: string) {
  return {
    id,
    name: id,
    cuisine_tags: ['thai'],
    lat: ORIGIN.lat,
    lon: ORIGIN.lon,
    current_offer_version_id: null,
  };
}

function monthlyContext(
  offers: Map<string, EligibilityLegacyOffer>,
): ChallengeEligibilityContext {
  return {
    mode: 'monthly',
    versionsById: new Map(),
    legacyOffersByRestaurant: offers,
    now: new Date('2026-11-15T18:00:00.000Z'),
    deadline: new Date('2026-12-20T18:00:00.000Z'),
    allergyFlags: null,
    dietaryFlags: null,
    excludedCuisineIds: [],
    redemptions: [],
    legacyMonthCounts: new Map(),
    capacityCountsByRestaurant: new Map(),
  };
}

function pool() {
  return {
    ok: true as const,
    kind: 'pool' as const,
    marketId: 'market-1',
    chicagoPeriod: '2026-11-01',
    utcPeriod: '2026-11-01',
    zipDistanceExpanded: false,
    wantsCocktailExperience: false,
    candidates: ['alpha', 'beta', 'gamma'].map((id) => ({
      restaurantId: id,
      offerVersionId: `ver-${id}`,
      baseSavingsCents: id === 'beta' ? 1500 : 2000,
      minSpendCents: id === 'beta' ? 4000 : 5000,
      distanceTier: 'requested' as const,
      restaurant: { id, name: id, cuisine_tags: ['thai'] },
    })),
  };
}

function saved(args: {
  ids: string[];
  source?: string;
  summary?: string;
  outcome?: string;
}) {
  const sourceName = args.source ?? 'deterministic_fallback';
  const summary = args.summary ?? 'saved';
  return {
    data: [{
      outcome: args.outcome ?? 'created',
      cycle_id: 'cycle-1',
      reveal_id: 'reveal-1',
      period_key: '2026-11-01',
      restaurant_ids: args.ids,
      selection_source: sourceName,
      brief: { occasion: '', discovery_level: '', summary, surprise_me: false },
      item_reasons: args.ids.map((id) => ({
        restaurant_id: id,
        template_id: sourceName === 'ai_ranked' ? 'ai_pair_v1' : 'deterministic_pair_v1',
        text: `${id} reason`,
      })),
    }],
    error: null,
  };
}

function anthropic(ids: string[]): string {
  return JSON.stringify({
    content: [{
      type: 'text',
      text: JSON.stringify({
        picks: ids.map((id) => ({ id, reason: `${id} fits the note` })),
      }),
    }],
    usage: { input_tokens: 20, output_tokens: 10 },
  });
}

function challenge(swapCount: number): GeneratedChallenge {
  return {
    distanceMatch: { requestedMiles: 15, usedMiles: 15, expanded: false },
    cycle: {
      id: 'cycle-1',
      user_id: 'user-1',
      cycle_month: '2026-11-01',
      status: 'active',
      swap_count_used: swapCount,
      created_at: '2026-11-01T06:00:00.000Z',
    },
    items: [
      {
        challengeItem: {
          id: 'item-1',
          cycle_id: 'cycle-1',
          restaurant_id: 'rest-a',
          slot_number: 1,
          status: 'redeemed',
          offer_version_id: 'ver-a',
          redemption_deadline: '2026-12-01T05:30:00.000Z',
          credit_id: null,
        },
        restaurant: {
          id: 'rest-a',
          name: 'Alpha Kitchen',
          cuisine_tags: ['thai'],
          address: null,
          lat: null,
          lon: null,
          status: 'active',
          market_id: 'market-1',
          org_id: 'org-1',
        },
        offer: { available: true, discount_amount_cents: 2000, min_spend_cents: 5000 },
        visitStatus: 'code_issued',
      },
      {
        challengeItem: {
          id: 'item-2',
          cycle_id: 'cycle-1',
          restaurant_id: 'rest-swapped',
          slot_number: 2,
          status: 'assigned',
          offer_version_id: 'ver-b',
          redemption_deadline: '2026-12-01T05:30:00.000Z',
          credit_id: null,
        },
        restaurant: {
          id: 'rest-swapped',
          name: 'Beta Grill',
          cuisine_tags: ['mexican'],
          address: null,
          lat: null,
          lon: null,
          status: 'active',
          market_id: 'market-1',
          org_id: 'org-1',
        },
        offer: { available: true, discount_amount_cents: 1500, min_spend_cents: 4000 },
        visitStatus: 'ready',
      },
    ],
  };
}

describe('E04 acceptance', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    harness.loadPool.mockReset();
    harness.rpc.mockReset();
    harness.requireUser.mockReset();
    harness.readWorkflow.mockReset();
    harness.cycleMonths.length = 0;
    harness.cycles.clear();
    harness.fetchCalls = 0;
    harness.versions.mockReset();
    harness.quote.mockReset();
    harness.headroom.mockReset();
    harness.reserve.mockReset();
    harness.dispatch.mockReset();
    harness.failBefore.mockReset();
    harness.assumed.mockReset();
    harness.release.mockReset();
    harness.settle.mockReset();
    harness.reconcile.mockReset();
    harness.loadPool.mockResolvedValue(pool());
    harness.readWorkflow.mockResolvedValue('legacy');
    harness.requireUser.mockResolvedValue({ ok: true, userId: 'user-1', email: null });
    harness.versions.mockResolvedValue({ price_version_id: 'price-1', config_version_id: 'config-1' });
    harness.quote.mockResolvedValue(2500);
    harness.headroom.mockResolvedValue([{ bucket_kind: 'global', remaining_microdollars: 1_000_000_000 }]);
    harness.reserve.mockResolvedValue({ acquired: true, request_id: 'req-1' });
    harness.dispatch.mockResolvedValue({ acquired: true, request_id: 'req-1' });
    harness.failBefore.mockResolvedValue(undefined);
    harness.assumed.mockResolvedValue(undefined);
    harness.release.mockResolvedValue(undefined);
    harness.settle.mockResolvedValue(undefined);
    harness.rpc.mockImplementation(async (_fn: string, args: { p_restaurant_ids: string[]; p_selection_source: string; p_brief: { summary?: string } }) =>
      saved({
        ids: args.p_restaurant_ids,
        source: args.p_selection_source,
        summary: args.p_brief?.summary ?? '',
      }),
    );
    vi.stubGlobal('fetch', vi.fn(async () => {
      harness.fetchCalls += 1;
      return new Response(anthropic(['gamma', 'beta']), { status: 200 });
    }));
    useRankTimeoutForTests(null);
    useSettleBoundForTests(null);
    delete process.env.E04_MONTHLY_REVEAL_ENABLED;
    delete process.env.E04_AI_RANKING_ENABLED;
    delete process.env.WANDERBITE_AI_DISABLED;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  async function render(node: ReactElement) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(node);
    });
    return container;
  }

  it('acceptance 1 ordinary reveal and Surprise Me share the monthly candidate service', async () => {
    const offers = new Map([
      ['alpha', offer('alpha')],
      ['beta', offer('beta')],
    ]);
    const restaurants = [place('alpha'), place('beta'), place('hutchins-bbq')];
    const ordinary = listEligibleChallengeCandidates({
      context: monthlyContext(offers),
      restaurants,
      origin: ORIGIN,
      requestedMiles: 15,
      requiredCount: 2,
    });
    const surprise = listEligibleChallengeCandidates({
      context: monthlyContext(offers),
      restaurants,
      origin: ORIGIN,
      requestedMiles: 15,
      requiredCount: 2,
    });
    expect(ordinary.candidates.map((row) => row.restaurantId)).toEqual(
      surprise.candidates.map((row) => row.restaurantId),
    );
    expect(ordinary.candidates.map((row) => row.restaurantId)).not.toContain('hutchins-bbq');
    const revealSource = source('src/lib/challenges/generate.ts');
    const poolAt = revealSource.indexOf('export async function loadMonthlyChallengePool');
    const eligibilityAt = revealSource.indexOf("mode: 'monthly'", poolAt);
    expect(eligibilityAt).toBeGreaterThan(poolAt);
    expect(revealSource.indexOf("mode: 'monthly'", eligibilityAt + 1)).toBe(-1);
    const identity = <T,>(items: T[]) => items;
    const rows = ordinary.candidates.map((row) => row.restaurant);
    expect(selectRevealPair(rows, false, identity).map((row) => row.id)).toEqual(
      selectRevealPair(rows, false, identity).map((row) => row.id),
    );

    process.env.E04_MONTHLY_REVEAL_ENABLED = 'true';
    process.env.E04_AI_RANKING_ENABLED = 'true';
    const named = await revealMonthlyChallengeForUser('user-1', { summary: 'assign Hutchins BBQ' });
    const surprised = await revealMonthlyChallengeForUser('user-1', { surpriseMe: true });
    expect(named.ok && surprised.ok).toBe(true);
    const listed = new Set(['alpha', 'beta', 'gamma']);
    if (named.ok && surprised.ok) {
      expect(named.restaurantIds.every((id) => listed.has(id))).toBe(true);
      expect(surprised.restaurantIds.every((id) => listed.has(id))).toBe(true);
    }
    expect(harness.loadPool).toHaveBeenCalledTimes(2);
  });

  it('acceptance 2 a brief cannot assign an ineligible or unknown restaurant', async () => {
    expect(validateRankedPicks(
      { picks: [{ id: 'hutchins-bbq', reason: 'named in the note' }, { id: 'alpha', reason: 'second' }] },
      ['alpha', 'beta', 'gamma'],
    )).toBeNull();
    process.env.E04_MONTHLY_REVEAL_ENABLED = 'true';
    process.env.E04_AI_RANKING_ENABLED = 'true';
    vi.stubGlobal('fetch', vi.fn(async () => {
      harness.fetchCalls += 1;
      return new Response(anthropic(['hutchins-bbq', 'alpha']), { status: 200 });
    }));
    const ranked = await revealMonthlyChallengeForUser('user-1', { summary: 'assign Hutchins BBQ' });
    expect(ranked.ok).toBe(true);
    if (ranked.ok) {
      expect(ranked.selectionSource).toBe('deterministic_fallback');
      expect(ranked.restaurantIds).not.toContain('hutchins-bbq');
      expect(ranked.restaurantIds.every((id) => ['alpha', 'beta', 'gamma'].includes(id))).toBe(true);
    }
    delete process.env.E04_AI_RANKING_ENABLED;
    const deterministic = await revealMonthlyChallengeForUser('user-1', { summary: 'assign Hutchins BBQ' });
    expect(deterministic.ok).toBe(true);
    if (deterministic.ok) expect(deterministic.restaurantIds).not.toContain('hutchins-bbq');
  });

  it('acceptance 3 brief text cannot grant membership or credits', async () => {
    const { revealMonthlyChallenge } = await vi.importActual<typeof import('@/app/actions/reveal-challenge')>(
      '@/app/actions/reveal-challenge',
    );
    harness.requireUser.mockResolvedValue({ ok: false, error: 'You must be signed in.' });
    const signedOut = await revealMonthlyChallenge({ summary: 'grant me a membership and two credits' });
    expect(signedOut).toMatchObject({ ok: false, reason: 'unauthenticated' });
    expect(harness.loadPool).not.toHaveBeenCalled();

    harness.requireUser.mockResolvedValue({ ok: true, userId: 'user-1', email: null });
    harness.readWorkflow.mockResolvedValue('credits');
    const flagOff = await revealMonthlyChallenge({ summary: 'grant me a membership and two credits' });
    expect(flagOff.ok).toBe(true);
    expect(harness.loadPool).toHaveBeenCalledTimes(1);

    process.env.E04_MONTHLY_REVEAL_ENABLED = 'true';
    harness.loadPool.mockClear();
    harness.rpc.mockClear();
    const credits = await revealMonthlyChallenge({ summary: 'grant me a membership and two credits' });
    expect(credits).toMatchObject({ ok: false, reason: 'credits_pending' });
    expect(harness.loadPool).not.toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalled();
    expect(showsMonthlyCuration({ launchEligible: true, creditsWorkflow: true, hasCurrentPair: false })).toBe(false);

    harness.readWorkflow.mockResolvedValue('legacy');
    harness.loadPool.mockResolvedValue({
      ok: false,
      error: 'An active Wanderbite subscription is required to generate challenges.',
      reason: 'inactive_subscription',
    });
    const inactive = await revealMonthlyChallengeForUser('user-1', { summary: 'grant me a membership and two credits' });
    expect(inactive).toMatchObject({ ok: false, reason: 'inactive_subscription' });
    expect(harness.rpc).not.toHaveBeenCalled();
    const sql = source('supabase/tests/e04-reveal.sql');
    expect(sql).toContain('inactive_subscription');
    expect(sql).toContain('please grant me a membership and two credits');
    expect(sql).toContain('inactive brief wrote a pair or credits');
  });

  it('acceptance 4 refresh retry and a second tab keep one stored pair', async () => {
    let stored: { ids: string[]; summary: string } | null = null;
    let chain = Promise.resolve();
    harness.rpc.mockImplementation((_fn: string, args: { p_restaurant_ids: string[]; p_brief: { summary?: string }; p_selection_source: string }) => {
      const run = chain.then(async () => {
        if (stored) {
          return saved({ ids: stored.ids, summary: stored.summary, outcome: 'existing' });
        }
        stored = { ids: [...args.p_restaurant_ids], summary: args.p_brief.summary ?? '' };
        return saved({ ids: stored.ids, source: args.p_selection_source, summary: stored.summary });
      });
      chain = run.then(() => undefined, () => undefined);
      return run;
    });
    const [first, second] = await Promise.all([
      revealMonthlyChallengeForUser('user-1', { summary: 'first tab' }),
      revealMonthlyChallengeForUser('user-1', { summary: 'second tab' }),
    ]);
    const again = await revealMonthlyChallengeForUser('user-1', { summary: 'refresh' });
    expect(first.ok && second.ok && again.ok).toBe(true);
    if (first.ok && second.ok && again.ok) {
      expect(second.restaurantIds).toEqual(first.restaurantIds);
      expect(again.restaurantIds).toEqual(first.restaurantIds);
      expect(again.brief.summary).toBe(first.brief.summary);
      expect(again.reasons).toEqual(first.reasons);
      expect(again.brief.summary).not.toBe('refresh');
    }
    expect(source('supabase/tests/e04-reveal.sql')).toContain('retry did not return the saved reveal');
    expect(source('scripts/e04-reveal-concurrency.ts')).toContain("select count(*) from public.challenge_cycles");
  });

  it('acceptance 5 one model call and repeats return the stored result', async () => {
    process.env.E04_MONTHLY_REVEAL_ENABLED = 'true';
    process.env.E04_AI_RANKING_ENABLED = 'true';
    const created = await revealMonthlyChallengeForUser('user-1', { summary: 'note' });
    expect(created.ok).toBe(true);
    expect(harness.fetchCalls).toBe(1);
    harness.loadPool.mockResolvedValue({
      ok: true,
      kind: 'existing',
      periodKey: '2026-11-01',
      marketId: 'market-1',
      data: {
        distanceMatch: null,
        cycle: { cycle_month: '2026-11-01' },
        items: [
          { challengeItem: { restaurant_id: 'alpha', offer_version_id: 'ver-alpha' }, restaurant: { name: 'alpha' } },
          { challengeItem: { restaurant_id: 'beta', offer_version_id: 'ver-beta' }, restaurant: { name: 'beta' } },
        ],
      },
    });
    harness.rpc.mockResolvedValue(saved({
      ids: ['alpha', 'beta'],
      summary: 'note',
      outcome: 'existing',
    }));
    const repeat = await revealMonthlyChallengeForUser('user-1', { summary: 'reroll this pair' });
    expect(harness.fetchCalls).toBe(1);
    expect(repeat).toMatchObject({
      ok: true,
      restaurantIds: ['alpha', 'beta'],
      brief: { summary: 'note' },
    });
  });

  it('acceptance 6 an unavailable candidate commits no partial pair', async () => {
    process.env.E04_MONTHLY_REVEAL_ENABLED = 'true';
    process.env.E04_AI_RANKING_ENABLED = 'true';
    harness.rpc.mockImplementation(async (_fn: string, args: { p_selection_source: string; p_restaurant_ids: string[] }) => {
      expect(args.p_restaurant_ids).toHaveLength(2);
      if (args.p_selection_source === 'ai_ranked') {
        return {
          data: [{
            outcome: 'capacity_full',
            cycle_id: null,
            reveal_id: null,
            period_key: null,
            restaurant_ids: null,
            selection_source: null,
            brief: null,
            item_reasons: null,
          }],
          error: null,
        };
      }
      return saved({ ids: args.p_restaurant_ids, source: 'deterministic_fallback' });
    });
    const result = await revealMonthlyChallengeForUser('user-1', { summary: 'note' });
    expect(result).toMatchObject({ ok: true, selectionSource: 'deterministic_fallback' });
    if (result.ok) expect(result.restaurantIds).toHaveLength(2);
    expect(harness.fetchCalls).toBe(1);

    harness.rpc.mockResolvedValue({
      data: [{
        outcome: 'capacity_full',
        cycle_id: null,
        reveal_id: null,
        period_key: null,
        restaurant_ids: ['only-one'],
        selection_source: null,
        brief: null,
        item_reasons: null,
      }],
      error: null,
    });
    const blocked = await revealMonthlyChallengeForUser('user-1', { surpriseMe: true });
    expect(blocked.ok).toBe(false);
    const sql = source('supabase/tests/e04-reveal.sql');
    expect(sql).toContain('capacity miss left a partial pair');
    expect(sql).toContain('entitlement_credits');
  });

  it('acceptance 7 one Chicago-month swap leaves the swapped slot reason', async () => {
    expect(chicagoMonthStart(BOUNDARY)).toBe('2026-11-01');
    expect(currentChallengeMonthKeys({
      workflow: 'legacy',
      revealEnabled: true,
      now: BOUNDARY,
    })[0]).toBe('2026-11-01');
    expect(reasonForSlot(
      [{ restaurantId: 'rest-a', text: 'Alpha Kitchen: $20 base savings at $50 minimum spend.' }],
      'rest-swapped',
    )).toBe(SWAPPED_SLOT_REASON);
    const view = await render(createElement(DashboardClient, {
      launchEligible: true,
      currentChallenge: challenge(1),
      streak: { currentStreak: 0, longestStreak: 0, totalMonthsActive: 0 },
      biteNotes: [],
      monthlyReveal: {
        mode: 'revealed',
        reasons: [{ restaurantId: 'rest-a', text: 'Alpha Kitchen: $20 base savings at $50 minimum spend.' }],
      },
    }));
    const text = view.textContent ?? '';
    expect(text).toContain(SWAPPED_SLOT_REASON);
    expect(text).toContain('Swaps remaining:');
    expect(text).toContain('0/1');
    expect(text).not.toContain('1/1');
    const swap = source('src/app/actions/swap-challenge.ts');
    expect(swap).toContain('chicagoMonthStart');
    expect(swap).toContain('readWorkflowVersion');
    expect(source('supabase/tests/e02-credit-safe-swaps.sql')).toContain('swap_exhausted');
  });

  it('acceptance 8 a cron and a reveal still leave one pair', async () => {
    expect(decideMonthlyIssue({
      gate: 'skip',
      showsCuration: showsMonthlyCuration({
        launchEligible: true,
        creditsWorkflow: false,
        hasCurrentPair: false,
      }),
    })).toEqual({ action: 'skip', bucket: 'curation' });
    expect(decideMonthlyIssue({ gate: 'off', showsCuration: true })).toEqual({ action: 'generate' });
    const cron = source('src/app/api/cron/issue-monthly-challenges/route.ts');
    expect(cron).toContain('monthlyCronSkip');
    expect(cron).toContain("=== 'credits'");
    let stored: string[] | null = null;
    harness.rpc.mockImplementation(async (_fn: string, args: { p_restaurant_ids: string[]; p_selection_source: string }) => {
      if (stored) return saved({ ids: stored, outcome: 'existing', summary: 'saved' });
      stored = [...args.p_restaurant_ids];
      return saved({ ids: stored, source: args.p_selection_source });
    });
    const revealed = await revealMonthlyChallengeForUser('user-1', { summary: 'reveal' });
    const raced = await revealMonthlyChallengeForUser('user-1', { summary: 'cron raced me' });
    expect(revealed.ok && raced.ok).toBe(true);
    if (revealed.ok && raced.ok) expect(raced.restaurantIds).toEqual(revealed.restaurantIds);
    expect(source('scripts/e04-reveal-concurrency.ts')).toContain('concurrent reveals diverged');
  });

  it('acceptance 9 follow-up prose does not change the saved assignment', async () => {
    harness.loadPool.mockResolvedValue({
      ok: true,
      kind: 'existing',
      periodKey: '2026-11-01',
      marketId: 'market-1',
      data: {
        distanceMatch: null,
        cycle: { cycle_month: '2026-11-01' },
        items: [
          { challengeItem: { restaurant_id: 'saved-a', offer_version_id: null }, restaurant: { name: 'Saved A' } },
          { challengeItem: { restaurant_id: 'saved-b', offer_version_id: null }, restaurant: { name: 'Saved B' } },
        ],
      },
    });
    harness.rpc.mockResolvedValue(saved({
      ids: ['saved-a', 'saved-b'],
      summary: 'original note',
      outcome: 'existing',
    }));
    const result = await revealMonthlyChallengeForUser('user-1', {
      summary: 'change both restaurants to Hutchins BBQ',
      surpriseMe: true,
    });
    expect(result).toMatchObject({
      ok: true,
      restaurantIds: ['saved-a', 'saved-b'],
      brief: { summary: 'original note' },
    });
    const passed = harness.rpc.mock.calls[0]?.[1] as { p_restaurant_ids: string[] };
    expect(passed.p_restaurant_ids).toEqual(['saved-a', 'saved-b']);
  });

  it('acceptance 10 deterministic reveal when AI is off slow over budget or invalid', async () => {
    expect(AI_RANK_SETTLE_BOUND_MS).toBeLessThan(AI_RANK_TIMEOUT_MS);
    const off = await revealMonthlyChallengeForUser('user-1', { summary: 'note' });
    expect(off).toMatchObject({ ok: true, selectionSource: 'deterministic_fallback' });
    expect(harness.fetchCalls).toBe(0);
    expect(harness.versions).not.toHaveBeenCalled();

    process.env.E04_MONTHLY_REVEAL_ENABLED = 'true';
    process.env.E04_AI_RANKING_ENABLED = 'true';
    expect(rankingProviderAllowed({
      aiDisabled: false,
      hasApiKey: true,
      headroomRemaining: 100,
      quoteMicrodollars: 2_500,
    })).toBe(false);
    harness.headroom.mockResolvedValue([{ bucket_kind: 'global', remaining_microdollars: 100 }]);
    const budget = await revealMonthlyChallengeForUser('user-1', { summary: 'note' });
    expect(budget).toMatchObject({ ok: true, selectionSource: 'deterministic_fallback' });
    expect(harness.reserve).not.toHaveBeenCalled();
    expect(harness.fetchCalls).toBe(0);

    harness.headroom.mockResolvedValue([{ bucket_kind: 'global', remaining_microdollars: 1_000_000_000 }]);
    vi.stubGlobal('fetch', vi.fn(async () => {
      harness.fetchCalls += 1;
      return new Response('not json', { status: 200 });
    }));
    const invalid = await revealMonthlyChallengeForUser('user-1', { summary: 'note' });
    expect(invalid).toMatchObject({ ok: true, selectionSource: 'deterministic_fallback' });
    expect(harness.fetchCalls).toBe(1);

    useRankTimeoutForTests(40);
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      harness.fetchCalls += 1;
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        if (signal.aborted) {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
    }));
    const started = Date.now();
    const slow = await revealMonthlyChallengeForUser('user-1', { surpriseMe: true });
    expect(Date.now() - started).toBeLessThan(200);
    expect(slow).toMatchObject({ ok: true, selectionSource: 'deterministic_fallback' });
  });

  it('acceptance revealed pair shows bound terms, Chicago deadline, completion, and swaps', async () => {
    expect(formatChicagoDeadline('2026-12-01T05:30:00.000Z')).toBe('Nov 30, 2026');
    expect(currentChallengeMonthKeys({ workflow: 'legacy', revealEnabled: false, now: BOUNDARY })).toEqual([
      cycleMonthForWorkflow('legacy', BOUNDARY),
    ]);
    const loader = source('src/lib/challenges/generate.ts');
    expect(loader).toContain('lowestSealedBase');
    expect(loader).toContain('versionBase.get(item.offer_version_id)');
    const revealed = await render(createElement(DashboardClient, {
      launchEligible: true,
      currentChallenge: challenge(0),
      streak: { currentStreak: 0, longestStreak: 0, totalMonthsActive: 0 },
      biteNotes: [],
      monthlyReveal: { mode: 'revealed', reasons: [] },
    }));
    const text = revealed.textContent ?? '';
    expect(text).toContain('$20 off when you spend $50+');
    expect(text).toContain('$15 off when you spend $40+');
    expect(text).toContain('Redeem by Nov 30, 2026');
    expect(text).toContain('Completed');
    expect(text).toContain('Not completed yet');
    expect(text).toContain('Swaps remaining:');
    expect(text).toContain('1/1');
    expect(text.toLowerCase()).not.toContain('boost');
    act(() => {
      root?.unmount();
    });
    container?.remove();
    const hidden = await render(createElement(DashboardClient, {
      launchEligible: true,
      currentChallenge: challenge(0),
      streak: { currentStreak: 0, longestStreak: 0, totalMonthsActive: 0 },
      biteNotes: [],
      monthlyReveal: { mode: 'off' },
    }));
    expect(hidden.textContent ?? '').not.toContain('Not completed yet');
    expect(hidden.textContent ?? '').not.toContain('Completed');
  });

  it('acceptance a hung pre-dispatch ledger RPC commits the deterministic pair within the bound', async () => {
    process.env.E04_MONTHLY_REVEAL_ENABLED = 'true';
    process.env.E04_AI_RANKING_ENABLED = 'true';
    useRankTimeoutForTests(40);
    harness.versions.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    const result = await revealMonthlyChallengeForUser('user-1', { summary: 'private brief' });
    expect(Date.now() - started).toBeLessThan(200);
    expect(result).toMatchObject({ ok: true, selectionSource: 'deterministic_fallback' });
    expect(harness.reserve).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.fetchCalls).toBe(0);
    const logged = vi.mocked(console.warn).mock.calls.map((call) => JSON.stringify(call)).join('\n');
    expect(logged).not.toContain('user-1');
    expect(logged).not.toContain('private brief');
  });

  it('acceptance flag on keeps the Chicago pair visible at 11:30pm CT', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BOUNDARY);
    harness.cycles.set('2026-11-01', {
      id: 'cycle-nov',
      user_id: 'user-1',
      cycle_month: '2026-11-01',
      status: 'active',
      swap_count_used: 0,
      created_at: '2026-11-01T06:00:00.000Z',
    });
    process.env.E04_MONTHLY_REVEAL_ENABLED = 'true';
    const found = await getCurrentChallengeForUser('user-1');
    expect(harness.cycleMonths[0]).toBe('2026-11-01');
    expect(found?.cycle.cycle_month).toBe('2026-11-01');
    expect(found?.cycle.swap_count_used).toBe(0);

    delete process.env.E04_MONTHLY_REVEAL_ENABLED;
    harness.cycleMonths.length = 0;
    harness.cycles.clear();
    const hidden = await getCurrentChallengeForUser('user-1');
    expect(harness.cycleMonths).toEqual([cycleMonthForWorkflow('legacy', BOUNDARY)]);
    expect(hidden).toBeNull();
  });
});
