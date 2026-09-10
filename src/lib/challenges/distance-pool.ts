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

function poolAtRadius<T extends DistancePoolRestaurant>(
  restaurants: T[],
  origin: GeoPoint,
  miles: number,
  requiredCount: number,
  filters: {
    passesHard: (restaurant: T) => boolean;
    passesVariety: (restaurant: T) => boolean;
    passesRelaxedVariety: (restaurant: T) => boolean;
  }
): T[] {
  const inRadius = restaurantsWithinMiles(restaurants, origin, miles);
  const hard = inRadius.filter(filters.passesHard);
  const withVariety = hard.filter(filters.passesVariety);
  if (withVariety.length >= requiredCount) return withVariety;
  return hard.filter(filters.passesRelaxedVariety);
}

/** Build an assignable pool at the requested radius, expanding at most one band. */
export function selectDistancePool<T extends DistancePoolRestaurant>(args: {
  restaurants: T[];
  origin: GeoPoint;
  requestedMiles: number;
  requiredCount: number;
  passesHard: (restaurant: T) => boolean;
  passesVariety: (restaurant: T) => boolean;
  passesRelaxedVariety: (restaurant: T) => boolean;
}): DistancePoolResult<T> {
  const filters = {
    passesHard: args.passesHard,
    passesVariety: args.passesVariety,
    passesRelaxedVariety: args.passesRelaxedVariety,
  };
  const requested = poolAtRadius(
    args.restaurants,
    args.origin,
    args.requestedMiles,
    args.requiredCount,
    filters
  );
  if (requested.length >= args.requiredCount) {
    return {
      candidates: requested,
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
      candidates: requested,
      match: {
        requestedMiles: args.requestedMiles,
        usedMiles: args.requestedMiles,
        expanded: false,
      },
    };
  }

  const expanded = poolAtRadius(
    args.restaurants,
    args.origin,
    expandedMiles,
    args.requiredCount,
    filters
  );
  return {
    candidates: expanded,
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
