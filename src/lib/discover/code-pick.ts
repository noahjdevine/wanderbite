import { CUISINES, type CuisineId } from '@/lib/cuisines';
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

export type CodePickResult<T extends CodePickRestaurant> = {
  restaurant: T;
  /**
   * True when the member stated no soft cuisine or price, or the chosen
   * tier matches every stated one. A shortfall is a closest pick.
   */
  preferencesMet: boolean;
};

function keywordInMessage(text: string, keyword: string): boolean {
  const body = keyword.trim().toLowerCase();
  if (!body) return false;
  const escaped = body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/s$/, 's?');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(text);
}

/** Chips win. A message can fill a missing cuisine or price, and never overrides a chip. */
export function mergeSoftAsk(args: {
  message: string;
  preferredCuisine?: string;
  priceRange?: string;
}): { preferredCuisine?: string; priceRange?: string } {
  const text = args.message.toLowerCase();
  let fromMessage: CuisineId | undefined;
  if (!args.preferredCuisine) {
    for (const cuisine of CUISINES) {
      if (cuisine.keywords.some((keyword) => keywordInMessage(text, keyword))) {
        fromMessage = cuisine.id;
        break;
      }
    }
  }
  let fromPrice: string | undefined;
  if (!args.priceRange) {
    if (/\b(?:cheap|cheaper|inexpensive|budget)\b/i.test(text)) fromPrice = '$';
    else if (/\bmoderate\b/i.test(text)) fromPrice = '$$';
    else if (/\b(?:upscale|expensive|splurge|fancy|premium)\b/i.test(text)) fromPrice = '$$$';
  }
  return {
    preferredCuisine: args.preferredCuisine || fromMessage,
    priceRange: args.priceRange || fromPrice,
  };
}

export function rankDiscoverRestaurant<T extends CodePickRestaurant>(args: {
  pool: readonly T[];
  preferredCuisine?: string;
  priceRange?: string;
  /** Null or omitted means visits are unknown, so unvisited preference is skipped. */
  visitedRestaurantIds?: ReadonlySet<string> | null;
  random?: CodePickRandom;
}): CodePickResult<T> | null {
  if (args.pool.length === 0) return null;
  const scored = args.pool.map((row) => ({
    row,
    score: softScore(row, args.preferredCuisine, args.priceRange),
  }));
  const best = scored.reduce((max, item) => Math.max(max, item.score), 0);
  const stated =
    (args.preferredCuisine ? 1 : 0) + ((args.priceRange?.trim() ?? '') ? 1 : 0);
  const tier = scored.filter((item) => item.score === best).map((item) => item.row);
  const ranked =
    args.visitedRestaurantIds == null
      ? tier
      : preferUnvisitedRestaurants(tier, args.visitedRestaurantIds);
  const restaurant = ranked[indexIn(ranked.length, args.random ?? Math.random)];
  if (!restaurant) return null;
  return { restaurant, preferencesMet: stated === 0 || best >= stated };
}
