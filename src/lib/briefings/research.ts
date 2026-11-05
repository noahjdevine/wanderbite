import { readFileSync } from 'node:fs';
import path from 'node:path';
import { robotsAllowsPath } from '@/lib/recipes/menu-robots';
import {
  BRIEFING_FIELDS,
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
export const BRIEFING_WEB_SEARCH_MAX_USES = 3;
/** Published price: $10 per 1,000 searches = 10,000 microdollars each. */
export const WEB_SEARCH_MICRODOLLARS_PER_REQUEST = 10_000;

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const SEARCH_TIMEOUT_MS = 60_000;
const SEARCH_CONTINUATION_CAP = 2;

const HOSTED_PROJECT_REF = 'yiajoycgiyxjvznndjge';
const FETCH_TIMEOUT_MS = 8_000;
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
];

const SKIP_HOSTS = [
  'duckduckgo.com',
  'bing.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'wikipedia.org',
  'tiktok.com',
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
};

export type SupportedFact = {
  field: BriefingField;
  text: string;
  sourceUrl: string;
  /** Page passage the reviewer can compare with the fact. Not stored. */
  supportPassage: string;
};

export type FetchedPage = {
  url: string;
  text: string;
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
  units: ModelUsage;
  estimatedMicrodollars: number;
  notes: string[];
};

export type BriefingRun = {
  verifiedAt: string;
  restaurants: RestaurantResearchResult[];
  stoppedBecause: string | null;
  totals: { input: number; output: number; estimatedMicrodollars: number };
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
  restaurantCap: number;
  costCapMicrodollars: number;
  error?: string;
} {
  let help = false;
  let write = false;
  let restaurantCap = DEFAULT_RESTAURANT_CAP;
  let costCapMicrodollars = DEFAULT_COST_CAP_MICRODOLLARS;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--write') write = true;
    else if (arg === '--limit') {
      const value = Number(argv[i + 1]);
      i += 1;
      if (!Number.isInteger(value) || value < 1) {
        return {
          help,
          write,
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
        restaurantCap,
        costCapMicrodollars,
        error: `Unknown argument ${arg}`,
      };
    }
  }
  return { help, write, restaurantCap, costCapMicrodollars };
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

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && token !== 'cafe' && token !== 'the');
}

function classifyUrl(raw: string, restaurantName: string): 'official' | 'listing' | 'skip' {
  const normalized = normalizeHttpsUrl(raw);
  if (!normalized) return 'skip';
  const url = new URL(normalized);
  const host = url.hostname;
  if (SKIP_HOSTS.some((suffix) => hostMatches(host, suffix))) return 'skip';
  if (host === 'google.com' || host === 'www.google.com' || host === 'maps.google.com') {
    return url.pathname.startsWith('/maps') ? 'listing' : 'skip';
  }
  if (LISTING_HOSTS.some((suffix) => hostMatches(host, suffix))) return 'listing';
  const tokens = nameTokens(restaurantName);
  if (tokens.some((token) => host.includes(token))) return 'official';
  return 'skip';
}

/**
 * Official hosts first, then reputable listings. The page cap is applied later,
 * after robots.txt, so a disallowed listing does not consume a slot.
 */
export function rankBriefingUrls(urls: readonly string[], restaurantName: string): string[] {
  const official: string[] = [];
  const listings: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const normalized = normalizeHttpsUrl(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const kind = classifyUrl(normalized, restaurantName);
    if (kind === 'official') official.push(normalized);
    else if (kind === 'listing') listings.push(normalized);
  }
  return [...official, ...listings];
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

/**
 * A fact stays only when one passage of this page holds a two-thirds share of
 * its distinctive words and every number, time, price, and proper noun in it.
 * Generic words such as "parking" and "street" do not carry the fact.
 */
export function findSupportPassage(factText: string, pageText: string): string | null {
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
}): { kept: SupportedFact[]; dropped: string[] } {
  const dropped: string[] = [];
  const pages = new Map<string, string>();
  for (const page of args.pages) {
    const url = normalizeHttpsUrl(page.url);
    if (!url) continue;
    pages.set(url, page.text);
  }
  const payload = args.raw;
  const facts =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { facts?: unknown }).facts
      : null;
  if (!Array.isArray(facts)) {
    return { kept: [], dropped: ['model JSON has no facts array'] };
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
    if (typeof field !== 'string' || !isBriefingField(field)) {
      dropped.push(`dropped unknown field ${String(field)}`);
      continue;
    }
    if (typeof text !== 'string') {
      dropped.push(`dropped ${field} with no text`);
      continue;
    }
    const body = text.trim();
    if (body.length < 1 || body.length > 400) {
      dropped.push(`dropped ${field} outside the length check`);
      continue;
    }
    const sourceUrl = typeof source === 'string' ? normalizeHttpsUrl(source) : null;
    if (!sourceUrl) {
      dropped.push(`dropped ${field} without an https source_url`);
      continue;
    }
    const pageText = pages.get(sourceUrl);
    if (pageText == null) {
      dropped.push(`dropped ${field} because ${sourceUrl} was not fetched in this run`);
      continue;
    }
    const supportPassage = findSupportPassage(body, pageText);
    if (!supportPassage) {
      dropped.push(`dropped ${field} because the page text does not support it`);
      continue;
    }
    if (seen.has(field)) {
      dropped.push(`dropped duplicate ${field}`);
      continue;
    }
    seen.add(field);
    kept.push({ field, text: body, sourceUrl, supportPassage });
  }
  kept.sort((a, b) => BRIEFING_FIELDS.indexOf(a.field) - BRIEFING_FIELDS.indexOf(b.field));
  return { kept, dropped };
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
    'Do not include prices, offers, discounts, credits, or bookings.',
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
): Promise<{ response: Response } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers: PAGE_REQUEST_HEADERS,
      signal: controller.signal,
    });
    return { response };
  } catch {
    return { error: 'fetch failed' };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHttps(
  fetchImpl: typeof fetch,
  startUrl: string,
): Promise<{ url: string; text: string; contentType: string; truncated: boolean } | { error: string }> {
  const start = normalizeHttpsUrl(startUrl);
  if (!start) return { error: 'url is not https' };
  let current: string = start;
  for (let hop = 0; hop < 3; hop += 1) {
    const result = await requestOnce(fetchImpl, current);
    if ('error' in result) return result;
    const status = result.response.status;
    if (status >= 300 && status < 400) {
      const location = result.response.headers.get('location');
      await result.response.body?.cancel().catch(() => undefined);
      const resolved = location ? normalizeHttpsUrl(new URL(location, current).toString()) : null;
      if (!resolved) return { error: 'redirect was not https' };
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
  | { kind: 'absent' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'text'; text: string };

type RobotsCache = Map<string, RobotsRecord>;

async function readRobots(fetchImpl: typeof fetch, pageUrl: string, cache: RobotsCache): Promise<RobotsRecord> {
  const origin = new URL(pageUrl).origin;
  const cached = cache.get(origin);
  if (cached) return cached;
  const robots = await fetchHttps(fetchImpl, new URL('/robots.txt', pageUrl).toString());
  let record: RobotsRecord;
  if ('error' in robots) {
    record =
      robots.error === 'status 404' || robots.error === 'status 410'
        ? { kind: 'absent' }
        : { kind: 'unavailable', reason: `robots.txt unavailable (${robots.error})` };
  } else if (/text\/html|application\/xhtml/i.test(robots.contentType)) {
    record = { kind: 'unavailable', reason: 'robots.txt was not plain text' };
  } else {
    record = { kind: 'text', text: robots.text };
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
}): Promise<PageDraft[]> {
  const kept: PageDraft[] = [];
  for (const raw of args.urls) {
    if (kept.length >= args.cap) break;
    const normalized = normalizeHttpsUrl(raw);
    if (!normalized || args.seen.has(normalized)) continue;
    if (args.officialUrl && !sameOfficialHost(args.officialUrl, normalized)) continue;
    const decision = robotsDecision(await readRobots(args.fetchImpl, normalized, args.robotsCache), normalized);
    if (!decision.ok) {
      pushNote(args.notes, `${normalized}: ${decision.reason}`);
      args.seen.add(normalized);
      continue;
    }
    const fetched = await fetchHttps(args.fetchImpl, normalized);
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
    'Search the web.',
    'Prefer the restaurant official website, then a reputable listing such as Yelp, Tripadvisor, OpenTable, Resy, Tock, Michelin Guide, The Infatuation, Eater, Time Out, Zagat, or Google Maps.',
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
 * per-restaurant search cap is used or two continuations have run.
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
          warnings: [...errorCodes.map(webSearchErrorReason), posted.reason],
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
    if (record?.stop_reason !== 'pause_turn' || !Array.isArray(record.content)) {
      paused = false;
      break;
    }
    paused = true;
    messages.push({ role: 'assistant', content: record.content });
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
    warnings: errorCodes.map(webSearchErrorReason),
  };
}

export async function researchOneRestaurant(args: {
  restaurant: BriefingRestaurant;
  fetchImpl: typeof fetch;
  callModel: BriefingModelCaller;
  apiKey: string;
  pageCap?: number;
  /** Shared across a catalog run so a disallowed listing host is not fetched again. */
  robotsCache?: RobotsCache;
}): Promise<RestaurantResearchResult> {
  const notes: string[] = [];
  let units: ModelUsage = {};
  const base = {
    restaurantId: args.restaurant.id,
    restaurantName: args.restaurant.name,
    fetchedUrls: [] as string[],
    facts: [] as SupportedFact[],
    dropped: [] as string[],
    units,
    estimatedMicrodollars: 0,
    notes,
  };
  const priced = (): RestaurantResearchResult => ({
    ...base,
    units,
    estimatedMicrodollars: estimateMicrodollars(units),
    notes,
  });
  const search = await discoverBriefingUrls({
    restaurant: args.restaurant,
    apiKey: args.apiKey,
    fetchImpl: args.fetchImpl,
  });
  units = search.units;
  if (search.failure) {
    notes.push(search.failure);
    return priced();
  }
  for (const warning of search.warnings) notes.push(warning);
  const ranked = rankBriefingUrls(search.urls, args.restaurant.name);
  if (ranked.length === 0) {
    notes.push('no official site or reputable listing in the search results');
    return priced();
  }
  const robotsCache = args.robotsCache ?? new Map();
  const seen = new Set<string>();
  const pageCap = args.pageCap ?? BRIEFING_PAGE_CAP;
  const searchPages = await takeBriefingPages({
    urls: ranked,
    cap: pageCap,
    fetchImpl: args.fetchImpl,
    robotsCache,
    notes,
    seen,
  });
  const official = searchPages.find((page) => classifyUrl(page.url, args.restaurant.name) === 'official');
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
  const ordered = [
    ...searchPages.filter((page) => classifyUrl(page.url, args.restaurant.name) === 'official'),
    ...subpages,
    ...searchPages.filter((page) => classifyUrl(page.url, args.restaurant.name) !== 'official'),
  ];
  const pages: FetchedPage[] = ordered.map((page) => ({ url: page.url, text: page.text }));
  base.fetchedUrls = pages.map((page) => page.url);
  if (pages.length === 0) {
    notes.push('no page text fetched');
    return priced();
  }
  let modelText = '';
  try {
    const model = await args.callModel({
      system: briefingSystemPrompt(),
      user: briefingUserPrompt(args.restaurant, pages),
    });
    modelText = model.text;
    units = mergeModelUsage(units, model.units);
  } catch (error) {
    notes.push(error instanceof Error ? error.message : 'model call failed');
    return priced();
  }
  const filtered = filterSupportedFacts({ raw: parseBriefingModelJson(modelText), pages });
  return {
    ...priced(),
    facts: filtered.kept,
    dropped: filtered.dropped,
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

export function formatBriefingReport(run: BriefingRun): { json: string; markdown: string } {
  const restaurants = run.restaurants.map((restaurant) => ({
    ...restaurant,
    reasons: briefingResultReasons(restaurant),
  }));
  const json = `${JSON.stringify({ schema: 'wanderbite.e06.briefing_research.v1', ...run, restaurants }, null, 2)}\n`;
  const lines = [
    '# First-visit briefing research',
    '',
    `Verified at: ${run.verifiedAt}`,
    `Input tokens: ${run.totals.input}`,
    `Output tokens: ${run.totals.output}`,
    `Web searches: ${run.restaurants.reduce((sum, result) => sum + (result.units.web_search_requests ?? 0), 0)}`,
    `Estimated cost: ${formatEstimatedUsd(run.totals.estimatedMicrodollars)} USD`,
    run.stoppedBecause ? `Stopped: ${run.stoppedBecause}` : 'Stopped: completed the selected restaurants',
    '',
  ];
  for (const restaurant of restaurants) {
    lines.push(`## ${restaurant.restaurantName}`);
    lines.push('');
    lines.push(
      `Tokens in ${restaurant.units.input ?? 0}, out ${restaurant.units.output ?? 0}. Web searches ${restaurant.units.web_search_requests ?? 0}. Estimated ${formatEstimatedUsd(restaurant.estimatedMicrodollars)} USD.`,
    );
    lines.push('');
    lines.push('Reasons:');
    for (const reason of restaurant.reasons) lines.push(`- ${reason}`);
    lines.push('');
    lines.push('Fetched:');
    if (restaurant.fetchedUrls.length === 0) lines.push('- none');
    for (const url of restaurant.fetchedUrls) lines.push(`- ${url}`);
    lines.push('');
    if (restaurant.facts.length === 0) lines.push('No supported facts.');
    for (const fact of restaurant.facts) {
      lines.push(`- ${fact.field}: ${fact.text}`);
      lines.push(`  Source: ${fact.sourceUrl}`);
      lines.push(`  Passage: ${fact.supportPassage}`);
    }
    if (restaurant.dropped.length > 0) {
      lines.push('');
      lines.push('Dropped:');
      for (const reason of restaurant.dropped) lines.push(`- ${reason}`);
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
