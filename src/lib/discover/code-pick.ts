import { CUISINES, isCuisineId, type CuisineId } from '@/lib/cuisines';
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

function matchesAnyCuisine(
  tags: string[] | null | undefined,
  cuisineIds: readonly string[],
): boolean {
  return cuisineIds.some((id) => restaurantMatchesPreferredCuisine(tags, id));
}

function softScore(
  row: CodePickRestaurant,
  preferredCuisines: readonly string[],
  priceRange: string | undefined,
): number {
  let score = 0;
  if (preferredCuisines.length > 0 && matchesAnyCuisine(row.cuisine_tags, preferredCuisines)) {
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
   * A negated cuisine is an exclusion, not an unmet preference.
   */
  preferencesMet: boolean;
};

export const MESSAGE_EXCLUSION_EMPTY =
  'Nothing left after skipping that. Try a different ask, or we may still be tagging partners — check back soon.';

export type MessageSoftAsk = {
  preferredCuisines: CuisineId[];
  excludedCuisines: CuisineId[];
  priceRange?: string;
};

/**
 * The cue sits immediately before the cuisine. Longer cues are listed first
 * so "not feeling" and "so over" win over "not" and "over".
 */
const NEGATION_BEFORE =
  /(?:^|[^a-z])(?:not\s+in\s+the\s+mood\s+for|not\s+feeling|(?:i'?m|i\s+am|im)\s+so\s+over|so\s+over|sick\s+of|tired\s+of|(?:anything|something|everything)\s+but|except|without|avoid|skip(?:\s+the)?|had|over|no|not)(?:\s+(?:a|an|the|any|some|more|just))*\s*$/i;

type CuisineHit = { id: CuisineId; index: number; end: number };

function keywordPattern(keyword: string): RegExp {
  const body = keyword.trim().toLowerCase();
  const escaped = body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/s$/, 's?');
  return new RegExp(`(?:^|[^a-z0-9])(${escaped})(?=$|[^a-z0-9])`, 'gi');
}

function cuisineHits(text: string): CuisineHit[] {
  const hits: CuisineHit[] = [];
  const occupied: Array<[number, number]> = [];
  const keywords = CUISINES.flatMap((cuisine) =>
    cuisine.keywords.map((keyword) => ({ id: cuisine.id, keyword: keyword.toLowerCase() })),
  ).sort((a, b) => b.keyword.length - a.keyword.length);
  for (const { id, keyword } of keywords) {
    for (const match of text.matchAll(keywordPattern(keyword))) {
      const token = match[1] ?? '';
      const index = (match.index ?? 0) + match[0].length - token.length;
      const end = index + token.length;
      if (occupied.some(([start, stop]) => index < stop && end > start)) continue;
      occupied.push([index, end]);
      hits.push({ id, index, end });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  return hits;
}

function clauseStart(text: string, index: number): number {
  const prior = text.slice(0, index);
  const breakAt = Math.max(
    prior.lastIndexOf('.'),
    prior.lastIndexOf('!'),
    prior.lastIndexOf('?'),
    prior.lastIndexOf(';'),
  );
  return breakAt + 1;
}

function continuesNegation(between: string): boolean {
  return /^(?:\s*(?:,|\bor\b|\band\b)\s*)+$/i.test(between);
}

function parseMessageCuisines(message: string): {
  preferredCuisines: CuisineId[];
  excludedCuisines: CuisineId[];
} {
  const text = message.toLowerCase();
  const hits = cuisineHits(text);
  const negated = new Set<number>();
  hits.forEach((hit, index) => {
    const before = text.slice(clauseStart(text, hit.index), hit.index);
    const free = /^\s*-?free\b/i.test(text.slice(hit.end));
    const previous = index > 0 ? hits[index - 1] : undefined;
    const carried =
      previous !== undefined &&
      negated.has(index - 1) &&
      continuesNegation(text.slice(previous.end, hit.index));
    if (free || carried || NEGATION_BEFORE.test(before)) negated.add(index);
  });
  const preferred: CuisineId[] = [];
  const excluded: CuisineId[] = [];
  hits.forEach((hit, index) => {
    if (negated.has(index)) {
      if (!excluded.includes(hit.id) && !preferred.includes(hit.id)) excluded.push(hit.id);
      return;
    }
    if (!preferred.includes(hit.id)) preferred.push(hit.id);
    const drop = excluded.indexOf(hit.id);
    if (drop !== -1) excluded.splice(drop, 1);
  });
  return { preferredCuisines: preferred, excludedCuisines: excluded };
}

/**
 * A cuisine chip replaces positive cuisines from the message.
 * A negated cuisine in the message is always an exclusion, including when a chip names it.
 * A price chip replaces a price read from the message.
 */
export function mergeSoftAsk(args: {
  message: string;
  preferredCuisine?: string;
  priceRange?: string;
}): MessageSoftAsk {
  const parsed = parseMessageCuisines(args.message);
  const chip = args.preferredCuisine && isCuisineId(args.preferredCuisine) ? args.preferredCuisine : undefined;
  const preferredCuisines =
    chip && parsed.excludedCuisines.includes(chip)
      ? parsed.preferredCuisines.filter((id) => id !== chip)
      : chip
        ? [chip]
        : parsed.preferredCuisines;
  const excludedCuisines = parsed.excludedCuisines.filter((id) => !preferredCuisines.includes(id));
  let priceRange = args.priceRange;
  if (!priceRange) {
    const text = args.message.toLowerCase();
    if (/\b(?:cheap|cheaper|inexpensive|budget)\b/i.test(text)) priceRange = '$';
    else if (/\bmoderate\b/i.test(text)) priceRange = '$$';
    else if (/\b(?:upscale|expensive|splurge|fancy|premium)\b/i.test(text)) priceRange = '$$$';
  }
  return { preferredCuisines, excludedCuisines, priceRange };
}

export function rankDiscoverRestaurant<T extends CodePickRestaurant>(args: {
  pool: readonly T[];
  preferredCuisine?: string;
  preferredCuisines?: readonly string[];
  excludedCuisines?: readonly string[];
  priceRange?: string;
  /** Null or omitted means visits are unknown, so unvisited preference is skipped. */
  visitedRestaurantIds?: ReadonlySet<string> | null;
  random?: CodePickRandom;
}): CodePickResult<T> | null {
  const preferred = (
    args.preferredCuisines?.length
      ? args.preferredCuisines
      : args.preferredCuisine
        ? [args.preferredCuisine]
        : []
  ).filter((id) => !(args.excludedCuisines ?? []).includes(id));
  const excluded = args.excludedCuisines ?? [];
  const pool =
    excluded.length === 0
      ? args.pool
      : args.pool.filter((row) => !matchesAnyCuisine(row.cuisine_tags, excluded));
  if (pool.length === 0) return null;
  const scored = pool.map((row) => ({
    row,
    score: softScore(row, preferred, args.priceRange),
  }));
  const best = scored.reduce((max, item) => Math.max(max, item.score), 0);
  const stated = (preferred.length > 0 ? 1 : 0) + ((args.priceRange?.trim() ?? '') ? 1 : 0);
  const tier = scored.filter((item) => item.score === best).map((item) => item.row);
  const ranked =
    args.visitedRestaurantIds == null
      ? tier
      : preferUnvisitedRestaurants(tier, args.visitedRestaurantIds);
  const restaurant = ranked[indexIn(ranked.length, args.random ?? Math.random)];
  if (!restaurant) return null;
  return { restaurant, preferencesMet: stated === 0 || best >= stated };
}
