import type { DiscoverCardFact } from '@/lib/discover/briefing-facts';
import type { DiscoverFallbackReason } from '@/lib/discover/fallback-reason';

/**
 * Discover stream contract from design-handoff/BEA_AI_SPEC.md section 4.
 *
 * Step mapping for the live `/api/roulette` pipeline:
 * - parse: validated message plus the chips and saved dietary flags the route already merges.
 *   Dietary constraints are required. Free text is not turned into extra chips.
 * - filter: active launch-market partners after the dietary and exclusion filters.
 *   `total` is that pool. `sample` is the first three, in query order.
 * - memory: only when a signed-in member's verified-visit read succeeded.
 *   The line uses that visit set and the restaurant name. It does not use
 *   ratings or note text. Guests and a failed read omit the step.
 * - rank: omitted. The model returns one restaurant id, and a random fallback draws one.
 *   Nothing stores a runner-up, so there is no rank step and no runnerUp.
 * - pick: only when `selectionMode` is `ai`. matched / unknown / unmet come from the
 *   parsed constraints and the chosen row. `isNewToMember` is true when that
 *   visit read succeeded and the chosen restaurant is not in it. Optional
 *   `facts` are up to two researched notes for the card. They are not chips.
 * - fallback: a random pick. `alternative` is that restaurant. A surprise or another
 *   idea is a suggestion. A request with constraints is a closest pick, and the
 *   copy never calls it a match. `tone` is the card label. Optional `facts` use
 *   the same card notes. Optional `isNewToMember` uses the same visit read as
 *   the pick. The spec's fallback object has no partner; `alternative`
 *   is how Phase 2.1c can render the same restaurant `/api/roulette` returns.
 */

export const DISCOVER_ASK_TONES = ['surprise', 'another', 'request'] as const;

export type DiscoverAskTone = (typeof DISCOVER_ASK_TONES)[number];

export type DiscoverFallbackTone = 'surprise' | 'another' | 'alternative';

/** Closed copy tone. Unknown values are ignored so a bad body cannot invent a mode. */
export function parseDiscoverAskTone(value: unknown): DiscoverAskTone | null {
  if (typeof value !== 'string') return null;
  return (DISCOVER_ASK_TONES as readonly string[]).includes(value)
    ? (value as DiscoverAskTone)
    : null;
}

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

export type PartnerDirections = {
  /** Street line from `restaurants.address` when that value is non-blank. */
  address?: string;
  /** https Google Maps search. Same query as the roulette Get Directions link. */
  mapsUrl?: string;
};

export type PartnerLite = {
  id: string;
  name: string;
  cuisine?: string;
  neighborhood?: string;
  photoUrl?: string;
  photoCredit?: string;
  /** Omitted when the row has neither a name nor a street address. */
  directions?: PartnerDirections;
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
      /** Omitted when the restaurant has no eligible card notes. */
      facts?: DiscoverCardFact[];
      /** Member-facing pill. Omitted streams keep "Picked for you". */
      badge?: string;
      /** True when every fitting partner was already shown and the pool restarted. */
      poolRestarted?: boolean;
    }
  | {
      type: 'fallback';
      reason: DiscoverStreamReason;
      message: string;
      alternative: PartnerLite;
      /**
       * Card label. Surprise and another idea stay suggestions. `alternative`
       * is a closest pick and is never a match. Older streams omit this and
       * the client reads the message prefix.
       */
      tone?: DiscoverFallbackTone;
      /** Omitted when the restaurant has no eligible card notes. */
      facts?: DiscoverCardFact[];
      /**
       * Present when the member's verified visits were read. True when this
       * restaurant is not among them. Omitted for a guest or a failed read.
       */
      isNewToMember?: boolean;
      /** Member-facing pill. Omitted streams keep the tone label. */
      badge?: string;
      /** True when every fitting partner was already shown and the pool restarted. */
      poolRestarted?: boolean;
    }
  | { type: 'error'; message: string };

export const PARSE_STEP_LABEL = 'Reading your vibe';

export const MEMORY_STEP_LABEL = 'From your visits';

/**
 * Copy for the memory step. A new restaurant names the place. A previous
 * verified visit stays plain and does not mention a rating, a note, or a date.
 */
export function memoryStepLine(name: string, isNewToMember: boolean): string {
  if (!isNewToMember) return "You've been here before.";
  const place = name.trim();
  return place.length > 0 ? `You haven't been to ${place} yet.` : "You haven't been here yet.";
}

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

/**
 * Surprise and another idea had nothing to miss. A constrained ask is a
 * closest pick, in calm wording, and is never called a match.
 */
export function fallbackToneForAsk(args: {
  askTone: DiscoverAskTone | null;
  message: string;
  vibe?: string;
  timeOfDay?: string;
  priceRange?: string;
  preferredCuisine?: string;
}): DiscoverFallbackTone {
  if (args.askTone === 'another') return 'another';
  if (args.askTone === 'surprise') return 'surprise';
  if (args.askTone === 'request') return 'alternative';
  const hasAsk =
    args.message.trim().length > 0 ||
    Boolean(args.vibe || args.timeOfDay || args.priceRange || args.preferredCuisine);
  return hasAsk ? 'alternative' : 'surprise';
}

export function fallbackBadgeLabel(tone: DiscoverFallbackTone): string {
  if (tone === 'surprise') return "Here's a surprise";
  if (tone === 'another') return "Here's another idea";
  return 'Closest pick';
}

/** Prefix backup for a stream that omitted `tone`. Keep this aligned with the copy below. */
export function fallbackPresentation(message: string): DiscoverFallbackTone {
  if (message.startsWith("Here's a surprise")) return 'surprise';
  if (message.startsWith("Here's another idea")) return 'another';
  if (message.startsWith("Closest I've got") || message.startsWith('Alternative:')) return 'alternative';
  return 'alternative';
}

export function fallbackAlternativeMessage(name: string, tone: DiscoverFallbackTone = 'alternative'): string {
  const place = name.trim();
  if (tone === 'surprise') {
    return place ? `Here's a surprise: ${place}.` : "Here's a surprise.";
  }
  if (tone === 'another') {
    return place ? `Here's another idea: ${place}.` : "Here's another idea.";
  }
  return place
    ? `Closest I've got: ${place}. It may not match everything you asked for.`
    : "Closest I've got. It may not match everything you asked for.";
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
