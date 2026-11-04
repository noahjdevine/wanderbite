import { partnerDirections } from '@/lib/discover/directions';
import {
  fallbackAlternativeMessage,
  discoverStreamReason,
  filterStepLabel,
  PARSE_STEP_LABEL,
  type DiscoverEvent,
  type PartnerLite,
} from '@/lib/discover/events';
import type { DiscoverFallbackReason } from '@/lib/discover/fallback-reason';
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
};

/**
 * Events for one finished card. Memory and rank are intentionally absent:
 * verified history is not read, and the picker never keeps a runner-up.
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
      isNewToMember: false,
      food: foodFromParsedCuisine({
        message: args.message,
        preferredCuisine: args.preferredCuisine,
        constraintLabels: constraints.map((constraint) => constraint.label),
      }),
    });
    return events;
  }

  const reason = args.fallbackReason ?? 'invalid_pick';
  const alternative = streamedPartner(args.chosen);
  events.push({
    type: 'fallback',
    reason: discoverStreamReason(reason, args.providerTimedOut),
    message: fallbackAlternativeMessage(alternative.name),
    alternative,
  });
  return events;
}
