import { CUISINES, cuisineLabel, isCuisineId, type CuisineId } from '@/lib/cuisines';
import { mergeSoftAsk } from '@/lib/discover/code-pick';
import type { DiscoverAskTone } from '@/lib/discover/events';
import { restaurantMatchesPreferredCuisine } from '@/lib/discover/stages';

/**
 * Member-facing Bea line for one Discover card.
 * Surprise, another idea, and tweaks each have their own voice.
 * The closest-match line is only for a hard constraint the pool cannot meet.
 */
export const POOL_RESTART_LINE = "That's everything I've got that fits. Starting over.";

export const SURPRISE_LINES = [
  (name: string) => `Bea's wild card: ${name}. Trust me on this one.`,
  (name: string) => `Surprise! Tonight you're going to ${name}.`,
  (name: string) => `Eyes closed, finger on the map... ${name}!`,
] as const;

const PRICE_ORDER = ['$', '$$', '$$$', '$$$$'] as const;

const BOAT = /\b(?:boats?|yachts?|ships?|ferries|ferry)\b/i;
const CLOCK = /\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b/i;
const OPEN_AT = /\bopen\s+(?:at|until|from)\b/i;

export type DiscoverRefineKind = 'cheaper' | 'new-vibe';

export type MemberVoice = {
  badge: string;
  line: string;
  /** A hard miss stays a fallback card. Every other voice is a pick card. */
  card: 'pick' | 'fallback';
};

function placeName(name: string): string {
  const place = name.trim();
  return place.length > 0 ? place : 'this spot';
}

function priceRank(value: string | null | undefined): number | null {
  const index = PRICE_ORDER.indexOf((value ?? '').trim() as (typeof PRICE_ORDER)[number]);
  return index < 0 ? null : index;
}

/** Round-robin across the three surprise lines. A bad index still lands on one of them. */
export function surpriseLine(name: string, index: number): string {
  const slot = Number.isFinite(index) ? Math.trunc(index) : 0;
  const safe = ((slot % SURPRISE_LINES.length) + SURPRISE_LINES.length) % SURPRISE_LINES.length;
  const write = SURPRISE_LINES[safe] ?? SURPRISE_LINES[0];
  return write(placeName(name));
}

export function cheaperVoiceLine(name: string, landed: boolean): string {
  const place = placeName(name);
  return landed
    ? `A little easier on the wallet: ${place}.`
    : `Nothing easier on the wallet than ${place}.`;
}

export function vibeVoiceLine(name: string, changed: boolean): string {
  const place = placeName(name);
  return changed
    ? `Switching it up: ${place}.`
    : `I couldn't find a different vibe. Sticking with ${place}.`;
}

export function anotherIdeaLine(name: string): string {
  const place = name.trim();
  return place ? `Here's another idea: ${place}.` : "Here's another idea.";
}

export function closestVoiceLine(name: string, misses: readonly string[]): string {
  const place = name.trim();
  const list = briefList(misses);
  if (!list) {
    return place
      ? `Closest I've got: ${place}. It may not match everything you asked for.`
      : "Closest I've got. It may not match everything you asked for.";
  }
  return place
    ? `Closest I've got: ${place}. I couldn't match ${list}.`
    : `Closest I've got. I couldn't match ${list}.`;
}

function briefList(items: readonly string[]): string {
  const unique: string[] = [];
  for (const item of items) {
    const text = item.trim();
    if (!text || unique.includes(text)) continue;
    unique.push(text);
  }
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0] ?? '';
  if (unique.length === 2) return `${unique[0]} or ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')}, or ${unique[unique.length - 1]}`;
}

/**
 * Copy that should never reach a member: unconfirmed tags, the template
 * tag dump, and the internal "no backstory" sentence.
 */
export function isRobotMemberCopy(text: string): boolean {
  const value = text.toLowerCase();
  return (
    value.includes("can't confirm") ||
    value.includes('cant confirm') ||
    value.includes('confirm details with the restaurant') ||
    value.includes('great dish pick') ||
    value.includes('backstory') ||
    /\btagged\b/.test(value) ||
    /\blisted at\b/.test(value)
  );
}

export function friendlyDiscoverLine(args: {
  name: string;
  cuisine?: string | null;
  neighborhood?: string | null;
  descriptive?: string | null;
}): string {
  const descriptive = args.descriptive?.trim() ?? '';
  if (descriptive && !isRobotMemberCopy(descriptive)) return descriptive;
  const place = placeName(args.name);
  const cuisine = shortCuisineLabel(args.cuisine);
  const neighborhood = args.neighborhood?.trim() ?? '';
  const article = cuisine && /^[aeiou]/i.test(cuisine) ? 'an' : 'a';
  if (cuisine && neighborhood) return `${place} is ${article} ${cuisine} spot in ${neighborhood}.`;
  if (neighborhood) return `${place} is in ${neighborhood}.`;
  if (cuisine) return `${place} is ${article} ${cuisine} spot.`;
  return `How about ${place}?`;
}

function shortCuisineLabel(value: string | null | undefined): string {
  const raw = value?.trim() ?? '';
  if (!raw) return '';
  return raw.split(' — ')[0]?.split(' / ')[0]?.trim() || raw;
}

function cuisineMention(message: string, id: CuisineId): string {
  const cuisine = CUISINES.find((item) => item.id === id);
  const text = message.toLowerCase();
  const keyword = cuisine?.keywords.find((word) => keywordIn(text, word));
  if (keyword) return keyword;
  return shortCuisineLabel(cuisineLabel(id)) || id;
}

function keywordIn(text: string, keyword: string): boolean {
  const body = keyword.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/s$/, 's?');
  return new RegExp(`(?:^|[^a-z0-9])${body}(?=$|[^a-z0-9])`, 'i').test(text);
}

/** Boat, yacht, and a clock time are asks the listing cannot satisfy. */
export function unverifiableDemandMisses(message: string): string[] {
  const misses: string[] = [];
  if (BOAT.test(message)) misses.push('a boat');
  const clock = CLOCK.exec(message);
  if (clock?.[1]) {
    misses.push(`being open at ${clock[1].replace(/\s+/g, ' ').trim()}`);
  } else if (OPEN_AT.test(message)) {
    misses.push('that time');
  }
  return misses;
}

/**
 * Explicit cuisines the chosen restaurant does not have.
 * "Sushi or thai" is met by either. "Vegan sushi" needs both.
 * Price, vibe, and patio are soft and are not listed here.
 */
export function hardConstraintMisses(args: {
  message: string;
  preferredCuisine?: string | null;
  priceRange?: string | null;
  restaurantTags: string[] | null | undefined;
}): string[] {
  const ask = mergeSoftAsk({
    message: args.message,
    preferredCuisine: args.preferredCuisine ?? undefined,
    priceRange: args.priceRange ?? undefined,
  });
  const ids = ask.preferredCuisines.filter((id): id is CuisineId => isCuisineId(id));
  const matched = new Set(ids.filter((id) => restaurantMatchesPreferredCuisine(args.restaurantTags, id)));
  const orMode = /\bor\b/i.test(args.message);
  const cuisineMisses: string[] = [];
  if (ids.length > 0) {
    if (orMode) {
      if (matched.size === 0) cuisineMisses.push(cuisineMention(args.message, ids[0] as CuisineId));
    } else {
      for (const id of ids) {
        if (!matched.has(id)) cuisineMisses.push(cuisineMention(args.message, id));
      }
    }
  }
  return [...cuisineMisses, ...unverifiableDemandMisses(args.message)];
}

/**
 * True when the chosen price is actually lower than the price before Cheaper.
 * A first Cheaper click, with no price yet, lands only on $.
 * Already at $ cannot land lower.
 */
export function cheaperChoiceLanded(
  chosenPrice: string | null | undefined,
  previousPrice: string | null | undefined,
): boolean {
  const chosen = priceRank(chosenPrice);
  const previous = priceRank(previousPrice);
  if (previous == null) return chosen === 0;
  if (previous <= 0) return false;
  return chosen != null && chosen < previous;
}

export function selectMemberVoice(args: {
  name: string;
  message: string;
  askTone: DiscoverAskTone | null;
  surpriseSession?: boolean;
  refine?: DiscoverRefineKind | null;
  lineIndex?: number;
  poolRestarted?: boolean;
  cheaperLanded?: boolean;
  vibeChanged?: boolean;
  restaurantTags?: string[] | null;
  preferredCuisine?: string | null;
  priceRange?: string | null;
  cuisine?: string | null;
  neighborhood?: string | null;
  descriptive?: string | null;
}): MemberVoice {
  if (args.poolRestarted) {
    return { badge: 'Starting over', line: POOL_RESTART_LINE, card: 'pick' };
  }
  if (args.refine === 'cheaper') {
    return {
      badge: 'Easier on the wallet',
      line: cheaperVoiceLine(args.name, args.cheaperLanded === true),
      card: 'pick',
    };
  }
  if (args.refine === 'new-vibe') {
    return {
      badge: 'New vibe',
      line: vibeVoiceLine(args.name, args.vibeChanged === true),
      card: 'pick',
    };
  }
  const surprise =
    args.askTone === 'surprise' || (args.askTone === 'another' && args.surpriseSession === true);
  if (surprise) {
    return {
      badge: 'Surprise',
      line: surpriseLine(args.name, args.lineIndex ?? 0),
      card: 'pick',
    };
  }
  if (args.askTone === 'another') {
    return {
      badge: "Here's another idea",
      line: anotherIdeaLine(args.name),
      card: 'pick',
    };
  }
  const misses = hardConstraintMisses({
    message: args.message,
    preferredCuisine: args.preferredCuisine,
    priceRange: args.priceRange,
    restaurantTags: args.restaurantTags,
  });
  if (misses.length > 0) {
    return {
      badge: 'Closest pick',
      line: closestVoiceLine(args.name, misses),
      card: 'fallback',
    };
  }
  return {
    badge: 'Picked for you',
    line: friendlyDiscoverLine({
      name: args.name,
      cuisine: args.cuisine,
      neighborhood: args.neighborhood,
      descriptive: args.descriptive,
    }),
    card: 'pick',
  };
}
