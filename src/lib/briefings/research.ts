import { readFileSync } from 'node:fs';
import path from 'node:path';
import { robotsAllowsPath } from '@/lib/recipes/menu-robots';
import {
  microdollarsForPlacesUnit,
  placesSkuLabel,
  type PlacesFactDraft,
  type PlacesLookupResult,
} from '@/lib/briefings/places';
import { restaurantFactsGuideForPrompt } from '@/lib/briefings/facts-guide-module';
import { RESTAURANT_FACTS_GUIDE } from '@/lib/briefings/restaurant-facts-guide.generated';
import {
  BRIEFING_FIELDS,
  briefingSourceLabel,
  isBriefingField,
  type BriefingField,
} from '@/lib/briefings/types';

/** Same pinned snapshot as Discover chat. Not a moving alias. */
export const BRIEFING_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Published ai_price_rates for that snapshot (microdollars per million tokens).
 * An operator estimate for this script. It does not write the AI ledger.
 */
export const HAIKU_MICRODOLLARS_PER_MILLION: Record<string, number> = {
  input: 1_000_000,
  output: 5_000_000,
  cache_write_5m: 1_250_000,
  cache_write_1h: 2_000_000,
  cache_read: 100_000,
};

export const BRIEFING_PAGE_CAP = 3;
/** Same-host official subpages fetched after the search-page cap is filled. */
export const BRIEFING_OFFICIAL_SUBPAGE_CAP = 4;
/** Extra candidates so a disallowed path does not end the subpage walk. */
export const BRIEFING_SUBPAGE_CANDIDATE_CAP = 12;
export const BRIEFING_PAGE_CHARS = 8_000;
/**
 * Read this many HTML bytes and keep the prefix. Oversized pages are truncated,
 * not dropped. 1.5 MB in decimal bytes.
 */
export const BRIEFING_HTML_BYTE_CAP = 1_500_000;
export const BRIEFING_MAX_OUTPUT_TOKENS = 700;
export const BRIEFING_SEARCH_MAX_OUTPUT_TOKENS = 1_024;
export const DEFAULT_RESTAURANT_CAP = 25;
export const DEFAULT_COST_CAP_MICRODOLLARS = 2_000_000;
export const MAX_COST_CAP_MICRODOLLARS = 5_000_000;
export const BRIEFING_OUTPUT_DIR = '.briefings';
/** Identifies this operator script. Accept headers are browser-like; the UA stays explicit. */
export const BRIEFING_USER_AGENT =
  'WanderbiteBriefingResearchBot/1.0 (+https://wanderbite.com; first-visit research)';

/** Path or link text that often holds first-visit detail on an official site. */
export const BRIEFING_SUBPAGE_HINTS = [
  'menu',
  'about',
  'faq',
  'visit',
  'location',
  'contact',
  'hours',
  'reservations',
  'parking',
  'private-dining',
] as const;

/**
 * Current Messages API server tool (name `web_search`).
 * Haiku 4.5 cannot use the dynamic-filtering caller, so requests set
 * `allowed_callers` to `direct` and read URLs from the tool result.
 */
export const BRIEFING_WEB_SEARCH_TOOL = 'web_search_20260318';
/** Anthropic bills each completed search. Cap uses per restaurant. */
export const BRIEFING_WEB_SEARCH_MAX_USES = 5;
/** Published price: $10 per 1,000 searches = 10,000 microdollars each. */
export const WEB_SEARCH_MICRODOLLARS_PER_REQUEST = 10_000;

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const SEARCH_TIMEOUT_MS = 60_000;
const SEARCH_CONTINUATION_CAP = 2;
const OWN_DOMAIN_FOLLOWUP =
  'Those results are listings or the wrong host. Search again for the restaurant\'s own website. Skip city guides, ordering marketplaces, social sites, and directories.';

const HOSTED_PROJECT_REF = 'yiajoycgiyxjvznndjge';
const FETCH_TIMEOUT_MS = 8_000;
/**
 * Redirects followed in one fetch chain. The response after the last redirect
 * can be the page. 10 matches the usual client default and covers the official
 * sites that failed at 3. One more redirect is "too many redirects".
 */
export const BRIEFING_REDIRECT_HOP_CAP = 10;
/** Dropped-fact text in the dry-run report. The stored candidate can be longer. */
export const DROPPED_FACT_TEXT_CAP = 200;
const PAGE_REQUEST_HEADERS: Record<string, string> = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
  'accept-language': 'en-US,en;q=0.9',
  'user-agent': BRIEFING_USER_AGENT,
};
const TRACKING_PARAMS = [
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'utm_campaign',
  'utm_content',
  'utm_id',
  'utm_medium',
  'utm_source',
  'utm_term',
];
const SUBPAGE_SKIP_EXTENSION =
  /\.(?:avif|bmp|css|gif|ico|jpe?g|js|mjs|mp3|mp4|pdf|png|svg|webm|webp|woff2?|zip)$/i;

const LISTING_HOSTS = [
  'yelp.com',
  'tripadvisor.com',
  'opentable.com',
  'resy.com',
  'exploretock.com',
  'guide.michelin.com',
  'theinfatuation.com',
  'eater.com',
  'timeout.com',
  'zagat.com',
  'visitmckinney.com',
  'toasttab.com',
  'roadtrippers.com',
  'mindtrip.ai',
  'joe.coffee',
];

/**
 * Thin auto-generated restaurant directories. Checked on the hostname only.
 * A match is skipped before fetch: no page slot, and it does not by itself
 * start another web search.
 *
 * - hey-rest: generated directory pages. One of these stated a multi-storey car park.
 * - restaurantji.com: one templated page per restaurant from scraped fragments.
 * - sluurp.com: the same kind of thin generated restaurant page.
 *
 * `hey-rest` must not match a longer token such as hey-restaurant.
 */
export const WEAK_AGGREGATOR_HOSTS: readonly { id: string; host: RegExp }[] = [
  { id: 'hey-rest', host: /hey-rest(?:[^a-z0-9]|$)/i },
  { id: 'restaurantji.com', host: /(?:^|\.)restaurantji\.com$/i },
  { id: 'sluurp.com', host: /(?:^|\.)sluurp\.com$/i },
];

const SKIP_HOSTS = [
  'duckduckgo.com',
  'bing.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'googleapis.com',
  'gstatic.com',
  'googleusercontent.com',
  'wikipedia.org',
  'tiktok.com',
  'nextdoor.com',
];

/**
 * Common briefing words. They do not count toward the share that keeps a fact.
 * "parking" and "street" alone must not carry an invented detail.
 */
const GENERIC_CONTENT_WORDS = new Set([
  'about',
  'after',
  'around',
  'available',
  'before',
  'during',
  'guest',
  'guests',
  'hours',
  'inside',
  'located',
  'location',
  'minute',
  'minutes',
  'nearby',
  'outside',
  'parking',
  'place',
  'private',
  'public',
  'restaurant',
  'space',
  'spots',
  'staff',
  'street',
  'streets',
  'their',
  'there',
  'typical',
  'visit',
  'visits',
  'where',
  'which',
  'while',
  'would',
]);

/** Two thirds of the distinctive words must sit in the same passage. */
const SUPPORT_SHARE_NUMERATOR = 2;
const SUPPORT_SHARE_DENOMINATOR = 3;
const PASSAGE_WORD_CAP = 60;

const STOP_WORDS = new Set([
  'about',
  'after',
  'before',
  'their',
  'there',
  'which',
  'where',
  'while',
  'would',
  'could',
  'should',
  'visit',
  'restaurant',
  'typical',
  'minutes',
  'minute',
  'hours',
  'guests',
  'guest',
  'sample',
]);

export type BriefingRestaurant = {
  id: string;
  name: string;
  address: string | null;
  officialWebsite?: string | null;
  googlePlaceId?: string | null;
  lat?: number | null;
  lon?: number | null;
  /** Loaded for the test-restaurant skip. Absent in unit fixtures. */
  marketName?: string | null;
  marketSlug?: string | null;
  /** Partner org name. The restaurants table calls this org, not partner. */
  orgName?: string | null;
};

export type DroppedFact = {
  field: string | null;
  text: string | null;
  sourceUrl: string | null;
  reason: string;
};

export type SkippedTestRestaurant = {
  name: string;
  reason: string;
};

export type SupportedFact = {
  field: BriefingField;
  text: string;
  sourceUrl: string;
  /** Page passage the reviewer can compare with the fact. Not stored. */
  supportPassage: string;
  /** Optional model sentence. Grounding happens when a draft is built. */
  changeSummary?: string;
};

export type FetchedPage = {
  url: string;
  text: string;
  /** Raw HTML for review-body stripping. Omitted when the caller only has text. */
  html?: string;
};

export type ModelUsage = Record<string, number>;

export type BriefingModelCaller = (input: {
  system: string;
  user: string;
}) => Promise<{ text: string; units: ModelUsage }>;

export type RestaurantResearchResult = {
  restaurantId: string;
  restaurantName: string;
  fetchedUrls: string[];
  facts: SupportedFact[];
  dropped: string[];
  /** Candidate facts the filter rejected. The report lists these in full. */
  droppedFacts?: DroppedFact[];
  units: ModelUsage;
  estimatedMicrodollars: number;
  notes: string[];
  /** Place id for this run. Storing it is allowed. Raw Places fields are not. */
  placeId?: string | null;
  /** Set when google_place_id is empty and this run matched a place. */
  placeIdToStore?: string | null;
};

export type BriefingRun = {
  verifiedAt: string;
  restaurants: RestaurantResearchResult[];
  stoppedBecause: string | null;
  totals: { input: number; output: number; estimatedMicrodollars: number };
  /** Set by the operator script. Omitted in older callers, which hide the header. */
  skippedTestRestaurants?: readonly SkippedTestRestaurant[];
  includeTestRestaurants?: boolean;
};

export type BriefingInsert = {
  restaurant_id: string;
  field: BriefingField;
  body: string;
  source_url: string;
  last_verified_at: string;
  status: 'paused';
  is_sample: false;
  version: 1;
};

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

/** www and the apex host are the same official site. Other subdomains are not. */
export function officialHostKey(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '');
}

export function sameOfficialHost(leftUrl: string, rightUrl: string): boolean {
  try {
    return officialHostKey(new URL(leftUrl).hostname) === officialHostKey(new URL(rightUrl).hostname);
  } catch {
    return false;
  }
}

function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return false;
  }
  if (host.includes(':') || host.includes('%')) return false;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return true;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  return true;
}

export function normalizeHttpsUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (!isPublicHost(url.hostname)) return null;
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

export function estimateMicrodollars(units: ModelUsage): number {
  let total = 0;
  for (const [kind, count] of Object.entries(units)) {
    if (!Number.isFinite(count) || count <= 0) continue;
    if (kind === 'web_search_requests') {
      total += Math.trunc(count) * WEB_SEARCH_MICRODOLLARS_PER_REQUEST;
      continue;
    }
    const placesRate = microdollarsForPlacesUnit(kind);
    if (placesRate != null) {
      total += Math.trunc(count) * placesRate;
      continue;
    }
    const rate = HAIKU_MICRODOLLARS_PER_MILLION[kind];
    if (!rate) continue;
    total += Math.round((count * rate) / 1_000_000);
  }
  return total;
}

export function mergeModelUsage(left: ModelUsage, right: ModelUsage): ModelUsage {
  const merged: ModelUsage = { ...left };
  for (const [kind, count] of Object.entries(right)) {
    if (!Number.isFinite(count) || count <= 0) continue;
    merged[kind] = (merged[kind] ?? 0) + Math.trunc(count);
  }
  return merged;
}

export function formatEstimatedUsd(microdollars: number): string {
  return (microdollars / 1_000_000).toFixed(6);
}

export function hostedSupabaseUrl(supabaseUrl: string): boolean {
  if (supabaseUrl.includes(HOSTED_PROJECT_REF)) return true;
  try {
    const host = new URL(supabaseUrl).hostname;
    return host.endsWith('.supabase.co') || host.endsWith('.supabase.com');
  } catch {
    return true;
  }
}

/** Dry-run and --write both refuse hosted until Noah sets the one-run OK. */
export function briefingResearchAllowed(
  supabaseUrl: string,
  env: Record<string, string | undefined> = process.env,
): { ok: true } | { ok: false; reason: string } {
  const url = supabaseUrl.trim();
  if (!url) return { ok: false, reason: 'Refused. NEXT_PUBLIC_SUPABASE_URL is not set.' };
  if (hostedSupabaseUrl(url) && env.WANDERBITE_BRIEFINGS_HOSTED_OK !== '1') {
    return {
      ok: false,
      reason:
        'Refused. Running this script against hosted needs Noah\'s separate OK, then WANDERBITE_BRIEFINGS_HOSTED_OK=1 for that run only.',
    };
  }
  return { ok: true };
}

export function parseBriefingArgs(argv: readonly string[]): {
  help: boolean;
  write: boolean;
  includeTest: boolean;
  restaurantCap: number;
  costCapMicrodollars: number;
  error?: string;
} {
  let help = false;
  let write = false;
  let includeTest = false;
  let restaurantCap = DEFAULT_RESTAURANT_CAP;
  let costCapMicrodollars = DEFAULT_COST_CAP_MICRODOLLARS;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--write') write = true;
    else if (arg === '--include-test') includeTest = true;
    else if (arg === '--limit') {
      const value = Number(argv[i + 1]);
      i += 1;
      if (!Number.isInteger(value) || value < 1) {
        return {
          help,
          write,
          includeTest,
          restaurantCap,
          costCapMicrodollars,
          error: '--limit must be a positive integer',
        };
      }
      restaurantCap = Math.min(value, DEFAULT_RESTAURANT_CAP);
    } else if (arg === '--cost-cap-cents') {
      const value = Number(argv[i + 1]);
      i += 1;
      if (!Number.isInteger(value) || value < 1) {
        return {
          help,
          write,
          includeTest,
          restaurantCap,
          costCapMicrodollars,
          error: '--cost-cap-cents must be a positive integer',
        };
      }
      costCapMicrodollars = Math.min(value * 10_000, MAX_COST_CAP_MICRODOLLARS);
    } else {
      return {
        help,
        write,
        includeTest,
        restaurantCap,
        costCapMicrodollars,
        error: `Unknown argument ${arg}`,
      };
    }
  }
  return { help, write, includeTest, restaurantCap, costCapMicrodollars };
}

export function weakAggregatorLabel(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  const hit = WEAK_AGGREGATOR_HOSTS.find((entry) => entry.host.test(host));
  return hit?.id ?? null;
}

function markedTestLabel(value: string | null | undefined): boolean {
  const label = value?.trim().toLowerCase() ?? '';
  if (!label) return false;
  if (label.includes('(not real)') || /\bnot\s+real\b/.test(label)) return true;
  return /(?:^|[^a-z0-9])(?:qa|test|fixture)(?:[^a-z0-9]|$)/.test(label);
}

/** Null when this restaurant should be researched. One reason, name before market before partner. */
export function testRestaurantSkipReason(
  restaurant: Pick<BriefingRestaurant, 'name' | 'marketName' | 'marketSlug' | 'orgName'>,
): string | null {
  const name = restaurant.name.trim();
  if (/\(not real\)/i.test(name)) return 'name contains "(not real)"';
  if (/^qa(?:\s|$)/i.test(name)) return 'name starts with "QA "';
  if (/^test(?:\s|$)/i.test(name)) return 'name starts with "Test "';
  if (markedTestLabel(restaurant.marketName) || markedTestLabel(restaurant.marketSlug)) {
    const label = restaurant.marketName?.trim() || restaurant.marketSlug?.trim() || 'market';
    return `market "${label}" is marked test`;
  }
  if (markedTestLabel(restaurant.orgName)) {
    return `partner "${restaurant.orgName?.trim()}" is marked test`;
  }
  return null;
}

export function partitionBriefingRestaurants<T extends BriefingRestaurant>(
  restaurants: readonly T[],
  includeTest: boolean,
): { selected: T[]; skippedTestRestaurants: SkippedTestRestaurant[] } {
  if (includeTest) return { selected: [...restaurants], skippedTestRestaurants: [] };
  const selected: T[] = [];
  const skippedTestRestaurants: SkippedTestRestaurant[] = [];
  for (const restaurant of restaurants) {
    const reason = testRestaurantSkipReason(restaurant);
    if (reason) skippedTestRestaurants.push({ name: restaurant.name, reason });
    else selected.push(restaurant);
  }
  return { selected, skippedTestRestaurants };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The web search is pinned to McKinney. That city word shows up in restaurant
 * names and on city-guide hosts, so it never counts as the restaurant's name.
 */
const LAUNCH_PLACE_TOKENS = ['mckinney'] as const;

const STATE_NAMES: Record<string, string> = {
  tx: 'texas',
};

const REGION_WORDS = new Set(['tx', 'texas']);

const CHAIN_LOCATION_MARKERS = new Set(['location', 'locations', 'store', 'stores']);

const CONTENT_WORDS = new Set([
  'about',
  'contact',
  'event',
  'events',
  'faq',
  'galleries',
  'gallery',
  'home',
  'hours',
  'index',
  'menu',
  'menus',
  'parking',
  'photo',
  'photos',
  'reservation',
  'reservations',
  'story',
  'visit',
]);

function addPlaceWords(tokens: Set<string>, value: string): void {
  for (const word of value.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 4 && /[a-z]/.test(word)) tokens.add(word);
  }
}

/** City and region words. A host match on these is not the restaurant. */
function locationTokens(address: string | null | undefined): string[] {
  const tokens = new Set<string>(LAUNCH_PLACE_TOKENS);
  const parts = (address ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  let city = '';
  let region = '';
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (/^[a-z]{2}\b/i.test(parts[i] ?? '')) {
      region = parts[i] ?? '';
      city = parts[i - 1] ?? '';
      break;
    }
  }
  if (!region && parts.length >= 2) {
    city = parts[parts.length - 2] ?? '';
    region = parts[parts.length - 1] ?? '';
  }
  addPlaceWords(tokens, city);
  addPlaceWords(tokens, region);
  const abbrev = /^([a-z]{2})\b/i.exec(region)?.[1]?.toLowerCase();
  const stateName = abbrev ? STATE_NAMES[abbrev] : undefined;
  if (stateName) tokens.add(stateName);
  return [...tokens];
}

function nameTokens(name: string, address?: string | null): string[] {
  const places = new Set(locationTokens(address));
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (token) => token.length >= 4 && token !== 'cafe' && token !== 'the' && !places.has(token),
    );
}

function pathSegments(pathname: string): string[] {
  return pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/\.html?$/i, ''));
}

function segmentIsPlaceSlug(segment: string, places: readonly string[]): boolean {
  const words = segment
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;
  const place = new Set(places);
  return words.every((word) => place.has(word) || REGION_WORDS.has(word));
}

function segmentIsContent(segment: string): boolean {
  const lower = segment.toLowerCase();
  if (lower === 'private-dining' || lower === 'our-story') return true;
  if (CONTENT_WORDS.has(lower)) return true;
  return lower
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some((word) => CONTENT_WORDS.has(word));
}

/** `/locations/mckinney` or a bare city slug. Content under that slug is dropped. */
function chainLocationPath(pathname: string, places: readonly string[]): string | null {
  const segments = pathSegments(pathname);
  if (segments.length === 0) return null;
  const markerAt = segments.findIndex((segment) => CHAIN_LOCATION_MARKERS.has(segment.toLowerCase()));
  if (markerAt >= 0 && markerAt < segments.length - 1) {
    return `/${segments.slice(0, markerAt + 2).join('/')}`;
  }
  if (segments.length === 1 && segmentIsPlaceSlug(segments[0] ?? '', places)) {
    return `/${segments[0]}`;
  }
  return null;
}

function prefersHomepage(pathname: string): boolean {
  const segments = pathSegments(pathname);
  if (segments.length === 0) return false;
  if (segments.length === 1 && CHAIN_LOCATION_MARKERS.has((segments[0] ?? '').toLowerCase())) return true;
  return segments.some((segment) => segmentIsContent(segment));
}

/**
 * Store the site root for a content path such as /gallery or /visit.
 * A multi-location chain keeps its location page.
 */
export function canonicalOfficialWebsite(raw: string, address?: string | null): string | null {
  const normalized = normalizeHttpsUrl(raw);
  if (!normalized) return null;
  const url = new URL(normalized);
  const locationPath = chainLocationPath(url.pathname, locationTokens(address));
  if (locationPath) {
    url.pathname = locationPath;
    url.search = '';
    return normalizeHttpsUrl(url.toString()) ?? normalized;
  }
  if (!prefersHomepage(url.pathname)) return normalized;
  url.pathname = '/';
  url.search = '';
  return url.toString();
}

function matchesStoredHost(host: string, officialHosts: readonly string[]): boolean {
  const key = officialHostKey(host);
  return officialHosts.some((candidate) => officialHostKey(candidate) === key);
}

function urlClass(
  raw: string,
  restaurantName: string,
  officialHosts: readonly string[],
  address?: string | null,
): 'official' | 'listing' | 'blocked' | 'other' {
  const normalized = normalizeHttpsUrl(raw);
  if (!normalized) return 'blocked';
  const url = new URL(normalized);
  const host = url.hostname;
  if (SKIP_HOSTS.some((suffix) => hostMatches(host, suffix))) return 'blocked';
  if (weakAggregatorLabel(host)) return 'blocked';
  if (host === 'google.com' || host === 'www.google.com' || host === 'maps.google.com') {
    return url.pathname.startsWith('/maps') ? 'listing' : 'blocked';
  }
  if (LISTING_HOSTS.some((suffix) => hostMatches(host, suffix))) return 'listing';
  if (matchesStoredHost(host, officialHosts)) return 'official';
  const tokens = nameTokens(restaurantName, address);
  if (tokens.some((token) => host.includes(token))) return 'official';
  return 'other';
}

function needsOwnDomainSearch(urls: readonly string[], restaurant: BriefingRestaurant): boolean {
  const considered = urls.filter((url) => {
    const normalized = normalizeHttpsUrl(url);
    if (!normalized) return false;
    return weakAggregatorLabel(new URL(normalized).hostname) == null;
  });
  if (considered.length === 0) return false;
  return considered.every((url) => {
    const kind = urlClass(url, restaurant.name, [], restaurant.address);
    return kind === 'listing' || kind === 'blocked';
  });
}

function classifyUrl(
  raw: string,
  restaurantName: string,
  officialHosts: readonly string[] = [],
  address?: string | null,
): 'official' | 'listing' | 'skip' {
  const kind = urlClass(raw, restaurantName, officialHosts, address);
  if (kind === 'official') return 'official';
  if (kind === 'listing') return 'listing';
  return 'skip';
}

/**
 * Official hosts first, then reputable listings. The page cap is applied later,
 * after robots.txt, so a disallowed listing does not consume a slot.
 */
export function rankBriefingUrls(
  urls: readonly string[],
  restaurantName: string,
  officialHosts: readonly string[] = [],
  address?: string | null,
): string[] {
  const official: string[] = [];
  const listings: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const normalized = normalizeHttpsUrl(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const kind = classifyUrl(normalized, restaurantName, officialHosts, address);
    if (kind === 'official') official.push(normalized);
    else if (kind === 'listing') listings.push(normalized);
  }
  return [...official, ...listings];
}

/**
 * A name-token host, or the first https host that is not a listing and not blocked.
 * City and location tokens do not count. A rejected host does not end the scan.
 * Content paths collapse to the site root. A chain location path stays.
 */
export function proposeOfficialFromUrls(
  urls: readonly string[],
  restaurantName: string,
  address?: string | null,
): { url: string | null; kind: 'official' | 'unclassified' | 'none' } {
  let unclassified: string | null = null;
  const seen = new Set<string>();
  for (const raw of urls) {
    const normalized = normalizeHttpsUrl(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const kind = urlClass(normalized, restaurantName, [], address);
    if (kind === 'official') {
      return { url: canonicalOfficialWebsite(normalized, address) ?? normalized, kind: 'official' };
    }
    if (kind === 'other' && !unclassified) unclassified = normalized;
  }
  if (unclassified) {
    return { url: canonicalOfficialWebsite(unclassified, address) ?? unclassified, kind: 'unclassified' };
  }
  return { url: null, kind: 'none' };
}

export function isStorableOfficialWebsite(
  raw: string,
  restaurantName: string,
  address?: string | null,
): boolean {
  const normalized = normalizeHttpsUrl(raw);
  if (!normalized) return false;
  const kind = urlClass(normalized, restaurantName, [], address);
  return kind === 'official' || kind === 'other';
}

function tokenHitsHint(word: string, hint: string): boolean {
  if (word === hint || word === `${hint}s` || word === `${hint}es`) return true;
  if (hint.endsWith('s') && word === hint.slice(0, -1)) return true;
  return false;
}

function matchingSubpageHint(pathname: string, text: string): string | null {
  const words = `${pathname} ${text}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const joined = words.join(' ');
  for (const hint of BRIEFING_SUBPAGE_HINTS) {
    if (hint.includes('-')) {
      const parts = hint.split('-');
      if (joined.includes(parts.join(' ')) || words.includes(parts.join(''))) return hint;
      continue;
    }
    if (words.some((word) => tokenHitsHint(word, hint))) return hint;
  }
  return null;
}

function hrefFromAttributes(attributes: string): string | null {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(attributes);
  if (!match) return null;
  const href = (match[1] ?? match[2] ?? match[3] ?? '').trim();
  return href || null;
}

function cleanPageUrl(raw: string, base: string): string | null {
  let resolved: URL;
  try {
    resolved = new URL(raw, base);
  } catch {
    return null;
  }
  for (const key of TRACKING_PARAMS) resolved.searchParams.delete(key);
  return normalizeHttpsUrl(resolved.toString());
}

function orderSubpageUrls(found: Array<{ url: string; hint: string }>, cap: number): string[] {
  const picked: string[] = [];
  const seenUrls = new Set<string>();
  const seenHints = new Set<string>();
  const take = (item: { url: string; hint: string }, onePerHint: boolean) => {
    if (picked.length >= cap || seenUrls.has(item.url)) return;
    if (onePerHint && seenHints.has(item.hint)) return;
    seenUrls.add(item.url);
    seenHints.add(item.hint);
    picked.push(item.url);
  };
  for (const item of found) take(item, true);
  for (const item of found) take(item, false);
  return picked;
}

/**
 * Same-host links whose path or text matches a first-visit hint.
 * One link per hint comes first, in document order, then extra matches fill the cap.
 */
export function discoverOfficialSubpages(
  html: string,
  pageUrl: string,
  cap = BRIEFING_SUBPAGE_CANDIDATE_CAP,
): string[] {
  const base = normalizeHttpsUrl(pageUrl);
  if (!base || cap < 1) return [];
  const found: Array<{ url: string; hint: string }> = [];
  const seen = new Set<string>([base]);
  const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  let scanned = 0;
  while ((match = anchor.exec(html))) {
    scanned += 1;
    if (scanned > 500 || found.length >= 40) break;
    const href = hrefFromAttributes(match[1] ?? '');
    if (!href || href.startsWith('#') || /^(?:mailto|tel|javascript|data):/i.test(href)) continue;
    const normalized = cleanPageUrl(href, base);
    if (!normalized || seen.has(normalized) || !sameOfficialHost(base, normalized)) continue;
    const path = new URL(normalized).pathname;
    if (SUBPAGE_SKIP_EXTENSION.test(path)) continue;
    const hint = matchingSubpageHint(path, htmlToText(match[2] ?? ''));
    if (!hint) continue;
    seen.add(normalized);
    found.push({ url: normalized, hint });
  }
  return orderSubpageUrls(found, cap);
}

function contentWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]{5,}/g)?.filter((word) => !STOP_WORDS.has(word)) ?? [];
}

function distinctiveWords(text: string): string[] {
  return [...new Set(contentWords(text).filter((word) => !GENERIC_CONTENT_WORDS.has(word)))];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWord(passage: string, word: string): boolean {
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9])${escapeRegExp(word)}(?:[^A-Za-z0-9]|$)`, 'i');
  return pattern.test(passage);
}

function hasWholeNumber(passage: string, num: string): boolean {
  const pattern = new RegExp(`(?:^|\\D)${escapeRegExp(num)}(?:\\D|$)`);
  return pattern.test(passage);
}

function normalizeClock(value: string): string {
  return value.toLowerCase().replace(/\./g, '').replace(/\s+/g, '');
}

function normalizePrice(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

const TIME_SOURCE =
  '\\b(?:noon|midnight|\\d{1,2}:\\d{2}\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?|\\d{1,2}\\s*(?:a\\.?m\\.?|p\\.?m\\.?))\\b';
const PRICE_SOURCE = '\\$\\s?\\d+(?:\\.\\d{1,2})?|\\b\\d+(?:\\.\\d{1,2})?\\s*(?:dollars|usd)\\b';
const NUMBER_SOURCE = '\\d+(?:\\.\\d+)?';

function matchAll(text: string, source: string): string[] {
  return [...text.matchAll(new RegExp(source, 'gi'))].map((match) => match[0]);
}

type FactAnchors = {
  numbers: string[];
  times: string[];
  prices: string[];
  properNouns: string[];
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function extractAnchors(factText: string): FactAnchors {
  const times = unique(matchAll(factText, TIME_SOURCE).map(normalizeClock));
  const prices = unique(matchAll(factText, PRICE_SOURCE).map(normalizePrice));
  const numbers = unique(matchAll(factText, NUMBER_SOURCE));
  const properNouns: string[] = [];
  const token = /[A-Za-z][A-Za-z'’.-]*/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(factText))) {
    const word = match[0];
    const before = factText.slice(0, match.index).trimEnd();
    const sentenceStart = before.length === 0 || /[.!?]$/.test(before);
    const allCaps = word.length >= 3 && word === word.toUpperCase() && /[A-Z]/.test(word);
    const midSentenceName = /^[A-Z]/.test(word) && word.length >= 2 && !sentenceStart;
    if (allCaps || midSentenceName) properNouns.push(word);
  }
  return { numbers, times, prices, properNouns: unique(properNouns) };
}

function anchorsInPassage(anchors: FactAnchors, passage: string): boolean {
  if (anchors.numbers.some((num) => !hasWholeNumber(passage, num))) return false;
  const passageTimes = unique(matchAll(passage, TIME_SOURCE).map(normalizeClock));
  if (anchors.times.some((time) => !passageTimes.includes(time))) return false;
  const passagePrices = unique(matchAll(passage, PRICE_SOURCE).map(normalizePrice));
  if (anchors.prices.some((price) => !passagePrices.includes(price))) return false;
  if (anchors.properNouns.some((name) => !hasWord(passage, name))) return false;
  return true;
}

function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function passageWindows(pageText: string): string[] {
  const flat = pageText.replace(/\s+/g, ' ').trim();
  if (!flat) return [];
  const sentences = flat.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.length > 0);
  const windows: string[] = [];
  const push = (text: string) => {
    const words = wordsOf(text);
    if (words.length === 0) return;
    if (words.length <= PASSAGE_WORD_CAP) {
      windows.push(words.join(' '));
      return;
    }
    for (let start = 0; start < words.length; start += 10) {
      windows.push(words.slice(start, start + 40).join(' '));
      if (start + 40 >= words.length) break;
    }
  };
  const parts = sentences.length > 0 ? sentences : [flat];
  for (let index = 0; index < parts.length; index += 1) {
    push(parts[index] ?? '');
    if (index + 1 < parts.length) push(`${parts[index]} ${parts[index + 1]}`);
  }
  return windows;
}

const FUNCTION_WORDS = new Set([
  'about',
  'after',
  'also',
  'and',
  'are',
  'been',
  'before',
  'being',
  'for',
  'from',
  'has',
  'have',
  'here',
  'into',
  'its',
  'our',
  'over',
  'that',
  'the',
  'their',
  'there',
  'these',
  'they',
  'this',
  'those',
  'was',
  'were',
  'where',
  'which',
  'while',
  'with',
  'you',
  'your',
]);

/**
 * Short words that flip a claim. They stay required even when under four letters.
 * "no" and "never" are included so a negative reservation claim cannot pass on a positive page.
 */
const POLARITY_WORDS = ['never', 'no', 'none', 'not', 'only', 'without'] as const;

/** Claim words that must be on the page. "Available" does not support "recommended". */
const STRICT_CLAIM_WORDS = ['recommended'] as const;

/**
 * Share of an item's content words that must sit in one passage. 3/4 is 75%.
 * Proper nouns, numbers, polarity, and strict claim words are required on top of this.
 */
const ITEM_SUPPORT_NUMERATOR = 3;
const ITEM_SUPPORT_DENOMINATOR = 4;
/** Content words shorter than this are ignored, except polarity and strict claims. */
const ITEM_CONTENT_MIN_LENGTH = 3;
/** known_for, vibe, and good_for keep a trimmed list only when at least this many items remain. */
const LIST_KEEP_MINIMUM = 2;

type FactCue = { pattern: RegExp };

const GOOD_FOR_CUES: readonly FactCue[] = [
  { pattern: /\bdate[\s-]?nights?\b/i },
  { pattern: /\bgroups?\b/i },
  { pattern: /\bfamil(?:y|ies)\b/i },
  { pattern: /\bkids?\b|\bchildren\b|\bchild\b/i },
  { pattern: /\bsolo\b/i },
  { pattern: /\bsports?\b/i },
  { pattern: /\bbrunch\b/i },
  { pattern: /\bbusiness\b/i },
  { pattern: /\b(?:celebrations?|birthdays?|anniversar(?:y|ies))\b/i },
  { pattern: /\bwedding(?:s)?\b/i },
  { pattern: /\brehearsal\s+dinners?\b/i },
  { pattern: /\b(?:corporate|work)\s+(?:events?|meetings?|dinners?)\b/i },
  { pattern: /\bprivate\s+events?\b/i },
  { pattern: /\bfriends?\b/i },
  { pattern: /\blive\s+music\b/i },
  { pattern: /\bdogs?\b|\bdog[\s-]?friendly\b/i },
  { pattern: /\blunch(?:es)?\b/i },
  { pattern: /\bhappy\s+hours?\b/i },
  { pattern: /\bwatch(?:ing)?\s+(?:the\s+)?games?\b|\blawn\s+games?\b|\bgames?\b/i },
];

const RESERVATION_CUES: readonly FactCue[] = [
  { pattern: /\breserv(?:e|ed|ation|ations|able)\b/i },
  { pattern: /\bwalk[\s-]?ins?\b/i },
  { pattern: /\bwait[\s-]?lists?\b/i },
  { pattern: /\bfirst[\s-]come\b/i },
];

const SEATING_CUES: readonly FactCue[] = [
  { pattern: /\bpatios?\b/i },
  { pattern: /\brooftops?\b|\broof[\s-]?deck\b/i },
  { pattern: /\bbar\b/i },
  { pattern: /\bprivate\s+(?:rooms?|dining)\b/i },
  { pattern: /\bdog[\s-]?friendly\b|\bdogs?\b/i },
  { pattern: /\bbooths?\b/i },
  { pattern: /\boutdoor\b/i },
  { pattern: /\bcounters?\b/i },
];

const CUE_FIELDS: Partial<Record<BriefingField, { cues: readonly FactCue[]; filler: ReadonlySet<string> }>> = {
  good_for: {
    cues: GOOD_FOR_CUES,
    filler: new Set(['good', 'well', 'guests', 'people', 'dining', 'works', 'suitable']),
  },
  reservations: {
    cues: RESERVATION_CUES,
    filler: new Set(['please', 'guests']),
  },
  seating: {
    cues: SEATING_CUES,
    filler: new Set(['seating', 'seats', 'seat', 'available', 'listed']),
  },
};

const KNOWN_FOR_FILLER = new Set([
  'also',
  'classic',
  'classics',
  'dish',
  'dishes',
  'drink',
  'drinks',
  'famous',
  'house',
  'item',
  'items',
  'known',
  'made',
  'menu',
  'plus',
  'popular',
  'restaurant',
  'served',
  'serves',
  'serving',
  'signature',
  'specials',
  'specialty',
]);

const VIBE_FILLER = new Set([
  'ambiance',
  'ambience',
  'atmosphere',
  'dining',
  'feeling',
  'feels',
  'inside',
  'overall',
  'place',
  'restaurant',
  'room',
  'space',
  'vibe',
]);

const FIELD_SPECIFIC = new Set<BriefingField>(['vibe', 'known_for', 'good_for', 'seating', 'reservations']);

/** A review comment cannot be the only support for these. Listing amenities can. */
const PHYSICAL_FEATURE_FIELDS = new Set<BriefingField>(['parking', 'arrival', 'accessibility', 'seating']);

const STEM_IRREGULAR: Record<string, string> = {
  child: 'child',
  children: 'child',
  families: 'family',
  family: 'family',
  kid: 'child',
  kids: 'child',
};

type BlockCategory = 'phone' | 'email' | 'url' | 'price' | 'promo' | 'hours' | 'meta';

type RemovedBlock = { text: string; category: BlockCategory };

const BLOCK_PRIORITY: readonly BlockCategory[] = ['phone', 'email', 'url', 'price', 'promo', 'hours', 'meta'];

const PHONE_PATTERN = /(?:\+?1[\s.-]*)?(?:\(\s*\d{3}\s*\)|\b\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/i;
const PRICE_PATTERN = /\$\s?\d|\b\d+(?:\.\d{1,2})?\s*(?:dollars|usd)\b/i;
const PROMO_PATTERN =
  /\b(?:discounts?|promos?|promotions?|coupons?|bogo|complimentary)\b|\b\d+\s*%\s*off\b|\bpercent off\b|\bspecial offer\b|\b(?:eat|drinks?)\s+free\b|\bfree\s+(?:with|on|appetizer|dessert|entr(?:e|é)e|drink|meal|item)s?\b/i;
const META_PATTERN =
  /\bnot mentioned\b|\b(?:is|are|was|were|isn'?t|aren'?t)\s+(?:not\s+)?mentioned\b|\bthe (?:website|site|page|source) (?:says|said|states|stated|mentions|mentioned|does not)\b|\baccording to\b|\bdoes not (?:say|mention|state)\b/i;
const DAY_WORD =
  '(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?';
const DAY_RANGE_SOURCE = `\\b${DAY_WORD}\\b\\s*(?:through|thru|to|–|—|-)\\s*\\b${DAY_WORD}\\b`;
const PLURAL_DAY_SOURCE = '\\b(?:mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\\b';
const CLOCK_SOURCE =
  '\\b(?:(?:after|before|until|till|from|at|between|by)\\s+)?(?:noon|midnight|\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)|\\d{1,2}:\\d{2})(?:\\s*(?:to|through|until|–|—|-)\\s*(?:noon|midnight|\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?|\\d{1,2}:\\d{2}))?\\b';
const DAY_RANGE_PATTERN = new RegExp(DAY_RANGE_SOURCE, 'i');
const PLURAL_DAY_PATTERN = new RegExp(PLURAL_DAY_SOURCE, 'i');
const CLOCK_PATTERN = new RegExp(CLOCK_SOURCE, 'i');

function withoutCueHits(text: string, cues: readonly FactCue[]): string {
  let rest = text;
  for (const cue of cues) rest = rest.replace(new RegExp(cue.pattern.source, 'gi'), ' ');
  return rest;
}

function matchedCues(field: BriefingField, text: string): FactCue[] {
  const spec = CUE_FIELDS[field];
  if (!spec) return [];
  return spec.cues.filter((cue) => cue.pattern.test(text));
}

function fillerFor(field: BriefingField): ReadonlySet<string> {
  if (field === 'known_for') return new Set([...FUNCTION_WORDS, ...KNOWN_FOR_FILLER]);
  if (field === 'vibe') return new Set([...FUNCTION_WORDS, ...VIBE_FILLER]);
  const spec = CUE_FIELDS[field];
  return new Set([...FUNCTION_WORDS, ...(spec?.filler ?? [])]);
}

function factTokens(text: string): string[] {
  return text.match(/[A-Za-z0-9\u00C0-\u024F]+(?:-[A-Za-z0-9\u00C0-\u024F]+)*/g) ?? [];
}

function stemToken(token: string): string {
  const compact = token.toLowerCase().replace(/-/g, '');
  const irregular = STEM_IRREGULAR[compact];
  if (irregular) return irregular;
  if (compact.length > 3 && compact.endsWith('ies')) return `${compact.slice(0, -3)}y`;
  if (compact.length > 3 && compact.endsWith('s') && !compact.endsWith('ss')) return compact.slice(0, -1);
  return compact;
}

function passageStems(passage: string): Set<string> {
  const tokens = factTokens(passage).map((token) => token.toLowerCase());
  const stems = new Set<string>();
  for (const token of tokens) stems.add(stemToken(token));
  for (let index = 0; index < tokens.length - 1; index += 1) {
    stems.add(stemToken(`${tokens[index]}-${tokens[index + 1]}`));
  }
  return stems;
}

function contentStems(field: BriefingField, item: string): string[] {
  const skip = fillerFor(field);
  const cues = matchedCues(field, item);
  const source = cues.length > 0 ? withoutCueHits(item, cues) : item;
  const proper = new Set(extractAnchors(item).properNouns.map((word) => word.toLowerCase()));
  const polarity = new Set<string>(POLARITY_WORDS);
  const claims = new Set<string>(STRICT_CLAIM_WORDS);
  const stems: string[] = [];
  for (const token of factTokens(source)) {
    const lower = token.toLowerCase();
    if (proper.has(lower) || polarity.has(lower) || claims.has(lower) || skip.has(lower)) continue;
    if (lower.replace(/-/g, '').length < ITEM_CONTENT_MIN_LENGTH) continue;
    stems.push(stemToken(token));
  }
  return [...new Set(stems)];
}

function itemWords(item: string): Set<string> {
  return new Set(factTokens(item).map((token) => token.toLowerCase()));
}

function strictItemHolds(field: BriefingField, item: string, passage: string): boolean {
  if (!anchorsInPassage(extractAnchors(item), passage)) return false;
  const words = itemWords(item);
  for (const word of POLARITY_WORDS) {
    if (words.has(word) && !hasWord(passage, word)) return false;
  }
  for (const word of STRICT_CLAIM_WORDS) {
    if (words.has(word) && !hasWord(passage, word)) return false;
  }
  return matchedCues(field, item).every((cue) => cue.pattern.test(passage));
}

function shareMet(hits: number, total: number): boolean {
  if (total === 0) return true;
  return hits * ITEM_SUPPORT_DENOMINATOR >= total * ITEM_SUPPORT_NUMERATOR;
}

function itemHasAnchor(item: string): boolean {
  const anchors = extractAnchors(item);
  const words = itemWords(item);
  if (anchors.numbers.length + anchors.properNouns.length + anchors.times.length + anchors.prices.length > 0) {
    return true;
  }
  if (POLARITY_WORDS.some((word) => words.has(word))) return true;
  return STRICT_CLAIM_WORDS.some((word) => words.has(word));
}

/** One passage that holds this item's cues, anchors, and a 75% share of its content words. */
function findItemPassage(field: BriefingField, item: string, pageText: string): string | null {
  const stems = contentStems(field, item);
  const cues = matchedCues(field, item);
  if (stems.length === 0 && cues.length === 0 && !itemHasAnchor(item)) return null;
  let best: string | null = null;
  for (const passage of passageWindows(pageText)) {
    if (!strictItemHolds(field, item, passage)) continue;
    if (stems.length > 0) {
      const keys = passageStems(passage);
      const hits = stems.filter((stem) => keys.has(stem)).length;
      if (!shareMet(hits, stems.length)) continue;
    }
    if (!best || passage.length < best.length) best = passage;
  }
  return best;
}

function splitSentences(text: string): string[] {
  const saved: string[] = [];
  const shielded = text.replace(
    /\b(?:https?:\/\/|www\.)\S+|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b|\d+\.\d+/gi,
    (match) => {
      const body = /^(?:https?:\/\/|www\.)/i.test(match) ? match.replace(/[.!?]+$/g, '') : match;
      saved.push(body);
      return `\u0000${saved.length - 1}\u0000${match.slice(body.length)}`;
    },
  );
  return (shielded.match(/[^.!?]+(?:[.!?]+(?:\s|$)|$)/g) ?? [])
    .map((part) =>
      part
        .trim()
        .replace(/\u0000(\d+)\u0000/g, (_match, index: string) => saved[Number(index)] ?? '')
        .trim(),
    )
    .filter((part) => part.length > 0);
}

function cleanPiece(text: string): string {
  return text
    .replace(/[.!?]+$/g, '')
    .replace(/^(?:and|or)\s+/i, '')
    .replace(/\s+(?:and|or)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitListPieces(sentence: string): string[] {
  return sentence
    .split(/\s*;\s*|\s*,\s*|\s+\band\b\s+/i)
    .map((part) => cleanPiece(part))
    .filter((part) => part.length > 0);
}

function minimumSupportedItems(field: BriefingField, splitCount: number): number {
  if (field === 'reservations' || field === 'seating') return 1;
  if (splitCount <= 1) return 1;
  return LIST_KEEP_MINIMUM;
}

function readsAsSentence(text: string): boolean {
  const trimmed = text.trim();
  if (!/^[A-Z]/.test(trimmed) || !/[.!?]$/.test(trimmed)) return false;
  if (/^(?:and|or|but)\b/i.test(trimmed)) return false;
  const words = trimmed.replace(/[.!?]+$/g, '').split(/\s+/).filter(Boolean);
  return words.length >= 2;
}

function joinList(parts: readonly string[]): string {
  const cleaned = parts.map((part) => cleanPiece(part)).filter((part) => part.length > 0);
  let body = '';
  if (cleaned.length === 1) body = cleaned[0] ?? '';
  else if (cleaned.length === 2) body = `${cleaned[0]} and ${cleaned[1]}`;
  else body = `${cleaned.slice(0, -1).join(', ')}, and ${cleaned[cleaned.length - 1]}`;
  const sentence = `${body.charAt(0).toUpperCase()}${body.slice(1)}`;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

type ItemPiece = { text: string; passage: string | null };

function uniquePassages(passages: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const passage of passages) {
    if (seen.has(passage)) continue;
    seen.add(passage);
    unique.push(passage);
  }
  return unique;
}

function rebuildFieldText(
  factText: string,
  groups: readonly { sentence: string; pieces: readonly ItemPiece[] }[],
): string | null {
  const keptSentences: string[] = [];
  for (const group of groups) {
    const kept = group.pieces.filter((piece) => piece.passage);
    if (kept.length === 0) continue;
    if (kept.length === group.pieces.length) {
      keptSentences.push(group.sentence.trim());
      continue;
    }
    keptSentences.push(joinList(kept.map((piece) => piece.text)));
  }
  if (keptSentences.length === 0) return null;
  const text = keptSentences.join(' ');
  if (text === factText.trim()) return factText;
  return readsAsSentence(text) ? text : null;
}

type GroundedField = { text: string; passage: string; trimmed: string[] };

/**
 * List items may sit in different passages of the same page.
 * A trimmed list is kept when enough items remain and the result is still a sentence.
 * Returns null when the cue gate fails or too little of the fact is on the page.
 */
function groundFieldFact(field: BriefingField, factText: string, pageText: string): GroundedField | null {
  if (CUE_FIELDS[field] && matchedCues(field, factText).length === 0) return null;
  const groups = splitSentences(factText).map((sentence) => ({
    sentence,
    pieces: splitListPieces(sentence).map((text) => ({
      text,
      passage: findItemPassage(field, text, pageText),
    })),
  }));
  const pieces = groups.flatMap((group) => group.pieces);
  if (pieces.length === 0) return null;
  const supported = pieces.filter((piece) => piece.passage);
  if (supported.length < minimumSupportedItems(field, pieces.length)) return null;
  const trimmed = pieces.filter((piece) => !piece.passage).map((piece) => piece.text);
  const text = trimmed.length === 0 ? factText : rebuildFieldText(factText, groups);
  if (!text) return null;
  const passages = uniquePassages(supported.flatMap((piece) => (piece.passage ? [piece.passage] : [])));
  if (passages.length === 0) return null;
  return {
    text,
    passage: passages.length === 1 ? (passages[0] ?? '') : passages.join(' … '),
    trimmed,
  };
}

function findFieldSupportPassage(field: BriefingField, factText: string, pageText: string): string | null {
  const grounded = groundFieldFact(field, factText, pageText);
  if (!grounded || grounded.trimmed.length > 0) return null;
  return grounded.passage;
}

function blockCategory(text: string): BlockCategory | null {
  if (PHONE_PATTERN.test(text)) return 'phone';
  if (EMAIL_PATTERN.test(text)) return 'email';
  if (URL_PATTERN.test(text)) return 'url';
  if (PRICE_PATTERN.test(text)) return 'price';
  if (PROMO_PATTERN.test(text)) return 'promo';
  if (META_PATTERN.test(text)) return 'meta';
  if (DAY_RANGE_PATTERN.test(text) || PLURAL_DAY_PATTERN.test(text) || CLOCK_PATTERN.test(text)) return 'hours';
  return null;
}

function tidyClause(text: string): string {
  return text
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/^(?:and|or|but)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function exciseHours(clause: string): { text: string; phrases: string[] } {
  const phrases: string[] = [];
  let text = clause;
  for (const source of [DAY_RANGE_SOURCE, PLURAL_DAY_SOURCE, CLOCK_SOURCE]) {
    text = text.replace(new RegExp(source, 'gi'), (match) => {
      phrases.push(match.trim());
      return ' ';
    });
  }
  return { text: tidyClause(text), phrases };
}

function clauseWordCount(text: string): number {
  return tidyClause(text)
    .replace(/[.!?]+$/g, '')
    .split(/\s+/)
    .filter((word) => /[A-Za-z]/.test(word)).length;
}

function splitClauses(sentence: string): string[] {
  return sentence
    .split(/\s*;\s*|\s*,\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function primaryCategory(removed: readonly RemovedBlock[]): BlockCategory {
  return BLOCK_PRIORITY.find((category) => removed.some((piece) => piece.category === category)) ?? 'meta';
}

function blockedDetailReason(removed: readonly RemovedBlock[]): string | null {
  if (removed.length === 0) return null;
  return `blocked detail (${primaryCategory(removed)})`;
}

function stripSentence(sentence: string): { text: string | null; removed: RemovedBlock[] } {
  const removed: RemovedBlock[] = [];
  const kept: string[] = [];
  let changed = false;
  for (const clause of splitClauses(sentence)) {
    const category = blockCategory(clause);
    if (!category) {
      kept.push(clause);
      continue;
    }
    changed = true;
    if (category === 'hours') {
      const excised = exciseHours(clause);
      if (clauseWordCount(excised.text) >= 3 && !blockCategory(excised.text)) {
        for (const phrase of excised.phrases) removed.push({ text: phrase, category: 'hours' });
        kept.push(excised.text);
        continue;
      }
    }
    removed.push({ text: tidyClause(clause), category });
  }
  if (!changed) return { text: sentence.trim(), removed };
  if (kept.length === 0) return { text: null, removed };
  const joined = joinList(kept);
  return readsAsSentence(joined) ? { text: joined, removed } : { text: null, removed };
}

/** Drop or cut phone, email, URL, price, promo, hours, and source commentary. */
function stripBlockedDetails(fact: string): { text: string | null; removed: RemovedBlock[] } {
  const removed: RemovedBlock[] = [];
  const kept: string[] = [];
  let changed = false;
  for (const sentence of splitSentences(fact)) {
    const stripped = stripSentence(sentence);
    removed.push(...stripped.removed);
    if (stripped.text !== sentence.trim()) changed = true;
    if (stripped.text) kept.push(stripped.text);
    else changed = true;
  }
  if (kept.length === 0) return { text: null, removed };
  if (!changed) return { text: fact, removed };
  const text = kept.join(' ');
  return readsAsSentence(text) ? { text, removed } : { text: null, removed };
}

/**
 * A fact stays only when one passage of this page holds a two-thirds share of
 * its distinctive words and every number, time, price, and proper noun in it.
 * Generic words such as "parking" and "street" do not carry the fact.
 * vibe, known_for, good_for, seating, and reservations match each list item on
 * this page. Items may sit in different passages. A partial list is not a full match.
 */
export function findSupportPassage(
  factText: string,
  pageText: string,
  field?: BriefingField,
): string | null {
  if (field && FIELD_SPECIFIC.has(field)) return findFieldSupportPassage(field, factText, pageText);
  return findGenericSupportPassage(factText, pageText);
}

function findGenericSupportPassage(factText: string, pageText: string): string | null {
  const distinctive = distinctiveWords(factText);
  if (distinctive.length === 0) return null;
  const anchors = extractAnchors(factText);
  let best: { passage: string; hits: number } | null = null;
  for (const passage of passageWindows(pageText)) {
    if (!anchorsInPassage(anchors, passage)) continue;
    const hits = distinctive.filter((word) => hasWord(passage, word)).length;
    if (hits * SUPPORT_SHARE_DENOMINATOR < distinctive.length * SUPPORT_SHARE_NUMERATOR) continue;
    if (!best || hits > best.hits || (hits === best.hits && passage.length < best.passage.length)) {
      best = { passage, hits };
    }
  }
  return best?.passage ?? null;
}

export function groundedInPage(factText: string, pageText: string): boolean {
  return findSupportPassage(factText, pageText) != null;
}

const REVIEW_OPEN_TAG = /<([A-Za-z][\w:-]*)\b([^>]*)>/g;
const VOID_HTML_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

function reviewAttributeValue(value: string): boolean {
  const tokens = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.includes('reviewbody')) return true;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const pair = `${tokens[index]}-${tokens[index + 1]}`;
    if (
      pair === 'review-body' ||
      pair === 'review-text' ||
      pair === 'review-content' ||
      pair === 'user-review'
    ) {
      return true;
    }
  }
  return false;
}

/** class, id, itemprop, or data-* values that name a user review body. */
function attributesMarkReview(attrs: string): boolean {
  if (/itemprop\s*=\s*["']reviewbody["']/i.test(attrs)) return true;
  if (/itemtype\s*=\s*["'][^"']*schema\.org\/(?:user)?review["']/i.test(attrs)) return true;
  const named = /(?:^|\s)(?:class|id|itemprop|data-[\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let match: RegExpExecArray | null;
  while ((match = named.exec(attrs))) {
    if (reviewAttributeValue(match[2] ?? match[3] ?? '')) return true;
  }
  return false;
}

function endOfHtmlElement(html: string, tag: string, from: number): number {
  const token = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  token.lastIndex = from;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = token.exec(html))) {
    const closing = match[1] === '/';
    const selfClosing = !closing && /\/>\s*$/.test(match[0]);
    if (selfClosing) continue;
    depth += closing ? -1 : 1;
    if (depth === 0) return match.index + match[0].length;
  }
  return html.length;
}

/**
 * Remove user-review bodies (itemprop=reviewBody, schema.org/Review, or a
 * review-body / review-text / user-review class or id). Listing amenities stay.
 */
function stripReviewMarkup(html: string): string {
  let cursor = 0;
  let out = '';
  while (cursor < html.length) {
    REVIEW_OPEN_TAG.lastIndex = cursor;
    const match = REVIEW_OPEN_TAG.exec(html);
    if (!match) {
      out += html.slice(cursor);
      break;
    }
    const start = match.index;
    out += html.slice(cursor, start);
    const tag = (match[1] ?? '').toLowerCase();
    const whole = match[0];
    const selfClosing = /\/>\s*$/.test(whole) || VOID_HTML_TAGS.has(tag);
    if (selfClosing || !tag || !attributesMarkReview(match[2] ?? '')) {
      out += whole;
      cursor = start + whole.length;
      continue;
    }
    cursor = endOfHtmlElement(html, tag, start + whole.length);
  }
  return out;
}

function pageTextWithoutReviews(page: FetchedPage): string | null {
  if (!page.html) return null;
  return htmlToText(stripReviewMarkup(page.html)).slice(0, BRIEFING_PAGE_CHARS);
}

function droppedFactSummary(fact: DroppedFact): string {
  const field = fact.field ?? 'fact';
  switch (fact.reason) {
    case 'unknown field':
      return `dropped unknown field ${field}`;
    case 'no text':
      return `dropped ${field} with no text`;
    case 'outside the length check':
      return `dropped ${field} outside the length check`;
    case 'without an https source_url':
      return `dropped ${field} without an https source_url`;
    case 'duplicate':
      return `dropped duplicate ${field}`;
    case 'not fetched in this run':
      return `dropped ${field} because ${fact.sourceUrl ?? 'the source'} was not fetched in this run`;
    case 'page fact is already kept':
      return `dropped Places ${field} because a page fact is already kept`;
    case 'outside the fact checks':
      return `dropped Places ${field} outside the fact checks`;
    case 'without an https source':
      return `dropped Places ${field} without an https source`;
    default:
      return `dropped ${field} because ${fact.reason}`;
  }
}

function pushDropped(dropped: string[], droppedFacts: DroppedFact[], fact: DroppedFact): void {
  dropped.push(droppedFactSummary(fact));
  droppedFacts.push(fact);
}

function supportDecision(
  field: BriefingField,
  factText: string,
  page: FetchedPage,
): { passage: string; text: string; trimmed: string[] } | { reason: string } {
  if (FIELD_SPECIFIC.has(field)) {
    const grounded = groundFieldFact(field, factText, page.text);
    if (!grounded) return { reason: 'failed field cue check' };
    const withoutReviews = pageTextWithoutReviews(page);
    if (
      PHYSICAL_FEATURE_FIELDS.has(field) &&
      withoutReviews != null &&
      !groundFieldFact(field, grounded.text, withoutReviews)
    ) {
      return { reason: 'review-only source' };
    }
    return { passage: grounded.passage, text: grounded.text, trimmed: grounded.trimmed };
  }
  const passage = findGenericSupportPassage(factText, page.text);
  if (!passage) return { reason: 'no support passage' };
  const withoutReviews = pageTextWithoutReviews(page);
  if (
    PHYSICAL_FEATURE_FIELDS.has(field) &&
    withoutReviews != null &&
    !findGenericSupportPassage(factText, withoutReviews)
  ) {
    return { reason: 'review-only source' };
  }
  return { passage, text: factText, trimmed: [] };
}

export function parseBriefingModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

export function filterSupportedFacts(args: {
  raw: unknown;
  pages: readonly FetchedPage[];
}): { kept: SupportedFact[]; dropped: string[]; droppedFacts: DroppedFact[] } {
  const dropped: string[] = [];
  const droppedFacts: DroppedFact[] = [];
  const pages = new Map<string, FetchedPage>();
  for (const page of args.pages) {
    const url = normalizeHttpsUrl(page.url);
    if (!url) continue;
    pages.set(url, page);
  }
  const payload = args.raw;
  const facts =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { facts?: unknown }).facts
      : null;
  if (!Array.isArray(facts)) {
    return { kept: [], dropped: ['model JSON has no facts array'], droppedFacts };
  }
  const kept: SupportedFact[] = [];
  const seen = new Set<BriefingField>();
  for (const entry of facts) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      dropped.push('dropped a fact that was not an object');
      continue;
    }
    const record = entry as Record<string, unknown>;
    const field = record.field;
    const text = record.text;
    const source = record.source_url;
    const rawSource = typeof source === 'string' && source.trim() ? source.trim() : null;
    const proposed = typeof text === 'string' ? text.trim() : null;
    if (typeof field !== 'string' || !isBriefingField(field)) {
      pushDropped(dropped, droppedFacts, {
        field: typeof field === 'string' ? field : null,
        text: proposed,
        sourceUrl: rawSource,
        reason: 'unknown field',
      });
      continue;
    }
    if (typeof text !== 'string') {
      pushDropped(dropped, droppedFacts, {
        field,
        text: null,
        sourceUrl: rawSource,
        reason: 'no text',
      });
      continue;
    }
    const body = text.trim();
    if (body.length < 1 || body.length > 400) {
      pushDropped(dropped, droppedFacts, {
        field,
        text: body || null,
        sourceUrl: rawSource,
        reason: 'outside the length check',
      });
      continue;
    }
    const sourceUrl = rawSource ? normalizeHttpsUrl(rawSource) : null;
    if (!sourceUrl) {
      pushDropped(dropped, droppedFacts, {
        field,
        text: body,
        sourceUrl: rawSource,
        reason: 'without an https source_url',
      });
      continue;
    }
    const page = pages.get(sourceUrl);
    if (!page) {
      pushDropped(dropped, droppedFacts, {
        field,
        text: body,
        sourceUrl,
        reason: 'not fetched in this run',
      });
      continue;
    }
    const blocked = stripBlockedDetails(body);
    if (!blocked.text) {
      pushDropped(dropped, droppedFacts, {
        field,
        text: body,
        sourceUrl,
        reason:
          blockedDetailReason(blocked.removed) ??
          (FIELD_SPECIFIC.has(field) ? 'failed field cue check' : 'no support passage'),
      });
      continue;
    }
    for (const piece of blocked.removed) {
      pushDropped(dropped, droppedFacts, {
        field,
        text: piece.text,
        sourceUrl,
        reason: `blocked detail (${piece.category})`,
      });
    }
    const decision = supportDecision(field, blocked.text, page);
    if ('reason' in decision) {
      pushDropped(dropped, droppedFacts, {
        field,
        text: blocked.text,
        sourceUrl,
        reason: decision.reason,
      });
      continue;
    }
    for (const item of decision.trimmed) {
      pushDropped(dropped, droppedFacts, {
        field,
        text: item,
        sourceUrl,
        reason: 'item not on page',
      });
    }
    const supportPassage = decision.passage;
    const keptText = decision.text;
    if (seen.has(field)) {
      pushDropped(dropped, droppedFacts, {
        field,
        text: keptText,
        sourceUrl,
        reason: 'duplicate',
      });
      continue;
    }
    seen.add(field);
    const rawSummary = record.change_summary;
    const changeSummary = typeof rawSummary === 'string' && rawSummary.trim() ? rawSummary.trim() : undefined;
    kept.push(changeSummary
      ? { field, text: keptText, sourceUrl, supportPassage, changeSummary }
      : { field, text: keptText, sourceUrl, supportPassage });
  }
  kept.sort((a, b) => BRIEFING_FIELDS.indexOf(a.field) - BRIEFING_FIELDS.indexOf(b.field));
  return { kept, dropped, droppedFacts };
}

export function briefingSystemPrompt(): string {
  return [
    'Extract first-visit facts for one restaurant.',
    'Return JSON only: {"facts":[{"field":"parking","text":"...","source_url":"https://..."}]}',
    `field must be one of ${BRIEFING_FIELDS.join(', ')}.`,
    'Include a field only when the supplied page text states it.',
    'source_url must be copied exactly from the fetched URL list.',
    'Do not invent, guess, or use outside knowledge.',
    'Omit a field when the pages do not support it. An empty facts array is valid.',
    'Do not include phone numbers, email addresses, URLs, prices, dollar amounts, hours, day-of-week schedules, promos, discounts, credits, or bookings.',
    'Do not write that something is not mentioned, and do not write "the website says" or "according to".',
    'Follow the research guide below. It is the field rules for this extraction.',
    restaurantFactsGuideForPrompt(RESTAURANT_FACTS_GUIDE),
  ].join('\n');
}

/** Same extraction as briefingSystemPrompt, plus an optional grounded change summary. Maintenance only. */
export function briefingMaintenanceSystemPrompt(): string {
  return [
    briefingSystemPrompt(),
    'Each fact may include "change_summary": one sentence of at most 160 characters.',
    'change_summary must be supported by the supplied page text. Omit it when the page does not support it.',
    'Do not add a second object. One facts array is the whole response.',
  ].join(' ');
}

export function briefingUserPrompt(restaurant: BriefingRestaurant, pages: readonly FetchedPage[]): string {
  const blocks = pages.map((page) => `URL: ${page.url}\nTEXT: ${page.text.slice(0, BRIEFING_PAGE_CHARS)}`);
  return [
    `Restaurant: ${restaurant.name}`,
    `Address: ${restaurant.address ?? ''}`,
    'Fetched pages:',
    blocks.join('\n\n'),
  ].join('\n');
}

export function usageFromAnthropicBody(body: unknown): ModelUsage {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const usage = (body as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return {};
  const record = usage as Record<string, unknown>;
  const units: ModelUsage = {};
  const take = (key: string, value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return;
    units[key] = Math.trunc(value);
  };
  take('input', record.input_tokens);
  take('output', record.output_tokens);
  take('cache_read', record.cache_read_input_tokens);
  const serverTools = record.server_tool_use;
  if (serverTools && typeof serverTools === 'object' && !Array.isArray(serverTools)) {
    take('web_search_requests', (serverTools as Record<string, unknown>).web_search_requests);
  }
  const creation = record.cache_creation;
  if (creation && typeof creation === 'object' && !Array.isArray(creation)) {
    const cache = creation as Record<string, unknown>;
    take('cache_write_5m', cache.ephemeral_5m_input_tokens);
    take('cache_write_1h', cache.ephemeral_1h_input_tokens);
  } else {
    take('cache_write_5m', record.cache_creation_input_tokens);
  }
  return units;
}

export function anthropicText(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  const content = (body as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  const block = content.find(
    (item) => item && typeof item === 'object' && (item as { type?: string }).type === 'text',
  ) as { text?: string } | undefined;
  return typeof block?.text === 'string' ? block.text : '';
}

function decodeHtmlPrefix(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/** Stream the body and keep the first `maxBytes`. A longer page is truncated, not dropped. */
async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = Buffer.from(await response.text(), 'utf8');
    if (bytes.byteLength <= maxBytes) return { text: decodeHtmlPrefix(bytes), truncated: false };
    return { text: decodeHtmlPrefix(bytes.subarray(0, maxBytes)), truncated: true };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    const value = step.value;
    if (total + value.byteLength > maxBytes) {
      const keep = maxBytes - total;
      if (keep > 0) chunks.push(value.subarray(0, keep));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    total += value.byteLength;
    chunks.push(value);
  }
  return { text: decodeHtmlPrefix(Buffer.concat(chunks)), truncated };
}

async function requestOnce(
  fetchImpl: typeof fetch,
  url: string,
  cookieHeader: string | null,
): Promise<{ response: Response } | { error: string }> {
  const headers: Record<string, string> = { ...PAGE_REQUEST_HEADERS };
  if (cookieHeader) headers.cookie = cookieHeader;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers,
      signal: controller.signal,
    });
    return { response };
  } catch {
    return { error: 'fetch failed' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Next hop URL. Keeps a trailing slash so a canonical slash redirect is one hop,
 * not a loop back to the slash-stripped URL. www vs the bare host is a different
 * URL here; sameOfficialHost still treats them as one site.
 */
function resolveRedirectUrl(location: string, current: string): string | null {
  let url: URL;
  try {
    url = new URL(location, current);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (!isPublicHost(url.hostname)) return null;
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  hostOnly: boolean;
};

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function defaultCookiePath(pathname: string): string {
  if (!pathname.startsWith('/')) return '/';
  const slash = pathname.lastIndexOf('/');
  if (slash <= 0) return '/';
  return pathname.slice(0, slash);
}

function cookieDomainMatches(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  const suffix = domain.toLowerCase().replace(/^\./, '').replace(/\.+$/, '');
  if (!suffix) return false;
  return host === suffix || host.endsWith(`.${suffix}`);
}

function cookiePathMatches(pathname: string, cookiePath: string): boolean {
  const path = pathname || '/';
  if (cookiePath === '/') return true;
  if (!path.startsWith(cookiePath)) return false;
  if (path.length === cookiePath.length) return true;
  if (cookiePath.endsWith('/')) return true;
  return path[cookiePath.length] === '/';
}

/**
 * Cookies for a single fetch chain. Not stored, not written to the report.
 * A host-only cookie stays on the host that set it. A Domain cookie is sent
 * only when the next hop's host matches that domain.
 */
class FetchCookieJar {
  private cookies: StoredCookie[] = [];

  store(setCookie: string, requestUrl: URL): void {
    const parts = setCookie.split(';');
    const pair = parts[0]?.trim() ?? '';
    const eq = pair.indexOf('=');
    if (eq <= 0) return;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!COOKIE_NAME.test(name) || /[\r\n]/.test(value)) return;
    let domain = requestUrl.hostname.toLowerCase();
    let hostOnly = true;
    let path = defaultCookiePath(requestUrl.pathname);
    let remove = false;
    for (const raw of parts.slice(1)) {
      const attr = raw.trim();
      if (!attr) continue;
      const sep = attr.indexOf('=');
      const key = (sep < 0 ? attr : attr.slice(0, sep)).trim().toLowerCase();
      const attrValue = sep < 0 ? '' : attr.slice(sep + 1).trim();
      if (key === 'domain' && attrValue) {
        if (!cookieDomainMatches(requestUrl.hostname, attrValue)) return;
        domain = attrValue.toLowerCase().replace(/^\./, '').replace(/\.+$/, '');
        hostOnly = false;
      } else if (key === 'path' && attrValue.startsWith('/')) {
        path = attrValue;
      } else if (key === 'max-age' && (!/^\d+$/.test(attrValue) || Number(attrValue) === 0)) {
        remove = true;
      }
    }
    this.cookies = this.cookies.filter(
      (cookie) =>
        !(cookie.name === name && cookie.domain === domain && cookie.path === path && cookie.hostOnly === hostOnly),
    );
    if (remove) return;
    this.cookies.push({ name, value, domain, path, hostOnly });
  }

  header(requestUrl: URL): string | null {
    const host = requestUrl.hostname.toLowerCase();
    const path = requestUrl.pathname || '/';
    const pairs: string[] = [];
    for (const cookie of this.cookies) {
      const hostOk = cookie.hostOnly ? host === cookie.domain : cookieDomainMatches(host, cookie.domain);
      if (!hostOk || !cookiePathMatches(path, cookie.path)) continue;
      pairs.push(`${cookie.name}=${cookie.value}`);
    }
    return pairs.length > 0 ? pairs.join('; ') : null;
  }
}

function setCookieLines(headers: Headers): string[] {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

async function fetchHttps(
  fetchImpl: typeof fetch,
  startUrl: string,
  options?: { allowCrossDomainRedirect?: boolean },
): Promise<{ url: string; text: string; contentType: string; truncated: boolean } | { error: string }> {
  const start = normalizeHttpsUrl(startUrl);
  if (!start) return { error: 'url is not https' };
  const seen = new Set<string>([start]);
  const jar = new FetchCookieJar();
  let current: string = start;
  for (let hop = 0; hop <= BRIEFING_REDIRECT_HOP_CAP; hop += 1) {
    const cookieHeader = jar.header(new URL(current));
    const result = await requestOnce(fetchImpl, current, cookieHeader);
    if ('error' in result) return result;
    const status = result.response.status;
    if (status >= 300 && status < 400) {
      const location = result.response.headers.get('location');
      const cookies = setCookieLines(result.response.headers);
      await result.response.body?.cancel().catch(() => undefined);
      if (hop === BRIEFING_REDIRECT_HOP_CAP) return { error: 'too many redirects' };
      const resolved = location ? resolveRedirectUrl(location, current) : null;
      if (!resolved) return { error: 'redirect was not https' };
      if (options?.allowCrossDomainRedirect === false && !sameOfficialHost(start, resolved)) {
        return { error: 'redirect left the site' };
      }
      if (seen.has(resolved)) return { error: 'redirect loop' };
      for (const cookie of cookies) jar.store(cookie, new URL(current));
      seen.add(resolved);
      current = resolved;
      continue;
    }
    if (status !== 200) {
      await result.response.body?.cancel().catch(() => undefined);
      return { error: `status ${status}` };
    }
    const contentType = result.response.headers.get('content-type') ?? '';
    const body = await readBounded(result.response, BRIEFING_HTML_BYTE_CAP);
    return { url: current, text: body.text, contentType, truncated: body.truncated };
  }
  return { error: 'too many redirects' };
}

type RobotsRecord =
  | { kind: 'absent'; note: string | null }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'text'; text: string };

type RobotsCache = Map<string, RobotsRecord>;

function robotsBodyKind(contentType: string, text: string): 'rules' | 'html' | 'unreadable' {
  const type = contentType.toLowerCase();
  const head = text.slice(0, 400).trim().toLowerCase();
  const looksHtml =
    type.includes('text/html') ||
    type.includes('application/xhtml') ||
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    /^<head[\s>]/.test(head) ||
    /^<body[\s>]/.test(head);
  if (looksHtml) return 'html';
  if (!type || type.includes('text/plain') || type.startsWith('text/')) return 'rules';
  return 'unreadable';
}

/** RFC 9309 / Google: 4xx and an unreadable 2xx are no rules. 5xx and network errors skip. */
function robotsRecordFromError(robotsUrl: string, error: string): RobotsRecord {
  const status = /^status (\d+)$/.exec(error);
  if (status) {
    const code = Number(status[1]);
    if (code === 404 || code === 410) return { kind: 'absent', note: null };
    if ((code >= 400 && code < 500) || (code >= 200 && code < 300)) {
      return { kind: 'absent', note: `${robotsUrl}: status ${code}, treated as no rules (allowed)` };
    }
    if (code >= 500 && code < 600) {
      return { kind: 'unavailable', reason: `robots.txt status ${code}, skipped (server error)` };
    }
  }
  return { kind: 'unavailable', reason: `robots.txt ${error}, skipped (network failure)` };
}

async function readRobots(fetchImpl: typeof fetch, pageUrl: string, cache: RobotsCache): Promise<RobotsRecord> {
  const origin = new URL(pageUrl).origin;
  const cached = cache.get(origin);
  if (cached) return cached;
  const robotsUrl = new URL('/robots.txt', pageUrl).toString();
  const robots = await fetchHttps(fetchImpl, robotsUrl);
  let record: RobotsRecord;
  if ('error' in robots) {
    record = robotsRecordFromError(robotsUrl, robots.error);
  } else {
    const kind = robotsBodyKind(robots.contentType, robots.text);
    if (kind === 'html') {
      record = { kind: 'absent', note: `${robotsUrl}: HTML body, treated as no rules (allowed)` };
    } else if (kind === 'unreadable') {
      record = { kind: 'absent', note: `${robotsUrl}: unreadable body, treated as no rules (allowed)` };
    } else {
      record = { kind: 'text', text: robots.text };
    }
  }
  cache.set(origin, record);
  return record;
}

function robotsDecision(record: RobotsRecord, pageUrl: string): { ok: true } | { ok: false; reason: string } {
  if (record.kind === 'absent') return { ok: true };
  if (record.kind === 'unavailable') return { ok: false, reason: record.reason };
  const pathName = new URL(pageUrl).pathname || '/';
  if (!robotsAllowsPath(record.text, pathName, BRIEFING_USER_AGENT)) {
    return { ok: false, reason: 'robots.txt disallows the path' };
  }
  return { ok: true };
}

type PageDraft = { url: string; html: string; text: string; truncated: boolean };

function pageFailureReason(error: string): string {
  return error === 'status 403' ? 'skipped HTTP 403' : error;
}

function pushNote(notes: string[], note: string | null): void {
  if (note && !notes.includes(note)) notes.push(note);
}

async function takeBriefingPages(args: {
  urls: readonly string[];
  cap: number;
  fetchImpl: typeof fetch;
  robotsCache: RobotsCache;
  notes: string[];
  seen: Set<string>;
  /** When set, the final URL must stay on this official host. */
  officialUrl?: string;
  /** Stored official_website may land on another domain. Other fetches may not. */
  allowCrossDomainRedirect?: boolean;
}): Promise<PageDraft[]> {
  const kept: PageDraft[] = [];
  for (const raw of args.urls) {
    if (kept.length >= args.cap) break;
    const normalized = normalizeHttpsUrl(raw);
    if (!normalized || args.seen.has(normalized)) continue;
    if (args.officialUrl && !sameOfficialHost(args.officialUrl, normalized)) continue;
    const aggregator = weakAggregatorLabel(new URL(normalized).hostname);
    if (aggregator) {
      pushNote(args.notes, `${normalized}: skipped weak aggregator host (${aggregator})`);
      args.seen.add(normalized);
      continue;
    }
    const robots = await readRobots(args.fetchImpl, normalized, args.robotsCache);
    if (robots.kind === 'absent' && robots.note) pushNote(args.notes, robots.note);
    const decision = robotsDecision(robots, normalized);
    if (!decision.ok) {
      pushNote(args.notes, `${normalized}: ${decision.reason}`);
      args.seen.add(normalized);
      continue;
    }
    const fetched = await fetchHttps(args.fetchImpl, normalized, {
      allowCrossDomainRedirect: args.allowCrossDomainRedirect === true,
    });
    if ('error' in fetched) {
      pushNote(args.notes, `${normalized}: ${pageFailureReason(fetched.error)}`);
      args.seen.add(normalized);
      continue;
    }
    const finalUrl = normalizeHttpsUrl(fetched.url) ?? fetched.url;
    if (args.officialUrl && !sameOfficialHost(args.officialUrl, finalUrl)) {
      pushNote(args.notes, `${normalized}: left the official host`);
      args.seen.add(normalized);
      continue;
    }
    if (finalUrl !== normalized) {
      const finalDecision = robotsDecision(
        await readRobots(args.fetchImpl, finalUrl, args.robotsCache),
        finalUrl,
      );
      if (!finalDecision.ok) {
        pushNote(args.notes, `${finalUrl}: ${finalDecision.reason}`);
        args.seen.add(normalized);
        args.seen.add(finalUrl);
        continue;
      }
    }
    if (!/text\/html|text\/plain|application\/xhtml/i.test(fetched.contentType) && fetched.contentType) {
      pushNote(args.notes, `${finalUrl}: unsupported content type`);
      args.seen.add(normalized);
      continue;
    }
    const text = htmlToText(fetched.text).slice(0, BRIEFING_PAGE_CHARS);
    if (!text) {
      pushNote(args.notes, `${finalUrl}: empty page`);
      args.seen.add(normalized);
      continue;
    }
    args.seen.add(normalized);
    args.seen.add(finalUrl);
    kept.push({ url: finalUrl, html: fetched.text, text, truncated: fetched.truncated });
    if (fetched.truncated) {
      pushNote(args.notes, `${finalUrl}: truncated to the first ${BRIEFING_HTML_BYTE_CAP} bytes of HTML`);
    }
  }
  return kept;
}

const WEB_SEARCH_ERROR_REASONS: Record<string, string> = {
  too_many_requests: 'Anthropic web search hit a rate limit (too_many_requests)',
  invalid_tool_input: 'Anthropic web search rejected the query (invalid_tool_input)',
  max_uses_exceeded: 'Anthropic web search stopped at max_uses (max_uses_exceeded)',
  query_too_long: 'Anthropic web search query was too long (query_too_long)',
  request_too_large: 'Anthropic web search request was too large (request_too_large)',
  unavailable: 'Anthropic web search was unavailable',
};

export type BriefingSearchResult = {
  urls: string[];
  units: ModelUsage;
  /** Set when this restaurant has no usable search result. */
  failure: string | null;
  /** Tool errors that arrived alongside usable URLs. */
  warnings: string[];
};

export function webSearchErrorReason(code: string): string {
  return WEB_SEARCH_ERROR_REASONS[code] ?? `Anthropic web search failed (${code})`;
}

function clipReason(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= 180) return flat;
  return `${flat.slice(0, 177)}...`;
}

function anthropicFailureMessage(status: number, parsed: unknown, raw: string): string {
  let detail = '';
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const error = (parsed as { error?: unknown }).error;
    if (error && typeof error === 'object' && !Array.isArray(error)) {
      const record = error as { type?: unknown; message?: unknown };
      const type = typeof record.type === 'string' ? record.type : '';
      const message = typeof record.message === 'string' ? clipReason(record.message) : '';
      detail = [type, message].filter(Boolean).join(': ');
    }
  }
  if (!detail && raw.trim()) detail = clipReason(raw);
  return detail
    ? `Anthropic web search failed (HTTP ${status}: ${detail})`
    : `Anthropic web search failed (HTTP ${status})`;
}

/** URLs and error codes from a Messages API web_search response. */
export function collectWebSearchSignals(body: unknown): { urls: string[]; errorCodes: string[] } {
  const urls: string[] = [];
  const errorCodes: string[] = [];
  const seenUrls = new Set<string>();
  const seenErrors = new Set<string>();
  const visit = (node: unknown, depth: number) => {
    if (depth > 8 || node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    const type = record.type;
    if (
      (type === 'web_search_result' || type === 'web_search_result_location') &&
      typeof record.url === 'string'
    ) {
      const url = normalizeHttpsUrl(record.url);
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        urls.push(url);
      }
    }
    if (type === 'web_search_tool_result_error' && typeof record.error_code === 'string') {
      if (!seenErrors.has(record.error_code)) {
        seenErrors.add(record.error_code);
        errorCodes.push(record.error_code);
      }
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') visit(value, depth + 1);
    }
  };
  visit(body, 0);
  return { urls, errorCodes };
}

export function briefingSearchUserPrompt(restaurant: BriefingRestaurant): string {
  const where = restaurant.address ? ` Address: ${restaurant.address}.` : '';
  return [
    `Find public pages for ${restaurant.name}.${where}`,
    'Search the web for the restaurant official website and for its menu, about, and FAQ pages.',
    'Prefer that official site, then a reputable listing such as Yelp, Tripadvisor, OpenTable, Resy, Tock, Michelin Guide, The Infatuation, Eater, Time Out, Zagat, or Google Maps.',
    'Do not invent URLs.',
  ].join(' ');
}

function briefingWebSearchTool(maxUses: number) {
  return {
    type: BRIEFING_WEB_SEARCH_TOOL,
    name: 'web_search',
    max_uses: maxUses,
    allowed_callers: ['direct'],
    user_location: {
      type: 'approximate',
      city: 'McKinney',
      region: 'Texas',
      country: 'US',
      timezone: 'America/Chicago',
    },
  };
}

type AnthropicTurn = { role: 'user' | 'assistant'; content: unknown };

async function postAnthropicMessage(args: {
  apiKey: string;
  fetchImpl: typeof fetch;
  body: Record<string, unknown>;
}): Promise<{ ok: true; parsed: unknown } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await args.fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': args.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(args.body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let parsed: unknown = null;
    if (raw.trim()) {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        if (!response.ok) {
          return { ok: false, reason: `Anthropic web search failed (HTTP ${response.status})` };
        }
        return { ok: false, reason: 'Anthropic web search failed: the response was not JSON' };
      }
    }
    if (!response.ok) {
      return { ok: false, reason: anthropicFailureMessage(response.status, parsed, raw) };
    }
    if (parsed == null) {
      return { ok: false, reason: 'Anthropic web search failed: the response was empty' };
    }
    return { ok: true, parsed };
  } catch {
    return { ok: false, reason: 'Anthropic web search failed: the request did not complete' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One Messages API turn with server-side web_search. Candidate URLs come from
 * the tool result, not from model prose. A paused turn continues until the
 * per-restaurant search cap is used or two continuations have run. A turn whose
 * candidates are all listings or skipped hosts asks for the restaurant's own
 * domain instead of stopping on the listing.
 */
export async function discoverBriefingUrls(args: {
  restaurant: BriefingRestaurant;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<BriefingSearchResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  if (!args.apiKey.trim()) {
    return {
      urls: [],
      units: {},
      failure: 'Anthropic web search failed: ANTHROPIC_API_KEY is not set',
      warnings: [],
    };
  }
  const messages: AnthropicTurn[] = [
    { role: 'user', content: briefingSearchUserPrompt(args.restaurant) },
  ];
  let units: ModelUsage = {};
  const urls: string[] = [];
  const seen = new Set<string>();
  const errorCodes: string[] = [];
  const seenErrors = new Set<string>();
  const extraWarnings: string[] = [];
  let askedForOwnDomain = false;
  let paused = false;

  for (let turn = 0; turn <= SEARCH_CONTINUATION_CAP; turn += 1) {
    const remaining = BRIEFING_WEB_SEARCH_MAX_USES - (units.web_search_requests ?? 0);
    if (remaining < 1) break;
    const posted = await postAnthropicMessage({
      apiKey: args.apiKey,
      fetchImpl,
      body: {
        model: BRIEFING_MODEL,
        max_tokens: BRIEFING_SEARCH_MAX_OUTPUT_TOKENS,
        temperature: 0,
        system:
          'Find source pages for one restaurant. Use the web_search tool. Do not invent URLs or state facts from memory.',
        messages,
        tools: [briefingWebSearchTool(remaining)],
      },
    });
    if (!posted.ok) {
      if (urls.length > 0) {
        return {
          urls,
          units,
          failure: null,
          warnings: [...errorCodes.map(webSearchErrorReason), posted.reason, ...extraWarnings],
        };
      }
      return { urls, units, failure: posted.reason, warnings: [] };
    }
    units = mergeModelUsage(units, usageFromAnthropicBody(posted.parsed));
    const signals = collectWebSearchSignals(posted.parsed);
    for (const url of signals.urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
    for (const code of signals.errorCodes) {
      if (seenErrors.has(code)) continue;
      seenErrors.add(code);
      errorCodes.push(code);
    }
    const record =
      posted.parsed && typeof posted.parsed === 'object' && !Array.isArray(posted.parsed)
        ? (posted.parsed as { stop_reason?: unknown; content?: unknown })
        : null;
    if (record?.stop_reason === 'pause_turn' && Array.isArray(record.content)) {
      paused = true;
      messages.push({ role: 'assistant', content: record.content });
      continue;
    }
    if (
      needsOwnDomainSearch(urls, args.restaurant) &&
      Array.isArray(record?.content) &&
      turn < SEARCH_CONTINUATION_CAP
    ) {
      paused = false;
      if (!askedForOwnDomain) {
        extraWarnings.push('Search continued after a listing or skipped host.');
        askedForOwnDomain = true;
      }
      messages.push({ role: 'assistant', content: record.content });
      messages.push({ role: 'user', content: OWN_DOMAIN_FOLLOWUP });
      continue;
    }
    paused = false;
    break;
  }

  if (urls.length === 0) {
    const failure =
      errorCodes.length > 0
        ? errorCodes.map(webSearchErrorReason).join('; ')
        : paused
          ? 'Anthropic web search paused before it returned a page'
          : 'Anthropic web search returned no candidate URLs';
    return { urls, units, failure, warnings: [] };
  }
  return {
    urls,
    units,
    failure: null,
    warnings: [...errorCodes.map(webSearchErrorReason), ...extraWarnings],
  };
}

function mergePageAndPlacesFacts(
  pageFacts: readonly SupportedFact[],
  placesFacts: readonly PlacesFactDraft[],
): { kept: SupportedFact[]; dropped: string[]; droppedFacts: DroppedFact[] } {
  const kept = [...pageFacts];
  const seen = new Set(pageFacts.map((fact) => fact.field));
  const dropped: string[] = [];
  const droppedFacts: DroppedFact[] = [];
  for (const fact of placesFacts) {
    if (seen.has(fact.field)) {
      pushDropped(dropped, droppedFacts, {
        field: fact.field,
        text: fact.text,
        sourceUrl: fact.sourceUrl,
        reason: 'page fact is already kept',
      });
      continue;
    }
    if (!isBriefingField(fact.field) || fact.text.trim().length < 1 || fact.text.length > 400) {
      pushDropped(dropped, droppedFacts, {
        field: fact.field,
        text: fact.text,
        sourceUrl: fact.sourceUrl,
        reason: 'outside the fact checks',
      });
      continue;
    }
    const sourceUrl = normalizeHttpsUrl(fact.sourceUrl);
    if (!sourceUrl) {
      pushDropped(dropped, droppedFacts, {
        field: fact.field,
        text: fact.text,
        sourceUrl: fact.sourceUrl,
        reason: 'without an https source',
      });
      continue;
    }
    const blocked = stripBlockedDetails(fact.text.trim());
    const blockedReason = blockedDetailReason(blocked.removed);
    if (!blocked.text) {
      pushDropped(dropped, droppedFacts, {
        field: fact.field,
        text: fact.text,
        sourceUrl,
        reason: blockedReason ?? 'outside the fact checks',
      });
      continue;
    }
    for (const piece of blocked.removed) {
      pushDropped(dropped, droppedFacts, {
        field: fact.field,
        text: piece.text,
        sourceUrl,
        reason: `blocked detail (${piece.category})`,
      });
    }
    seen.add(fact.field);
    kept.push({
      field: fact.field,
      text: blocked.text,
      sourceUrl,
      supportPassage: fact.supportPassage,
    });
  }
  kept.sort((a, b) => BRIEFING_FIELDS.indexOf(a.field) - BRIEFING_FIELDS.indexOf(b.field));
  return { kept, dropped, droppedFacts };
}

function noteWeakAggregators(urls: readonly string[], notes: string[]): void {
  const seen = new Set<string>();
  for (const raw of urls) {
    const normalized = normalizeHttpsUrl(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const label = weakAggregatorLabel(new URL(normalized).hostname);
    if (!label) continue;
    pushNote(notes, `${normalized}: skipped weak aggregator host (${label})`);
  }
}

function hostOf(pageUrl: string): string | null {
  try {
    return new URL(pageUrl).hostname;
  } catch {
    return null;
  }
}

export async function researchOneRestaurant(args: {
  restaurant: BriefingRestaurant;
  fetchImpl: typeof fetch;
  callModel: BriefingModelCaller;
  apiKey: string;
  pageCap?: number;
  /** Shared across a catalog run so a disallowed listing host is not fetched again. */
  robotsCache?: RobotsCache;
  placesLookup?: (restaurant: BriefingRestaurant) => Promise<PlacesLookupResult>;
}): Promise<RestaurantResearchResult> {
  const notes: string[] = [];
  let units: ModelUsage = {};
  let placeId: string | null = null;
  let placeIdToStore: string | null = null;
  let placesFacts: PlacesFactDraft[] = [];
  let placesWebsite: string | null = null;
  if (args.placesLookup) {
    try {
      const places = await args.placesLookup(args.restaurant);
      units = mergeModelUsage(units, places.units);
      notes.push(...places.notes);
      placesFacts = places.facts;
      placesWebsite = places.officialWebsite;
      placeId = places.placeId;
      placeIdToStore = places.placeIdToStore;
    } catch (error) {
      notes.push(error instanceof Error ? error.message : 'Places lookup failed');
    }
  }
  const storedWebsite = normalizeHttpsUrl(args.restaurant.officialWebsite);
  const officialStart = storedWebsite ?? (placesWebsite ? normalizeHttpsUrl(placesWebsite) : null);
  if (storedWebsite && placesWebsite) {
    notes.push('Places websiteUri was not used because official_website is set.');
  } else if (!storedWebsite && officialStart) {
    notes.push('Official host for this run is the Places websiteUri. It was not stored.');
  }
  const base = {
    restaurantId: args.restaurant.id,
    restaurantName: args.restaurant.name,
    fetchedUrls: [] as string[],
    facts: [] as SupportedFact[],
    dropped: [] as string[],
    droppedFacts: [] as DroppedFact[],
    units,
    estimatedMicrodollars: 0,
    notes,
    placeId,
    placeIdToStore,
  };
  const priced = (): RestaurantResearchResult => ({
    ...base,
    units,
    estimatedMicrodollars: estimateMicrodollars(units),
    notes,
    placeId,
    placeIdToStore,
  });
  const robotsCache = args.robotsCache ?? new Map();
  const seen = new Set<string>();
  const pageCap = args.pageCap ?? BRIEFING_PAGE_CAP;
  const storedPages = officialStart
    ? await takeBriefingPages({
        urls: [officialStart],
        cap: 1,
        fetchImpl: args.fetchImpl,
        robotsCache,
        notes,
        seen,
        allowCrossDomainRedirect: true,
      })
    : [];
  const storedPage = storedPages[0] ?? null;
  const officialHosts = [officialStart, storedPage?.url]
    .map((url) => (url ? hostOf(url) : null))
    .filter((host): host is string => Boolean(host));

  const search = await discoverBriefingUrls({
    restaurant: args.restaurant,
    apiKey: args.apiKey,
    fetchImpl: args.fetchImpl,
  });
  units = mergeModelUsage(units, search.units);
  let searchPages: PageDraft[] = [];
  if (search.failure) {
    notes.push(search.failure);
  } else {
    noteWeakAggregators(search.urls, notes);
    for (const warning of search.warnings) notes.push(warning);
    const ranked = rankBriefingUrls(
      search.urls,
      args.restaurant.name,
      officialHosts,
      args.restaurant.address,
    );
    if (ranked.length === 0 && !storedPage) {
      notes.push('no official site or reputable listing in the search results');
    }
    if (ranked.length > 0) {
      searchPages = await takeBriefingPages({
        urls: ranked,
        cap: pageCap,
        fetchImpl: args.fetchImpl,
        robotsCache,
        notes,
        seen,
      });
    }
  }
  const official =
    storedPage ??
    searchPages.find(
      (page) =>
        classifyUrl(page.url, args.restaurant.name, officialHosts, args.restaurant.address) === 'official',
    );
  const subpages = official
    ? await takeBriefingPages({
        urls: discoverOfficialSubpages(official.html, official.url, BRIEFING_SUBPAGE_CANDIDATE_CAP),
        cap: BRIEFING_OFFICIAL_SUBPAGE_CAP,
        fetchImpl: args.fetchImpl,
        robotsCache,
        notes,
        seen,
        officialUrl: official.url,
      })
    : [];
  const officialSearch = searchPages.filter(
    (page) => classifyUrl(page.url, args.restaurant.name, officialHosts, args.restaurant.address) === 'official',
  );
  const listings = searchPages.filter(
    (page) => classifyUrl(page.url, args.restaurant.name, officialHosts, args.restaurant.address) !== 'official',
  );
  const ordered = [
    ...(storedPage ? [storedPage] : []),
    ...officialSearch.filter((page) => page.url !== storedPage?.url),
    ...subpages,
    ...listings,
  ];
  const pages: FetchedPage[] = ordered.map((page) => ({ url: page.url, text: page.text, html: page.html }));
  base.fetchedUrls = pages.map((page) => page.url);
  let pageFacts: SupportedFact[] = [];
  const dropped: string[] = [];
  const droppedFacts: DroppedFact[] = [];
  if (pages.length > 0) {
    try {
      const model = await args.callModel({
        system: briefingSystemPrompt(),
        user: briefingUserPrompt(args.restaurant, pages),
      });
      units = mergeModelUsage(units, model.units);
      const filtered = filterSupportedFacts({ raw: parseBriefingModelJson(model.text), pages });
      pageFacts = filtered.kept;
      dropped.push(...filtered.dropped);
      droppedFacts.push(...filtered.droppedFacts);
    } catch (error) {
      notes.push(error instanceof Error ? error.message : 'model call failed');
    }
  } else if (!search.failure && placesFacts.length === 0 && !notes.includes('no official site or reputable listing in the search results')) {
    notes.push('no page text fetched');
  }
  const merged = mergePageAndPlacesFacts(pageFacts, placesFacts);
  return {
    ...priced(),
    facts: merged.kept,
    dropped: [...dropped, ...merged.dropped],
    droppedFacts: [...droppedFacts, ...merged.droppedFacts],
  };
}

export async function researchCatalog(args: {
  restaurants: readonly BriefingRestaurant[];
  fetchImpl: typeof fetch;
  callModel: BriefingModelCaller;
  apiKey: string;
  now: Date;
  restaurantCap: number;
  costCapMicrodollars: number;
  placesLookup?: (restaurant: BriefingRestaurant) => Promise<PlacesLookupResult>;
}): Promise<BriefingRun> {
  const restaurants: RestaurantResearchResult[] = [];
  let spent = 0;
  let stoppedBecause: string | null = null;
  const robotsCache: RobotsCache = new Map();
  const cap = Math.min(args.restaurantCap, DEFAULT_RESTAURANT_CAP);
  for (const restaurant of args.restaurants) {
    if (restaurants.length >= cap) {
      stoppedBecause = `restaurant cap ${cap}`;
      break;
    }
    if (spent >= args.costCapMicrodollars) {
      stoppedBecause = `cost cap ${formatEstimatedUsd(args.costCapMicrodollars)} USD`;
      break;
    }
    const result = await researchOneRestaurant({
      restaurant,
      fetchImpl: args.fetchImpl,
      callModel: args.callModel,
      apiKey: args.apiKey,
      robotsCache,
      placesLookup: args.placesLookup,
    });
    restaurants.push(result);
    spent += result.estimatedMicrodollars;
    if (spent >= args.costCapMicrodollars) {
      stoppedBecause = `cost cap ${formatEstimatedUsd(args.costCapMicrodollars)} USD`;
      break;
    }
  }
  const totals = restaurants.reduce(
    (sum, result) => ({
      input: sum.input + (result.units.input ?? 0),
      output: sum.output + (result.units.output ?? 0),
      estimatedMicrodollars: sum.estimatedMicrodollars + result.estimatedMicrodollars,
    }),
    { input: 0, output: 0, estimatedMicrodollars: 0 },
  );
  return {
    verifiedAt: args.now.toISOString(),
    restaurants,
    stoppedBecause,
    totals,
  };
}

export function briefingInsertRow(fact: SupportedFact, restaurantId: string, verifiedAt: string): BriefingInsert {
  return {
    restaurant_id: restaurantId,
    field: fact.field,
    body: fact.text,
    source_url: fact.sourceUrl,
    last_verified_at: verifiedAt,
    status: 'paused',
    is_sample: false,
    version: 1,
  };
}

export type BriefingFieldCounts = Record<BriefingField, { kept: number; dropped: number }>;

function emptyFieldCounts(): BriefingFieldCounts {
  return Object.fromEntries(BRIEFING_FIELDS.map((field) => [field, { kept: 0, dropped: 0 }])) as BriefingFieldCounts;
}

/** Field named by a drop line. Unknown and non-field drops are not counted. */
export function droppedBriefingField(reason: string): BriefingField | null {
  const match = /^dropped (?:Places |duplicate )?([a-z_]+)\b/.exec(reason);
  if (!match || !isBriefingField(match[1])) return null;
  return match[1];
}

/** Kept facts and dropped lines, one tally per stored field. */
export function briefingFieldOutcomeCounts(
  facts: readonly { field: string }[],
  dropped: readonly string[],
): BriefingFieldCounts {
  const counts = emptyFieldCounts();
  for (const fact of facts) {
    if (isBriefingField(fact.field)) counts[fact.field].kept += 1;
  }
  for (const reason of dropped) {
    const field = droppedBriefingField(reason);
    if (field) counts[field].dropped += 1;
  }
  return counts;
}

function addFieldCounts(total: BriefingFieldCounts, next: BriefingFieldCounts): void {
  for (const field of BRIEFING_FIELDS) {
    total[field].kept += next[field].kept;
    total[field].dropped += next[field].dropped;
  }
}

function clipDroppedFactText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= DROPPED_FACT_TEXT_CAP) return flat;
  return `${flat.slice(0, DROPPED_FACT_TEXT_CAP - 3)}...`;
}

function publicDroppedFact(fact: DroppedFact): DroppedFact {
  return {
    field: fact.field,
    text: fact.text ? clipDroppedFactText(fact.text) : null,
    sourceUrl: fact.sourceUrl,
    reason: fact.reason,
  };
}

function formatDroppedFactLines(fact: DroppedFact): string[] {
  const shown = publicDroppedFact(fact);
  return [
    `- ${shown.field ?? 'unknown'}: ${shown.text ?? '(no text)'}`,
    `  Source: ${shown.sourceUrl ?? '(no source url)'}`,
    `  Reason: ${shown.reason}`,
  ];
}

function formatFieldCountLines(counts: BriefingFieldCounts): string[] {
  return BRIEFING_FIELDS.map(
    (field) => `- ${field}: kept ${counts[field].kept}, dropped ${counts[field].dropped}`,
  );
}

/** Fetch notes plus whether this restaurant kept a supported fact. */
export function briefingResultReasons(
  result: Pick<RestaurantResearchResult, 'notes' | 'facts'>,
): string[] {
  const reasons = [...result.notes];
  if (result.facts.length === 0) reasons.push('no supported facts');
  else {
    const noun = result.facts.length === 1 ? 'fact' : 'facts';
    reasons.push(`kept ${result.facts.length} supported ${noun}`);
  }
  return reasons;
}

export function placesReportLine(units: ModelUsage): string {
  const parts: string[] = [];
  for (const [unit, count] of Object.entries(units)) {
    if (!count || count <= 0) continue;
    const label = placesSkuLabel('details', unit) ?? placesSkuLabel('text_search', unit);
    if (!label) continue;
    const each = microdollarsForPlacesUnit(unit) ?? 0;
    parts.push(`${label} x${count} (${formatEstimatedUsd(each * count)} USD)`);
  }
  if (parts.length === 0) return 'Places: not called';
  return `Places: ${parts.join('; ')}`;
}

function dropReasonCounts(run: BriefingRun): [string, number][] {
  const counts = new Map<string, number>();
  const add = (reason: string) => counts.set(reason, (counts.get(reason) ?? 0) + 1);
  for (const restaurant of run.restaurants) {
    const facts = restaurant.droppedFacts ?? [];
    const summarized = new Set(facts.map((fact) => droppedFactSummary(fact)));
    for (const fact of facts) add(fact.reason);
    for (const line of restaurant.dropped) {
      if (!summarized.has(line)) add(line);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function formatDropReasonLines(counts: readonly [string, number][]): string[] {
  if (counts.length === 0) return ['Drop reasons: none'];
  return ['Drop reasons:', ...counts.map(([reason, count]) => `- ${reason}: ${count}`)];
}

function formatSkippedTestLines(run: BriefingRun): string[] {
  if (!run.skippedTestRestaurants) return [];
  const suffix = run.includeTestRestaurants ? ' (--include-test)' : '';
  if (run.skippedTestRestaurants.length === 0) {
    return ['', `Skipped test restaurants: none${suffix}`];
  }
  return [
    '',
    'Skipped test restaurants:',
    ...run.skippedTestRestaurants.map((skipped) => `- ${skipped.name}: ${skipped.reason}`),
  ];
}

export function formatBriefingReport(run: BriefingRun): { json: string; markdown: string } {
  const fieldCountTotals = emptyFieldCounts();
  const restaurants = run.restaurants.map((restaurant) => {
    const fieldCounts = briefingFieldOutcomeCounts(restaurant.facts, restaurant.dropped);
    addFieldCounts(fieldCountTotals, fieldCounts);
    return {
      ...restaurant,
      reasons: briefingResultReasons(restaurant),
      fieldCounts,
      droppedFacts: (restaurant.droppedFacts ?? []).map(publicDroppedFact),
    };
  });
  const reasonCounts = dropReasonCounts(run);
  const dropReasonCountsJson = Object.fromEntries(reasonCounts);
  const json = `${JSON.stringify({ schema: 'wanderbite.e06.briefing_research.v1', ...run, fieldCountTotals, dropReasonCounts: dropReasonCountsJson, restaurants }, null, 2)}\n`;
  const lines = [
    '# First-visit briefing research',
    '',
    `Verified at: ${run.verifiedAt}`,
    `Input tokens: ${run.totals.input}`,
    `Output tokens: ${run.totals.output}`,
    `Web searches: ${run.restaurants.reduce((sum, result) => sum + (result.units.web_search_requests ?? 0), 0)}`,
    placesReportLine(run.restaurants.reduce<ModelUsage>((sum, result) => mergeModelUsage(sum, result.units), {})),
    `Estimated cost: ${formatEstimatedUsd(run.totals.estimatedMicrodollars)} USD`,
    run.stoppedBecause ? `Stopped: ${run.stoppedBecause}` : 'Stopped: completed the selected restaurants',
    ...formatSkippedTestLines(run),
    '',
    'Field counts:',
    ...formatFieldCountLines(fieldCountTotals),
    '',
    ...formatDropReasonLines(reasonCounts),
    '',
  ];
  for (const restaurant of restaurants) {
    lines.push(`## ${restaurant.restaurantName}`);
    lines.push('');
    lines.push(
      `Tokens in ${restaurant.units.input ?? 0}, out ${restaurant.units.output ?? 0}. Web searches ${restaurant.units.web_search_requests ?? 0}. Estimated ${formatEstimatedUsd(restaurant.estimatedMicrodollars)} USD.`,
    );
    lines.push(placesReportLine(restaurant.units));
    if (restaurant.placeId) lines.push(`Place id: ${restaurant.placeId}`);
    if (restaurant.placeIdToStore) lines.push(`Place id to store on --write: ${restaurant.placeIdToStore}`);
    lines.push('');
    lines.push('Reasons:');
    for (const reason of restaurant.reasons) lines.push(`- ${reason}`);
    lines.push('');
    lines.push('Field counts:');
    lines.push(...formatFieldCountLines(restaurant.fieldCounts));
    lines.push('');
    lines.push('Fetched:');
    if (restaurant.fetchedUrls.length === 0) lines.push('- none');
    for (const url of restaurant.fetchedUrls) lines.push(`- ${url}`);
    lines.push('');
    if (restaurant.facts.length === 0) lines.push('No supported facts.');
    for (const fact of restaurant.facts) {
      lines.push(`- ${fact.field}: ${fact.text}`);
      lines.push(`  Source: ${fact.sourceUrl}`);
      lines.push(`  Label: ${briefingSourceLabel(fact.sourceUrl)}`);
      lines.push(`  Passage: ${fact.supportPassage}`);
    }
    const droppedFacts = restaurant.droppedFacts ?? [];
    const summarized = new Set(droppedFacts.map((fact) => droppedFactSummary(fact)));
    const metaDrops = restaurant.dropped.filter((reason) => !summarized.has(reason));
    if (droppedFacts.length > 0 || metaDrops.length > 0) {
      lines.push('');
      lines.push('Dropped facts:');
      for (const fact of droppedFacts) lines.push(...formatDroppedFactLines(fact));
      for (const reason of metaDrops) lines.push(`- ${reason}`);
    }
    lines.push('');
  }
  return { json, markdown: `${lines.join('\n')}\n` };
}

export function briefingModelMatchesDiscover(): boolean {
  const models = readFileSync(path.join(process.cwd(), 'src/lib/ai-budget/models.ts'), 'utf8');
  return models.includes(`'${BRIEFING_MODEL}'`);
}

export async function callBriefingModel(args: {
  apiKey: string;
  system: string;
  user: string;
  fetchImpl?: typeof fetch;
}): Promise<{ text: string; units: ModelUsage }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': args.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: BRIEFING_MODEL,
        max_tokens: BRIEFING_MAX_OUTPUT_TOKENS,
        temperature: 0,
        system: args.system,
        messages: [{ role: 'user', content: args.user }],
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`anthropic_failed ${response.status}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error('anthropic_failed parse');
    }
    return { text: anthropicText(parsed), units: usageFromAnthropicBody(parsed) };
  } finally {
    clearTimeout(timer);
  }
}
