import {
  haversineMiles,
  nextBandMiles,
  toGeoPoint,
  type DistanceMatch,
  type GeoPoint,
} from '@/lib/launch-market';

export type DistancePoolRestaurant = {
  id: string;
  lat: number | null;
  lon: number | null;
};

export type DistancePoolResult<T extends DistancePoolRestaurant> = {
  candidates: T[];
  match: DistanceMatch;
};

export function restaurantsWithinMiles<T extends DistancePoolRestaurant>(
  restaurants: T[],
  origin: GeoPoint,
  miles: number
): T[] {
  return restaurants.filter((restaurant) => {
    const point = toGeoPoint(restaurant.lat, restaurant.lon);
    if (!point) return false;
    return haversineMiles(origin, point) <= miles;
  });
}

type DistanceFilters<T extends DistancePoolRestaurant> = {
  passesHard: (restaurant: T) => boolean;
  passesVariety: (restaurant: T) => boolean;
  passesRelaxedVariety: (restaurant: T) => boolean;
};

function tiersAtRadius<T extends DistancePoolRestaurant>(
  restaurants: T[],
  origin: GeoPoint,
  miles: number,
  filters: DistanceFilters<T>,
): { strict: T[]; relaxed: T[] } {
  const inRadius = restaurantsWithinMiles(restaurants, origin, miles);
  const hard = inRadius.filter(filters.passesHard);
  return {
    strict: hard.filter(filters.passesVariety),
    relaxed: hard.filter(filters.passesRelaxedVariety),
  };
}

function chooseTier<T>(
  tiers: { strict: T[]; relaxed: T[] },
  accepts: (candidates: T[]) => boolean,
): { candidates: T[]; ok: boolean } {
  if (accepts(tiers.strict)) return { candidates: tiers.strict, ok: true };
  if (accepts(tiers.relaxed)) return { candidates: tiers.relaxed, ok: true };
  return { candidates: tiers.relaxed, ok: false };
}

/**
 * Build an assignable pool at the requested radius, expanding at most one band.
 * Hard filters always apply. With no `poolSatisfies`, a tier is accepted when
 * it has `requiredCount` restaurants. With `poolSatisfies`, that callback
 * decides strict variety, then relaxed variety, then the one-band expansion.
 */
export function selectDistancePool<T extends DistancePoolRestaurant>(args: {
  restaurants: T[];
  origin: GeoPoint;
  requestedMiles: number;
  requiredCount: number;
  passesHard: (restaurant: T) => boolean;
  passesVariety: (restaurant: T) => boolean;
  passesRelaxedVariety: (restaurant: T) => boolean;
  poolSatisfies?: (candidates: T[]) => boolean;
}): DistancePoolResult<T> {
  const filters = {
    passesHard: args.passesHard,
    passesVariety: args.passesVariety,
    passesRelaxedVariety: args.passesRelaxedVariety,
  };
  const accepts =
    args.poolSatisfies ?? ((candidates: T[]) => candidates.length >= args.requiredCount);
  const requested = chooseTier(
    tiersAtRadius(args.restaurants, args.origin, args.requestedMiles, filters),
    accepts,
  );
  if (requested.ok) {
    return {
      candidates: requested.candidates,
      match: {
        requestedMiles: args.requestedMiles,
        usedMiles: args.requestedMiles,
        expanded: false,
      },
    };
  }

  const expandedMiles = nextBandMiles(args.requestedMiles);
  if (expandedMiles == null) {
    return {
      candidates: requested.candidates,
      match: {
        requestedMiles: args.requestedMiles,
        usedMiles: args.requestedMiles,
        expanded: false,
      },
    };
  }

  const expanded = chooseTier(
    tiersAtRadius(args.restaurants, args.origin, expandedMiles, filters),
    accepts,
  );
  return {
    candidates: expanded.candidates,
    match: {
      requestedMiles: args.requestedMiles,
      usedMiles: expandedMiles,
      expanded: true,
    },
  };
}

const COCKTAIL_KEYWORDS = ['cocktail', 'cocktails', 'bar', 'lounge', 'speakeasy'];

export function isCocktailBar(restaurant: {
  cuisine_tags: string[] | null;
}): boolean {
  const tags = (restaurant.cuisine_tags ?? []).map((t) => String(t).toLowerCase());
  return COCKTAIL_KEYWORDS.some((kw) => tags.some((t) => t.includes(kw)));
}

import {
  MINIMUM_CREDIT_BASE_CENTS,
  meetsMinimumCreditBase,
} from '@/lib/offers/credit-floor';

export type FloorCentsRestaurant = {
  id: string;
  baseCents: number | null;
};

/** Restaurants whose lowest sealed tier meets the independent per-credit floor. */
export function creditFloorEligibleRestaurants<T extends FloorCentsRestaurant>(
  candidates: readonly T[],
  minimumCents = MINIMUM_CREDIT_BASE_CENTS,
): T[] {
  return candidates.filter(
    (restaurant) =>
      restaurant.baseCents != null &&
      Number.isFinite(restaurant.baseCents) &&
      meetsMinimumCreditBase(restaurant.baseCents, minimumCents),
  );
}

/** True when at least `requiredCount` distinct restaurants independently meet the credit floor. */
export function poolHasDistinctCreditFloorEligible<T extends FloorCentsRestaurant>(
  candidates: readonly T[],
  requiredCount = 2,
  minimumCents = MINIMUM_CREDIT_BASE_CENTS,
): boolean {
  return creditFloorEligibleRestaurants(candidates, minimumCents).length >= requiredCount;
}

/** Pick exactly `count` distinct restaurants when the pool is large enough. */
export function pickDistinctRestaurants<
  T extends { id: string; cuisine_tags: string[] | null },
>(
  pool: T[],
  count: number,
  options: { reserveCocktail: boolean; shuffle: (items: T[]) => T[] }
): T[] {
  const shuffled = options.shuffle(pool);
  if (!options.reserveCocktail || count < 2) {
    return shuffled.slice(0, count);
  }
  const cocktail = shuffled.find(isCocktailBar);
  const rest = shuffled.filter((restaurant) => restaurant.id !== cocktail?.id);
  const chosen: T[] = cocktail ? [cocktail] : [];
  chosen.push(...rest.slice(0, count - chosen.length));
  return chosen;
}
