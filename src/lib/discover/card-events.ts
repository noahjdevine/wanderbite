import type { DiscoverCardFact } from '@/lib/discover/briefing-facts';
import { partnerDirections } from '@/lib/discover/directions';
import {
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
import { selectMemberVoice, type DiscoverRefineKind } from '@/lib/discover/voice';
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
  /** Another idea while the session is still Surprise me. */
  surpriseSession?: boolean;
  /** Cheaper or New vibe. Copy only. Ranking still uses price and vibe. */
  refine?: DiscoverRefineKind | null;
  /** Round-robin slot for the three surprise lines. */
  lineIndex?: number;
  /** Every fitting partner was already shown, so this pick starts the pool over. */
  poolRestarted?: boolean;
  /** Cheaper found a lower listed price than the previous ask. */
  cheaperLanded?: boolean;
  /** New vibe returned a restaurant that was not just shown, and the vibe chip moved. */
  vibeChanged?: boolean;
  /** New vibe returned the restaurant that was just shown. */
  samePlace?: boolean;
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

  const partner = streamedPartner(args.chosen);
  const voice = selectMemberVoice({
    name: partner.name,
    message: args.message,
    askTone: args.askTone ?? null,
    surpriseSession: args.surpriseSession,
    refine: args.refine,
    lineIndex: args.lineIndex,
    poolRestarted: args.poolRestarted,
    cheaperLanded: args.cheaperLanded,
    vibeChanged: args.vibeChanged,
    samePlace: args.samePlace,
    restaurantTags: args.chosen.cuisine_tags,
    preferredCuisine: args.preferredCuisine,
    priceRange: args.priceRange,
    cuisine: partner.cuisine,
    neighborhood: partner.neighborhood,
    descriptive: args.reason,
    timeOfDay: args.timeOfDay,
    dietary: args.dietary,
  });
  const restarted = args.poolRestarted === true ? { poolRestarted: true as const } : {};

  if (voice.card === 'pick') {
    const honesty = classifyPickConstraints({
      constraints,
      restaurant: args.chosen,
      priceRange: args.priceRange,
      preferredCuisine: args.preferredCuisine,
    });
    events.push({
      type: 'pick',
      partner,
      reason: voice.line,
      badge: voice.badge,
      matched: honesty.matched,
      unknown: honesty.unknown.filter((item) => !/can'?t confirm/i.test(item.note)),
      unmet: honesty.unmet,
      isNewToMember: memory?.isNewToMember ?? false,
      food: foodFromParsedCuisine({
        message: args.message,
        preferredCuisine: args.preferredCuisine,
        constraintLabels: constraints.map((constraint) => constraint.label),
      }),
      ...(facts ? { facts } : {}),
      ...restarted,
    });
    return events;
  }

  const reason = args.fallbackReason ?? 'invalid_pick';
  events.push({
    type: 'fallback',
    reason: discoverStreamReason(reason, args.providerTimedOut),
    message: voice.line,
    alternative: partner,
    tone: 'alternative',
    badge: voice.badge,
    ...(facts ? { facts } : {}),
    ...(memory ? { isNewToMember: memory.isNewToMember } : {}),
    ...restarted,
  });
  return events;
}
