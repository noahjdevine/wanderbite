import { ROULETTE_MAX_MESSAGE_CHARS } from '@/lib/ai-bounds';
import { pluralNoun } from '@/lib/format/text';
import { formatCents } from '@/lib/offers/sealed-base';

/**
 * Matches `CHALLENGE_ITEMS_PER_MONTH` in `src/lib/challenges/generate.ts`.
 * The facts tile is shown only while that product rule is still 2.
 */
export const CURATED_ADVENTURES_PER_MONTH = 2;

export const HERO_PLACEHOLDERS = [
  'a quiet date night, Japanese…',
  'tacos and a patio, kids in tow…',
  'somewhere cozy for a rainy Tuesday…',
] as const;

/**
 * Homepage prompt examples. Same count as `HERO_PLACEHOLDERS` so the 12s
 * placeholder cycle still shows one line at a time.
 */
export const HERO_NEED_PLACEHOLDERS = [
  'halal tacos near downtown…',
  'vegan brunch for 4…',
  'gluten-free date night…',
] as const;

/** Optional homepage chips. They only edit the ask text. Nothing is saved. */
export const HERO_NEED_CHIPS = [
  'Vegetarian',
  'Vegan',
  'Halal',
  'Kosher',
  'Gluten-free',
  'Nut allergy',
  'Dairy-free',
] as const;

/** Three placeholders share one 12s loop (4s each). */
export const PLACEHOLDER_CYCLE_MS = 12_000;

export const HERO_QUICK_STARTS = [
  'Date night',
  'Quick bite',
  'Comfort food',
  'Surprise me',
] as const;

export const MARQUEE_MIN_PARTNERS = 3;

export type DirectoryNameRow = {
  status: string | null;
  name: string;
};

export function nowCuratingLabel(cityQuery: string): string {
  const parts = cityQuery.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    const city = parts[0] ?? cityQuery.trim();
    return city ? `Now curating ${city}` : 'Now curating';
  }
  const state = parts[parts.length - 1];
  const city = parts.slice(0, -1).join(' ');
  return `Now curating ${city}, ${state}`;
}

export function marketSealCity(cityQuery: string): string {
  const parts = cityQuery.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return (parts[0] ?? '').toUpperCase();
  return parts.slice(0, -1).join(' ').toUpperCase();
}

/**
 * Public directory rows are `status = 'active'` in the launch market.
 * Paused restaurants are the hidden ones that directory query drops.
 */
export function activeDirectoryRows<T extends DirectoryNameRow>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.status === 'active' && row.name.trim().length > 0);
}

/** Null when the directory query did not run. A successful empty list is 0. */
export function partnerSpotCount(rows: readonly DirectoryNameRow[] | null): number | null {
  if (rows === null) return null;
  return activeDirectoryRows(rows).length;
}

export function partnerSpotLabel(count: number): string {
  return pluralNoun(count, 'local partner spot');
}

/**
 * Names in directory order. Duplicate names (case-insensitive) are kept once.
 * Fewer than 3 names hides the marquee.
 */
export function partnerNamesForMarquee(rows: readonly DirectoryNameRow[] | null): string[] | null {
  if (rows === null) return null;
  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of activeDirectoryRows(rows)) {
    const name = row.name.trim();
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  if (names.length < MARQUEE_MIN_PARTNERS) return null;
  return names;
}

export function curatedAdventuresFact(
  perMonth: number,
): { value: number; label: string } | null {
  if (perMonth !== CURATED_ADVENTURES_PER_MONTH) return null;
  return { value: perMonth, label: 'curated adventures a month' };
}

export function heroOfferLine(args: {
  discountCents: number | null;
  minSpendCents: number | null;
  /** True when the current version is an audit-marked test offer, or the audit read failed. */
  isTestOffer: boolean;
  /** True when `versionSelectable` passed for this current version. */
  selectable: boolean;
}): string | null {
  if (!args.selectable || args.isTestOffer) return null;
  const discount = args.discountCents;
  const minimum = args.minSpendCents;
  if (discount == null || minimum == null) return null;
  if (!Number.isInteger(discount) || !Number.isInteger(minimum)) return null;
  if (discount <= 0 || minimum <= 0) return null;
  return `${formatCents(discount)} off when you spend ${formatCents(minimum)}+`;
}

export type HeroPickInput = {
  id: string;
  name: string;
  cuisine: string | null;
  offerLabel: string | null;
};

export type HeroPick =
  | { kind: 'sample' }
  | {
      kind: 'partner';
      id: string;
      name: string;
      cuisine: string | null;
      offerLabel: string | null;
    };

/** First partner with a real offer line, otherwise the first named partner, otherwise a sample. */
export function chooseHeroPick(rows: readonly HeroPickInput[]): HeroPick {
  const named = rows.filter((row) => row.name.trim().length > 0);
  const withOffer = named.find((row) => row.offerLabel != null && row.offerLabel.trim().length > 0);
  const chosen = withOffer ?? named[0];
  if (!chosen) return { kind: 'sample' };
  return {
    kind: 'partner',
    id: chosen.id,
    name: chosen.name.trim(),
    cuisine: chosen.cuisine,
    offerLabel: withOffer ? chosen.offerLabel : null,
  };
}

export function placeholderIndex(elapsedMs: number): number {
  const count = HERO_PLACEHOLDERS.length;
  if (!Number.isFinite(elapsedMs)) return 0;
  const loop = PLACEHOLDER_CYCLE_MS;
  const span = loop / count;
  const ms = ((elapsedMs % loop) + loop) % loop;
  return Math.min(count - 1, Math.floor(ms / span));
}

export function placeholderDelaySeconds(index: number): number {
  return (index * PLACEHOLDER_CYCLE_MS) / HERO_PLACEHOLDERS.length / 1000;
}

/**
 * First `q` value, trimmed, capped at the Discover message limit.
 * Empty, missing, and non-strings become ''. The text alone does not submit.
 */
export function parseDiscoverQuery(value: string | string[] | undefined | null): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.length <= ROULETTE_MAX_MESSAGE_CHARS) return trimmed;
  return trimmed.slice(0, ROULETTE_MAX_MESSAGE_CHARS);
}

const DISCOVER_RUN_TOKEN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One-shot id the homepage mints per submit. Refresh and back keep the same
 * id; the next submit mints a new one. Anything else does not auto-start.
 */
export function parseDiscoverRunToken(value: string | string[] | undefined | null): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!DISCOVER_RUN_TOKEN.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function discoverHref(text: string, runToken?: string | null): string {
  const q = text.trim();
  if (!q) return '/roulette';
  const base = `/roulette?q=${encodeURIComponent(q)}`;
  if (!runToken) return base;
  return `${base}&run=${encodeURIComponent(runToken)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A need counts only as its own phrase, not as part of a longer word. */
function needMatcher(need: string): RegExp {
  return new RegExp(`(?:^|[\\s,])${escapeRegExp(need)}(?=$|[\\s,])`, 'i');
}

export function askIncludesNeed(text: string, need: string): boolean {
  const phrase = need.trim();
  if (!phrase) return false;
  return needMatcher(phrase).test(text);
}

function tidyAsk(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,(?:\s*,)+/g, ',')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .trim();
}

/**
 * Adds `, Need` or removes that phrase. The rest of the ask stays as written.
 * An append that would pass the Discover limit is left unchanged.
 */
export function toggleAskNeed(text: string, need: string): string {
  const phrase = need.trim();
  if (!phrase) return text;
  const match = needMatcher(phrase).exec(text);
  if (!match) {
    const trimmed = text.trim();
    const next = trimmed ? `${trimmed}, ${phrase}` : phrase;
    if (next.length > ROULETTE_MAX_MESSAGE_CHARS) return text;
    return next;
  }
  const start = match.index;
  const end = start + match[0].length;
  return tidyAsk(`${text.slice(0, start)}${text.slice(end)}`);
}
