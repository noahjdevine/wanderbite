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

/** Lowest sealed bases that sum to a pair. Distinct restaurant ids are required. */
export const FLOOR_PAIR_CENTS = 2000;

export type FloorCentsRestaurant = {
  id: string;
  baseCents: number | null;
};

export function basesMeetPairFloor(
  left: FloorCentsRestaurant,
  right: FloorCentsRestaurant,
  floorCents = FLOOR_PAIR_CENTS,
): boolean {
  if (left.id === right.id) return false;
  if (left.baseCents == null || right.baseCents == null) return false;
  if (!Number.isFinite(left.baseCents) || !Number.isFinite(right.baseCents)) return false;
  return left.baseCents + right.baseCents >= floorCents;
}

/** True when some i < j pair has two ids and valid bases totaling `floorCents`. */
export function floorPairExists<T extends FloorCentsRestaurant>(
  candidates: readonly T[],
  floorCents = FLOOR_PAIR_CENTS,
): boolean {
  for (let i = 0; i < candidates.length; i += 1) {
    const left = candidates[i];
    if (!left) continue;
    for (let j = i + 1; j < candidates.length; j += 1) {
      const right = candidates[j];
      if (!right) continue;
      if (basesMeetPairFloor(left, right, floorCents)) return true;
    }
  }
  return false;
}

/**
 * First qualifying i < j pair in caller shuffle order. With `reserveCocktail`,
 * a pair that contains a cocktail bar wins; otherwise the first qualifying pair.
 */
export function pickFloorPair<
  T extends FloorCentsRestaurant & { cuisine_tags: string[] | null },
>(
  pool: readonly T[],
  options: {
    shuffle: (items: T[]) => T[];
    floorCents?: number;
    reserveCocktail?: boolean;
  },
): [T, T] | null {
  const floorCents = options.floorCents ?? FLOOR_PAIR_CENTS;
  const ordered = options.shuffle([...pool]);
  const find = (cocktailOnly: boolean): [T, T] | null => {
    for (let i = 0; i < ordered.length; i += 1) {
      const left = ordered[i];
      if (!left) continue;
      for (let j = i + 1; j < ordered.length; j += 1) {
        const right = ordered[j];
        if (!right) continue;
        if (!basesMeetPairFloor(left, right, floorCents)) continue;
        if (cocktailOnly && !isCocktailBar(left) && !isCocktailBar(right)) continue;
        return [left, right];
      }
    }
    return null;
  };
  if (options.reserveCocktail) {
    const preferred = find(true);
    if (preferred) return preferred;
  }
  return find(false);
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
