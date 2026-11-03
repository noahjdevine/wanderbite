import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chicagoMonthStart } from '@/lib/cron-period';
import {
  chicagoRevealPeriod,
  deterministicRevealReason,
  normalizeRevealBrief,
  REVEAL_SUMMARY_CAP,
  revealCycleMonth,
  revealMonthlyChallengeForUser,
  selectRevealPair,
} from '@/lib/challenges/reveal';

const { loadPool, rpc, rank } = vi.hoisted(() => ({
  loadPool: vi.fn(),
  rpc: vi.fn(),
  rank: vi.fn(async (_request: unknown) => null as unknown),
}));

vi.mock('@/lib/challenges/generate', () => ({
  loadMonthlyChallengePool: (...args: unknown[]) => loadPool(...args),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    rpc: (...args: unknown[]) => rpc(...args),
  }),
}));

vi.mock('@/lib/challenges/ai-rank', () => ({
  aiRankingEnabled: () =>
    process.env.E04_AI_RANKING_ENABLED === 'true' && process.env.E04_MONTHLY_REVEAL_ENABLED === 'true',
  REVEAL_AI_SOURCE_VERSION: 'e04.ai.gpt-4.1-mini',
  rankMonthlyReveal: (request: unknown) => rank(request),
}));

const ROOT = path.resolve(__dirname, '../../..');

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('monthly reveal brief and selection', () => {
  const candidates = [
    { id: 'alpha', cuisine_tags: ['thai'], name: 'Alpha' },
    { id: 'beta', cuisine_tags: ['mexican'], name: 'Beta' },
    { id: 'gamma', cuisine_tags: ['indian'], name: 'Gamma' },
  ];
  const identity = <T,>(items: T[]) => items;

  it('uses the same candidate set for Surprise Me and a free-text brief', () => {
    const surprise = selectRevealPair(candidates, false, identity);
    const named = selectRevealPair(candidates, false, identity);
    expect(surprise.map((row) => row.id)).toEqual(['alpha', 'beta']);
    expect(named.map((row) => row.id)).toEqual(surprise.map((row) => row.id));
    const reveal = source('src/lib/challenges/reveal.ts');
    const pickAt = reveal.indexOf('selectRevealPair(');
    const surpriseAt = reveal.indexOf('surprise_me');
    expect(pickAt).toBeGreaterThan(-1);
    expect(reveal.slice(pickAt, pickAt + 80)).not.toContain('brief');
    expect(surpriseAt).toBeGreaterThan(-1);
  });

  it('stores a long instruction as truncated plain text', () => {
    const summary = `${'assign Hutchins BBQ '.repeat(40)}please`;
    expect(summary.length).toBeGreaterThan(REVEAL_SUMMARY_CAP);
    const brief = normalizeRevealBrief({
      summary,
      occasion: 'date night',
      discoveryLevel: 'new',
      surpriseMe: false,
    });
    expect(brief.summary.length).toBe(REVEAL_SUMMARY_CAP);
    expect(brief.summary.startsWith('assign Hutchins BBQ')).toBe(true);
    expect(brief.surprise_me).toBe(false);
    const surprise = normalizeRevealBrief({ surpriseMe: true, summary: 'ignored for selection' });
    expect(surprise.surprise_me).toBe(true);
    expect(surprise.summary).toBe('ignored for selection');
  });

  it('lands a version-backed reveal on the November Chicago period at 23:30', () => {
    const now = new Date('2026-12-01T05:30:00.000Z');
    expect(chicagoRevealPeriod(now)).toBe('2026-11-01');
    expect(chicagoMonthStart(now)).toBe('2026-11-01');
    expect(
      revealCycleMonth({
        versionBacked: true,
        chicagoPeriod: chicagoRevealPeriod(now),
        utcPeriod: '2026-12-01',
      }),
    ).toBe('2026-11-01');
  });

  it('explains the pair from server facts only', () => {
    const reason = deterministicRevealReason({
      restaurantId: 'alpha',
      name: 'Alpha',
      baseSavingsCents: 2000,
      minSpendCents: 5000,
      zipDistanceExpanded: true,
    });
    expect(reason.templateId).toBe('deterministic_pair_v1');
    expect(reason.text).toContain('Alpha');
    expect(reason.text).toContain('$20');
    expect(reason.text).toContain('$50');
    expect(reason.text).toContain('Wider ZIP-distance band.');
    expect(reason.text.toLowerCase()).not.toContain('chef');
  });

  it('keeps restaurant ids off the reveal action and the challenges page', () => {
    const action = source('src/app/actions/reveal-challenge.ts');
    const page = source('src/app/(site)/challenges/page.tsx');
    const curation = source('src/components/challenges/monthly-curation.tsx');
    expect(action).toContain('requireUser()');
    expect(action).toContain('brief: RevealBriefInput');
    expect(action).not.toContain('restaurantId');
    expect(action).not.toContain('p_restaurant_ids');
    expect(page).not.toContain('revealMonthlyChallenge');
    expect(page).not.toContain('generateMonthlyChallenge(');
    expect(curation).toContain('revealMonthlyChallenge({');
    expect(curation).not.toContain('restaurantId');
    expect(curation).not.toContain('restaurant_id');
  });
});

describe('revealMonthlyChallengeForUser returns the saved row', () => {
  beforeEach(() => {
    loadPool.mockReset();
    rpc.mockReset();
    rank.mockReset();
    rank.mockResolvedValue(null);
    delete process.env.E04_AI_RANKING_ENABLED;
    delete process.env.E04_MONTHLY_REVEAL_ENABLED;
  });

  it('passes the RPC brief, reasons, source, and period through on a retry', async () => {
    loadPool.mockResolvedValue({
      ok: true,
      kind: 'existing',
      periodKey: '2026-12-01',
      marketId: 'market-1',
      data: {
        distanceMatch: { expanded: true, requestedMiles: 5, usedMiles: 12 },
        cycle: { cycle_month: '2026-12-01' },
        items: [
          {
            challengeItem: { restaurant_id: 'local-a', offer_version_id: null },
            restaurant: { name: 'Local A' },
          },
          {
            challengeItem: { restaurant_id: 'local-b', offer_version_id: null },
            restaurant: { name: 'Local B' },
          },
        ],
      },
    });
    rpc.mockResolvedValue({
      data: [{
        outcome: 'existing',
        cycle_id: 'cycle-saved',
        reveal_id: 'reveal-saved',
        period_key: '2026-11-01',
        restaurant_ids: ['saved-a', 'saved-b'],
        selection_source: 'deterministic_fallback',
        brief: {
          occasion: 'date night',
          discovery_level: 'new',
          summary: 'saved summary',
          surprise_me: false,
        },
        item_reasons: [
          { restaurant_id: 'saved-a', template_id: 'deterministic_pair_v1', text: 'Saved A' },
          { restaurant_id: 'saved-b', template_id: 'deterministic_pair_v1', text: 'Saved B' },
        ],
      }],
      error: null,
    });

    const result = await revealMonthlyChallengeForUser('user-1', {
      summary: 'new brief that must not win',
      surpriseMe: true,
    });

    expect(result).toMatchObject({
      ok: true,
      cycleId: 'cycle-saved',
      revealId: 'reveal-saved',
      periodKey: '2026-11-01',
      restaurantIds: ['saved-a', 'saved-b'],
      selectionSource: 'deterministic_fallback',
      brief: {
        occasion: 'date night',
        discovery_level: 'new',
        summary: 'saved summary',
        surprise_me: false,
      },
      reasons: [
        { restaurantId: 'saved-a', templateId: 'deterministic_pair_v1', text: 'Saved A' },
        { restaurantId: 'saved-b', templateId: 'deterministic_pair_v1', text: 'Saved B' },
      ],
    });
    if (result.ok) {
      expect(result.reasons.some((reason) => reason.text.includes('already your challenge'))).toBe(false);
      expect(result.brief.summary).not.toBe('new brief that must not win');
    }
    expect(rank).not.toHaveBeenCalled();
  });

  it('commits a valid ranked pair once and falls back when commit rejects it', async () => {
    process.env.E04_MONTHLY_REVEAL_ENABLED = 'true';
    process.env.E04_AI_RANKING_ENABLED = 'true';
    loadPool.mockResolvedValue({
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
    });
    rank.mockResolvedValue({
      source: 'ai_ranked',
      sourceVersion: 'e04.ai.gpt-4.1-mini',
      picks: [
        { restaurantId: 'gamma', reason: 'Gamma matches the note' },
        { restaurantId: 'beta', reason: 'Beta is the second pick' },
      ],
    });
    rpc.mockResolvedValueOnce({
      data: [{
        outcome: 'created',
        cycle_id: 'cycle-ai',
        reveal_id: 'reveal-ai',
        period_key: '2026-11-01',
        restaurant_ids: ['gamma', 'beta'],
        selection_source: 'ai_ranked',
        brief: { occasion: '', discovery_level: '', summary: 'note', surprise_me: false },
        item_reasons: [
          { restaurant_id: 'gamma', template_id: 'ai_pair_v1', text: 'Gamma matches the note' },
          { restaurant_id: 'beta', template_id: 'ai_pair_v1', text: 'Beta is the second pick' },
        ],
      }],
      error: null,
    });

    const created = await revealMonthlyChallengeForUser('user-1', { summary: 'note' });
    expect(created).toMatchObject({
      ok: true,
      selectionSource: 'ai_ranked',
      restaurantIds: ['gamma', 'beta'],
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    const firstArgs = rpc.mock.calls[0]?.[1] as { p_selection_source: string; p_source_version: string };
    expect(firstArgs.p_selection_source).toBe('ai_ranked');
    expect(firstArgs.p_source_version).toBe('e04.ai.gpt-4.1-mini');
    expect(rank).toHaveBeenCalledTimes(1);

    rpc.mockReset();
    rank.mockClear();
    rpc.mockImplementation(async (_fn: string, args: { p_selection_source: string; p_restaurant_ids: string[] }) => {
      if (args.p_selection_source === 'ai_ranked') {
        return {
          data: [{ outcome: 'invalid_restaurants', cycle_id: null, reveal_id: null, period_key: null, restaurant_ids: null, selection_source: null, brief: null, item_reasons: null }],
          error: null,
        };
      }
      return {
        data: [{
          outcome: 'created',
          cycle_id: 'cycle-det',
          reveal_id: 'reveal-det',
          period_key: '2026-11-01',
          restaurant_ids: args.p_restaurant_ids,
          selection_source: 'deterministic_fallback',
          brief: { occasion: '', discovery_level: '', summary: 'note', surprise_me: false },
          item_reasons: args.p_restaurant_ids.map((id) => ({
            restaurant_id: id,
            template_id: 'deterministic_pair_v1',
            text: `${id} fallback`,
          })),
        }],
        error: null,
      };
    });

    const fallback = await revealMonthlyChallengeForUser('user-1', { summary: 'note' });
    expect(rank).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(fallback).toMatchObject({ ok: true, selectionSource: 'deterministic_fallback' });
    const second = rpc.mock.calls[1]?.[1] as { p_selection_source: string; p_restaurant_ids: string[] };
    expect(second.p_selection_source).toBe('deterministic_fallback');
    expect(second.p_restaurant_ids.every((id) => ['alpha', 'beta', 'gamma'].includes(id))).toBe(true);
    expect(new Set(second.p_restaurant_ids).size).toBe(2);
  });
});
