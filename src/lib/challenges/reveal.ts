import { randomInt } from 'node:crypto';
import { pickDistinctRestaurants } from '@/lib/challenges/distance-pool';
import {
  loadMonthlyChallengePool,
  type GenerateFailureReason,
} from '@/lib/challenges/generate';
import { aiRankingEnabled, rankMonthlyReveal, REVEAL_AI_SOURCE_VERSION } from '@/lib/challenges/ai-rank';
import { REVEAL_LABEL_CAP, REVEAL_SUMMARY_CAP } from '@/lib/challenges/monthly-reveal-copy';
import { firstRpcRow } from '@/lib/challenges/rpc';
import { chicagoMonthStart } from '@/lib/cron-period';
import { formatCents } from '@/lib/offers/sealed-base';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { Json } from '@/types/database.types';

export { REVEAL_LABEL_CAP, REVEAL_SUMMARY_CAP };
export const REVEAL_SOURCE_VERSION = 'e04b.deterministic.v1';

export type RevealSelectionSource = 'deterministic_fallback' | 'ai_ranked' | 'legacy_generate';

export type RevealBriefInput = {
  occasion?: string | null;
  discoveryLevel?: string | null;
  summary?: string | null;
  surpriseMe?: boolean;
};

export type StoredRevealBrief = {
  occasion: string;
  discovery_level: string;
  summary: string;
  surprise_me: boolean;
};

export type RevealReason = {
  restaurantId: string;
  templateId: 'deterministic_pair_v1' | 'legacy_pair_v1' | 'ai_pair_v1';
  text: string;
};

export type RevealChallengeResult =
  | {
      ok: true;
      cycleId: string;
      revealId: string;
      periodKey: string;
      restaurantIds: string[];
      selectionSource: RevealSelectionSource;
      brief: StoredRevealBrief;
      reasons: RevealReason[];
    }
  | { ok: false; error: string; reason: GenerateFailureReason | 'retryable' };

const THIN_POOL_ERROR =
  'No eligible restaurants found within your travel distance. Try a wider distance or check dietary preferences.';

function clip(value: string | null | undefined, cap: number): string {
  return (value ?? '').slice(0, cap);
}

/** Plain text only. Length is capped. The words are not instructions. */
export function normalizeRevealBrief(input: RevealBriefInput): StoredRevealBrief {
  return {
    occasion: clip(input.occasion, REVEAL_LABEL_CAP),
    discovery_level: clip(input.discoveryLevel, REVEAL_LABEL_CAP),
    summary: clip(input.summary, REVEAL_SUMMARY_CAP),
    surprise_me: input.surpriseMe === true,
  };
}

export function revealCycleMonth(args: {
  versionBacked: boolean;
  chicagoPeriod: string;
  utcPeriod: string;
}): string {
  return args.versionBacked ? args.chicagoPeriod : args.utcPeriod;
}

/** November still, at 2026-11-30 23:30 America/Chicago. */
export function chicagoRevealPeriod(now: Date): string {
  return chicagoMonthStart(now);
}

function shuffle<T>(array: T[]): T[] {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The brief is not an argument. Surprise Me and a free-text note share this list.
 */
export function selectRevealPair<T extends { id: string; cuisine_tags: string[] | null }>(
  candidates: readonly T[],
  wantsCocktailExperience: boolean,
  shuffleRows: (items: T[]) => T[] = shuffle,
): T[] {
  return pickDistinctRestaurants([...candidates], 2, {
    reserveCocktail: wantsCocktailExperience,
    shuffle: shuffleRows,
  });
}

export function deterministicRevealReason(args: {
  restaurantId: string;
  name: string;
  baseSavingsCents: number;
  minSpendCents: number;
  zipDistanceExpanded: boolean;
}): RevealReason {
  const band = args.zipDistanceExpanded
    ? 'Wider ZIP-distance band.'
    : 'Inside your ZIP-distance band.';
  return {
    restaurantId: args.restaurantId,
    templateId: 'deterministic_pair_v1',
    text: `${args.name}: ${formatCents(args.baseSavingsCents)} base savings at ${formatCents(args.minSpendCents)} minimum spend. ${band}`,
  };
}

export function legacyRevealReason(restaurantId: string, name: string): RevealReason {
  return {
    restaurantId,
    templateId: 'legacy_pair_v1',
    text: `${name} was already your challenge for this month.`,
  };
}

type RevealRpcRow = {
  outcome: string | null;
  cycle_id: string | null;
  reveal_id: string | null;
  period_key: string | null;
  restaurant_ids: string[] | null;
  selection_source: string | null;
  brief: Json | null;
  item_reasons: Json | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function briefFromSaved(value: Json | null): StoredRevealBrief | null {
  if (!isRecord(value)) return null;
  if (typeof value.summary !== 'string' || typeof value.surprise_me !== 'boolean') return null;
  return {
    occasion: typeof value.occasion === 'string' ? value.occasion : '',
    discovery_level: typeof value.discovery_level === 'string' ? value.discovery_level : '',
    summary: value.summary,
    surprise_me: value.surprise_me,
  };
}

function reasonsFromSaved(value: Json | null): RevealReason[] | null {
  if (!Array.isArray(value)) return null;
  const reasons: RevealReason[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.restaurant_id !== 'string' || typeof entry.text !== 'string') {
      return null;
    }
    const templateId =
      entry.template_id === 'legacy_pair_v1' || entry.template_id === 'ai_pair_v1'
        ? entry.template_id
        : 'deterministic_pair_v1';
    reasons.push({ restaurantId: entry.restaurant_id, templateId, text: entry.text });
  }
  return reasons;
}

function sourceFromSaved(value: string | null): RevealSelectionSource | null {
  if (value === 'deterministic_fallback' || value === 'ai_ranked' || value === 'legacy_generate') return value;
  return null;
}

function retryable(outcome: string): RevealChallengeResult {
  if (outcome === 'capacity_full') {
    return { ok: false, error: 'A restaurant in this pair is at capacity.', reason: 'retryable' };
  }
  if (outcome === 'below_floor') {
    return {
      ok: false,
      error: 'A restaurant is below the $10 minimum savings floor.',
      reason: 'retryable',
    };
  }
  if (outcome === 'inactive_subscription') {
    return {
      ok: false,
      error: 'An active Wanderbite subscription is required to generate challenges.',
      reason: 'inactive_subscription',
    };
  }
  if (outcome === 'local_month_not_open') {
    return { ok: false, error: 'This offer pair opens on the Chicago month.', reason: 'waiting_for_local_month' };
  }
  if (outcome === 'incomplete_cycle') {
    return { ok: false, error: 'Failed to create challenge items.', reason: 'incomplete_cycle' };
  }
  return { ok: false, error: THIN_POOL_ERROR, reason: 'retryable' };
}

export async function revealMonthlyChallengeForUser(
  userId: string,
  briefInput: RevealBriefInput,
): Promise<RevealChallengeResult> {
  const brief = normalizeRevealBrief(briefInput);
  try {
    const pool = await loadMonthlyChallengePool(userId);
    if (!pool.ok) return pool;

    let periodKey = pool.kind === 'existing' ? pool.periodKey : pool.chicagoPeriod;
    const marketId = pool.marketId;
    let restaurantIds: string[] = [];
    let reasons: RevealReason[] = [];
    let source: RevealSelectionSource = 'deterministic_fallback';
    let sourceVersion = REVEAL_SOURCE_VERSION;
    let offerVersionIds: Array<string | null> = [];
    let zipDistanceExpanded = false;
    let deterministicCommit: {
      periodKey: string;
      restaurantIds: string[];
      offerVersionIds: Array<string | null>;
      reasons: RevealReason[];
    } | null = null;

    if (pool.kind === 'existing') {
      source = 'legacy_generate';
      zipDistanceExpanded = pool.data.distanceMatch?.expanded ?? false;
      restaurantIds = pool.data.items.map((item) => item.challengeItem.restaurant_id);
      offerVersionIds = pool.data.items.map((item) => item.challengeItem.offer_version_id ?? null);
      reasons = pool.data.items.map((item) =>
        legacyRevealReason(item.challengeItem.restaurant_id, item.restaurant.name),
      );
    } else {
      if (pool.candidates.length < 2) {
        return { ok: false, error: THIN_POOL_ERROR, reason: 'thin_pool' };
      }
      const byId = new Map(pool.candidates.map((candidate) => [candidate.restaurantId, candidate]));
      const deterministicRows = selectRevealPair(
        pool.candidates.map((candidate) => candidate.restaurant),
        pool.wantsCocktailExperience,
      );
      const deterministic = deterministicRows.flatMap((row) => {
        const candidate = byId.get(row.id);
        return candidate ? [candidate] : [];
      });
      if (deterministic.length < 2) {
        return { ok: false, error: THIN_POOL_ERROR, reason: 'thin_pool' };
      }
      const ranked = aiRankingEnabled()
        ? await rankMonthlyReveal({
            brief,
            userId,
            candidates: pool.candidates.map((candidate) => ({
              id: candidate.restaurantId,
              name: candidate.restaurant.name,
              cuisines: candidate.restaurant.cuisine_tags ?? [],
              distanceTier: candidate.distanceTier,
              baseSavingsCents: candidate.baseSavingsCents,
              minSpendCents: candidate.minSpendCents,
            })),
          })
        : null;
      const rankedSelected = ranked
        ? ranked.picks.flatMap((pick) => {
            const candidate = byId.get(pick.restaurantId);
            return candidate ? [candidate] : [];
          })
        : [];
      const usingRank = rankedSelected.length === 2;
      const selected = usingRank ? rankedSelected : deterministic;
      const versionBacked = selected.some((candidate) => candidate.offerVersionId);
      periodKey = revealCycleMonth({
        versionBacked,
        chicagoPeriod: pool.chicagoPeriod,
        utcPeriod: pool.utcPeriod,
      });
      zipDistanceExpanded = pool.zipDistanceExpanded;
      restaurantIds = selected.map((candidate) => candidate.restaurantId);
      offerVersionIds = selected.map((candidate) => candidate.offerVersionId);
      source = usingRank ? 'ai_ranked' : 'deterministic_fallback';
      sourceVersion = usingRank ? REVEAL_AI_SOURCE_VERSION : REVEAL_SOURCE_VERSION;
      reasons = usingRank && ranked
        ? ranked.picks.map((pick) => ({
            restaurantId: pick.restaurantId,
            templateId: 'ai_pair_v1' as const,
            text: pick.reason,
          }))
        : selected.map((candidate) =>
            deterministicRevealReason({
              restaurantId: candidate.restaurantId,
              name: candidate.restaurant.name,
              baseSavingsCents: candidate.baseSavingsCents,
              minSpendCents: candidate.minSpendCents,
              zipDistanceExpanded,
            }),
          );
      deterministicCommit = {
        periodKey: revealCycleMonth({
          versionBacked: deterministic.some((candidate) => candidate.offerVersionId),
          chicagoPeriod: pool.chicagoPeriod,
          utcPeriod: pool.utcPeriod,
        }),
        restaurantIds: deterministic.map((candidate) => candidate.restaurantId),
        offerVersionIds: deterministic.map((candidate) => candidate.offerVersionId),
        reasons: deterministic.map((candidate) =>
          deterministicRevealReason({
            restaurantId: candidate.restaurantId,
            name: candidate.restaurant.name,
            baseSavingsCents: candidate.baseSavingsCents,
            minSpendCents: candidate.minSpendCents,
            zipDistanceExpanded: pool.zipDistanceExpanded,
          }),
        ),
      };
    }

    const supabase = getSupabaseAdmin();
    let { data, error } = await supabase.rpc('reveal_monthly_challenge', {
      p_user_id: userId,
      p_cycle_month: periodKey,
      p_market_id: marketId,
      p_restaurant_ids: restaurantIds,
      p_brief: brief as unknown as Json,
      p_selection_source: source === 'legacy_generate' ? 'deterministic_fallback' : source,
      p_item_reasons: reasons.map((reason) => ({
        restaurant_id: reason.restaurantId,
        template_id: reason.templateId,
        text: reason.text,
      })) as unknown as Json,
      p_eligibility_facts: {
        offer_version_ids: offerVersionIds,
        zip_distance_expanded: zipDistanceExpanded,
      } as unknown as Json,
      p_source_version: sourceVersion,
    });
    if (error && source === 'ai_ranked' && deterministicCommit) {
      source = 'deterministic_fallback';
      sourceVersion = REVEAL_SOURCE_VERSION;
      periodKey = deterministicCommit.periodKey;
      restaurantIds = deterministicCommit.restaurantIds;
      offerVersionIds = deterministicCommit.offerVersionIds;
      reasons = deterministicCommit.reasons;
      const retry = await supabase.rpc('reveal_monthly_challenge', {
        p_user_id: userId,
        p_cycle_month: periodKey,
        p_market_id: marketId,
        p_restaurant_ids: restaurantIds,
        p_brief: brief as unknown as Json,
        p_selection_source: 'deterministic_fallback',
        p_item_reasons: reasons.map((reason) => ({
          restaurant_id: reason.restaurantId,
          template_id: reason.templateId,
          text: reason.text,
        })) as unknown as Json,
        p_eligibility_facts: {
          offer_version_ids: offerVersionIds,
          zip_distance_expanded: zipDistanceExpanded,
        } as unknown as Json,
        p_source_version: REVEAL_SOURCE_VERSION,
      });
      if (retry.error) {
        return { ok: false, error: 'Could not save your challenges. Please try again.', reason: 'retryable' };
      }
      data = retry.data;
      error = null;
    }
    if (error) {
      return { ok: false, error: 'Could not save your challenges. Please try again.', reason: 'retryable' };
    }
    let row = firstRpcRow(data as RevealRpcRow[] | RevealRpcRow | null);
    const rejected = row?.outcome === 'capacity_full' || row?.outcome === 'below_floor' || row?.outcome === 'invalid_restaurants';
    if (rejected && source === 'ai_ranked' && deterministicCommit) {
      console.warn('[challenges] reveal ranking candidate was not committed', { outcome: row?.outcome });
      const retry = await supabase.rpc('reveal_monthly_challenge', {
        p_user_id: userId,
        p_cycle_month: deterministicCommit.periodKey,
        p_market_id: marketId,
        p_restaurant_ids: deterministicCommit.restaurantIds,
        p_brief: brief as unknown as Json,
        p_selection_source: 'deterministic_fallback',
        p_item_reasons: deterministicCommit.reasons.map((reason) => ({
          restaurant_id: reason.restaurantId,
          template_id: reason.templateId,
          text: reason.text,
        })) as unknown as Json,
        p_eligibility_facts: {
          offer_version_ids: deterministicCommit.offerVersionIds,
          zip_distance_expanded: zipDistanceExpanded,
        } as unknown as Json,
        p_source_version: REVEAL_SOURCE_VERSION,
      });
      if (retry.error) {
        return { ok: false, error: 'Could not save your challenges. Please try again.', reason: 'retryable' };
      }
      row = firstRpcRow(retry.data as RevealRpcRow[] | RevealRpcRow | null);
    }
    const savedBrief = briefFromSaved(row?.brief ?? null);
    const savedReasons = reasonsFromSaved(row?.item_reasons ?? null);
    const savedSource = sourceFromSaved(row?.selection_source ?? null);
    if (
      !row?.cycle_id ||
      !row.reveal_id ||
      !row.period_key ||
      !row.restaurant_ids ||
      row.restaurant_ids.length < 2 ||
      !savedBrief ||
      !savedReasons ||
      !savedSource
    ) {
      if (row?.outcome === 'capacity_full' || row?.outcome === 'below_floor' || row?.outcome === 'invalid_restaurants') {
        console.warn('[challenges] reveal rpc rejected a service candidate', {
          outcome: row.outcome,
        });
      }
      return retryable(row?.outcome ?? 'invalid_restaurants');
    }
    return {
      ok: true,
      cycleId: row.cycle_id,
      revealId: row.reveal_id,
      periodKey: row.period_key,
      restaurantIds: row.restaurant_ids,
      selectionSource: savedSource,
      brief: savedBrief,
      reasons: savedReasons,
    };
  } catch {
    return { ok: false, error: 'Could not save your challenges. Please try again.', reason: 'retryable' };
  }
}
