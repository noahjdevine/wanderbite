import type { DiscoverFallbackReason } from '@/lib/discover/fallback-reason';

/**
 * Discover stream contract from design-handoff/BEA_AI_SPEC.md section 4.
 *
 * Step mapping for the live `/api/roulette` pipeline:
 * - parse: validated message plus the chips and saved dietary flags the route already merges.
 *   Dietary constraints are required. Free text is not turned into extra chips.
 * - filter: active launch-market partners after the dietary and exclusion filters.
 *   `total` is that pool. `sample` is the first three, in query order.
 * - memory: omitted. This pipeline does not read verified visits, ratings, or notes.
 * - rank: omitted. The model returns one restaurant id, and a random fallback draws one.
 *   Nothing stores a runner-up, so there is no rank step and no runnerUp.
 * - pick: only when `selectionMode` is `ai`. matched / unknown / unmet come from the
 *   parsed constraints and the chosen row. `isNewToMember` stays false because
 *   redemption history is not loaded.
 * - fallback: a random pick. `alternative` is that restaurant, labeled as an alternative.
 *   The spec's fallback object has no partner; `alternative` is how Phase 2.1c can
 *   render the same restaurant `/api/roulette` returns without calling it a match.
 */

export type ConstraintKey =
  | 'cuisine'
  | 'vibe'
  | 'occasion'
  | 'budget'
  | 'dietary'
  | 'time'
  | 'area';

export type Constraint = {
  key: ConstraintKey;
  label: string;
  required: boolean;
};

export type PartnerLite = {
  id: string;
  name: string;
  cuisine?: string;
  neighborhood?: string;
  photoUrl?: string;
  photoCredit?: string;
};

export type DiscoverOffer = {
  /** Lowest-tier discount, in cents. */
  amountOff: number;
  /** Lowest-tier minimum spend, in cents. */
  minSpend: number;
};

export type DiscoverFood =
  | 'sushi'
  | 'pizza'
  | 'taco'
  | 'dumpling'
  | 'burger'
  | 'bbq'
  | 'generic';

export type DiscoverStreamReason = 'no_match' | 'provider_error' | 'timeout';

export type DiscoverEvent =
  | { type: 'step'; id: 'parse'; label: string; constraints: Constraint[] }
  | {
      type: 'step';
      id: 'filter';
      label: string;
      detail: string;
      sample: PartnerLite[];
      total: number;
    }
  | { type: 'step'; id: 'memory'; label: string; line: string }
  | {
      type: 'step';
      id: 'rank';
      label: string;
      winner: PartnerLite;
      runnerUp?: PartnerLite;
      winnerTag: 'New to you' | 'A favorite';
      runnerUpTag?: string;
    }
  | {
      type: 'pick';
      partner: PartnerLite & { offer?: DiscoverOffer };
      reason: string;
      matched: string[];
      unknown: { label: string; note: string }[];
      unmet: string[];
      isNewToMember: boolean;
      food: DiscoverFood;
    }
  | {
      type: 'fallback';
      reason: DiscoverStreamReason;
      message: string;
      alternative: PartnerLite;
    }
  | { type: 'error'; message: string };

export const PARSE_STEP_LABEL = 'Reading your vibe';

export function filterStepLabel(total: number): string {
  return `Looking through ${total} local partners`;
}

/**
 * Timeout wins over the logged `provider_error` code. Every other #97 reason
 * is `no_match` here: the card is an alternative, not a provider failure.
 */
export function discoverStreamReason(
  reason: DiscoverFallbackReason,
  providerTimedOut: boolean,
): DiscoverStreamReason {
  if (providerTimedOut) return 'timeout';
  if (reason === 'provider_error') return 'provider_error';
  return 'no_match';
}

export function fallbackAlternativeMessage(name: string): string {
  return `Alternative: ${name}. This is not a match for that request.`;
}

export function encodeDiscoverSse(events: readonly DiscoverEvent[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

export function parseDiscoverSse(body: string): DiscoverEvent[] {
  const events: DiscoverEvent[] = [];
  for (const block of body.split('\n\n')) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const line = trimmed.split('\n').find((item) => item.startsWith('data: '));
    if (!line) continue;
    events.push(JSON.parse(line.slice('data: '.length)) as DiscoverEvent);
  }
  return events;
}
