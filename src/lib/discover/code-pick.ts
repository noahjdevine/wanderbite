import { preferUnvisitedRestaurants } from '@/lib/discover/member-memory';
import { restaurantMatchesPreferredCuisine } from '@/lib/discover/stages';

/**
 * Soft rank for one Discover card.
 *
 * The caller passes the pool that remains after dietary filters, excluded
 * cuisines, and session exclusions. Cuisine and price are equal soft points,
 * not filters: the top tier is every row with the highest score, in pool
 * order. A missing preference adds no points. Unvisited partners are preferred
 * only inside that tier. The draw is random inside the tier that remains.
 */
export type CodePickRestaurant = {
  id: string;
  cuisine_tags: string[] | null;
  price_range: string | null;
};

export type CodePickRandom = () => number;

function softScore(
  row: CodePickRestaurant,
  preferredCuisine: string | undefined,
  priceRange: string | undefined,
): number {
  let score = 0;
  if (
    preferredCuisine &&
    restaurantMatchesPreferredCuisine(row.cuisine_tags, preferredCuisine)
  ) {
    score += 1;
  }
  const wanted = priceRange?.trim() ?? '';
  const listed = row.price_range?.trim() ?? '';
  if (wanted && listed === wanted) score += 1;
  return score;
}

function indexIn(length: number, random: CodePickRandom): number {
  if (length <= 1) return 0;
  const unit = random();
  if (!Number.isFinite(unit) || unit <= 0) return 0;
  if (unit >= 1) return length - 1;
  return Math.floor(unit * length);
}

export function rankDiscoverRestaurant<T extends CodePickRestaurant>(args: {
  pool: readonly T[];
  preferredCuisine?: string;
  priceRange?: string;
  /** Null or omitted means visits are unknown, so unvisited preference is skipped. */
  visitedRestaurantIds?: ReadonlySet<string> | null;
  random?: CodePickRandom;
}): T | null {
  if (args.pool.length === 0) return null;
  const scored = args.pool.map((row) => ({
    row,
    score: softScore(row, args.preferredCuisine, args.priceRange),
  }));
  const best = scored.reduce((max, item) => Math.max(max, item.score), 0);
  const tier = scored.filter((item) => item.score === best).map((item) => item.row);
  const ranked =
    args.visitedRestaurantIds == null
      ? tier
      : preferUnvisitedRestaurants(tier, args.visitedRestaurantIds);
  const draw = ranked[indexIn(ranked.length, args.random ?? Math.random)];
  return draw ?? null;
}
