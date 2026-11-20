import type { DiscoverCardFact } from '@/lib/discover/briefing-facts';
import { partnerDirections } from '@/lib/discover/directions';
import {
  fallbackAlternativeMessage,
  fallbackToneForAsk,
  discoverStreamReason,
  filterStepLabel,
  MEMORY_STEP_LABEL,
  PARSE_STEP_LABEL,
  type DiscoverAskTone,
  type DiscoverEvent,
  type PartnerLite,
} from '@/lib/discover/events';
import type { DiscoverFallbackReason } from '@/lib/discover/fallback-reason';
import { memberVisitMemory } from '@/lib/discover/member-memory';
import {
  classifyPickConstraints,
  constraintsFromDiscoveryInput,
  filterDetail,
  filterSample,
  foodFromParsedCuisine,
  toPartnerLite,
  type DiscoverRestaurant,
} from '@/lib/discover/stages';

/** Directions stay on the chosen card. Filter samples do not carry addresses. */
function streamedPartner(row: DiscoverRestaurant): PartnerLite {
  const partner = toPartnerLite(row);
  const directions = partnerDirections({ name: row.name, address: row.address });
  if (!directions) return partner;
  return { ...partner, directions };
}

export type DiscoverCardInput = {
  message: string;
  dietary: readonly string[];
  excludedCuisineIds: readonly string[];
  vibe?: string;
  timeOfDay?: string;
  priceRange?: string;
  preferredCuisine?: string;
  restaurants: readonly DiscoverRestaurant[];
  chosen: DiscoverRestaurant;
  /** Same sentence `/api/roulette` puts in `reason`. */
  reason: string;
  selectionMode: 'ai' | 'random_fallback';
  fallbackReason: DiscoverFallbackReason | null;
  providerTimedOut: boolean;
  /**
   * Copy only. Surprise and another idea are suggestions. A request is a
   * closest pick when the model did not choose it, and that line never calls
   * it a match. Omitted tones are inferred from the message and soft chips.
   */
  askTone?: DiscoverAskTone | null;
  /** Already capped card notes for the chosen restaurant. Empty omits the key. */
  facts?: readonly DiscoverCardFact[];
  /**
   * Verified-visit restaurant ids for this member. Null or omitted means
   * unknown: no memory step, and `isNewToMember` stays false. An empty set
   * means none of this pool has a verified visit.
   */
  visitedRestaurantIds?: ReadonlySet<string> | null;
};

/**
 * Events for one finished card. Rank stays absent: the picker never keeps a
 * runner-up. Memory is present only when `visitedRestaurantIds` was loaded.
 */
export function eventsForDiscoverCard(args: DiscoverCardInput): DiscoverEvent[] {
  const constraints = constraintsFromDiscoveryInput({
    dietary: args.dietary,
    vibe: args.vibe,
    timeOfDay: args.timeOfDay,
    priceRange: args.priceRange,
    preferredCuisine: args.preferredCuisine,
  });
  const events: DiscoverEvent[] = [
    { type: 'step', id: 'parse', label: PARSE_STEP_LABEL, constraints },
    {
      type: 'step',
      id: 'filter',
      label: filterStepLabel(args.restaurants.length),
      detail: filterDetail({
        dietary: args.dietary,
        excludedCuisineIds: args.excludedCuisineIds,
      }),
      sample: filterSample(args.restaurants),
      total: args.restaurants.length,
    },
  ];

  const facts = args.facts && args.facts.length > 0 ? [...args.facts] : undefined;
  const memory = memberVisitMemory(args.chosen, args.visitedRestaurantIds);
  if (memory) {
    events.push({
      type: 'step',
      id: 'memory',
      label: MEMORY_STEP_LABEL,
      line: memory.line,
    });
  }

  if (args.selectionMode === 'ai') {
    const honesty = classifyPickConstraints({
      constraints,
      restaurant: args.chosen,
      priceRange: args.priceRange,
      preferredCuisine: args.preferredCuisine,
    });
    events.push({
      type: 'pick',
      partner: streamedPartner(args.chosen),
      reason: args.reason,
      matched: honesty.matched,
      unknown: honesty.unknown,
      unmet: honesty.unmet,
      isNewToMember: memory?.isNewToMember ?? false,
      food: foodFromParsedCuisine({
        message: args.message,
        preferredCuisine: args.preferredCuisine,
        constraintLabels: constraints.map((constraint) => constraint.label),
      }),
      ...(facts ? { facts } : {}),
    });
    return events;
  }

  const reason = args.fallbackReason ?? 'invalid_pick';
  const alternative = streamedPartner(args.chosen);
  const tone = fallbackToneForAsk({
    askTone: args.askTone ?? null,
    message: args.message,
    vibe: args.vibe,
    timeOfDay: args.timeOfDay,
    priceRange: args.priceRange,
    preferredCuisine: args.preferredCuisine,
  });
  events.push({
    type: 'fallback',
    reason: discoverStreamReason(reason, args.providerTimedOut),
    message: fallbackAlternativeMessage(alternative.name, tone),
    alternative,
    tone,
    ...(facts ? { facts } : {}),
    ...(memory ? { isNewToMember: memory.isNewToMember } : {}),
  });
  return events;
}
