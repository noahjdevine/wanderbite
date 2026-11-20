import { clipChars, ROULETTE_MAX_NAME_CHARS, ROULETTE_MAX_RESULT_REASON_CHARS } from '@/lib/ai-bounds';
import type { DiscoverPromptFacts } from '@/lib/discover/briefing-facts';

/**
 * Haiku writes one sentence about the restaurant code already chose.
 * A valid line is what the card shows (`selectionMode: ai`). Any rejection
 * uses the template sentence (`selectionMode: random_fallback`). Callers log
 * the code and never the text.
 */
export const DISCOVER_LINE_REJECT_CODES = [
  'empty',
  'not_plain',
  'url',
  'phone',
  'price',
  'hours',
  'promo',
  'other_restaurant',
  'multi_sentence',
] as const;

export type DiscoverLineRejectCode = (typeof DISCOVER_LINE_REJECT_CODES)[number];

export type DiscoverLineDecision =
  | { ok: true; line: string }
  | { ok: false; code: DiscoverLineRejectCode };

const QUOTE_PAIRS: readonly [string, string][] = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
];

const DAY_OR_HOURS =
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|wed|thurs|thu|fri|sat|sun)\b|\b(?:hours|closed|closes|closing|opens|opening)\b|\bopen\s+(?:at|until|from|daily|tonight|late)\b|\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b\d{1,2}:\d{2}\b/i;

const PRICE =
  /\$|\b(?:dollar|dollars|cent|cents|buck|bucks|cheap|cheaper|inexpensive|expensive|pricey|affordable|priced|pricing|price)\b/i;

const PROMO =
  /\b(?:discount|discounts|promo|promotion|promotional|coupon|coupons|voucher|vouchers|bogo|deal|deals|sale|sales|complimentary)\b|\d+\s*%|\bpercent(?:age)?\s+off\b|\bhalf[\s-]?off\b/i;

const URL =
  /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|us|restaurant)\b/i;

const PHONE = /(?:\+?\d[\s().-]*){6}\d/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripWrappingQuotes(value: string): string {
  let text = value.trim();
  let changed = true;
  while (changed && text.length >= 2) {
    changed = false;
    for (const [open, close] of QUOTE_PAIRS) {
      if (text.startsWith(open) && text.endsWith(close)) {
        text = text.slice(open.length, text.length - close.length).trim();
        changed = true;
      }
    }
  }
  return text;
}

function mentionsOtherRestaurant(text: string, names: readonly string[]): boolean {
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length < 3) continue;
    const pattern = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${escapeRegExp(trimmed)}(?:$|[^\\p{L}\\p{N}])`,
      'iu',
    );
    if (pattern.test(text)) return true;
  }
  return false;
}

function isOneSentence(text: string): boolean {
  if (/[\r\n]/.test(text)) return false;
  const parts = text
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length <= 1;
}

export function buildDiscoverLinePrompt(args: {
  marketDisplayName: string;
  restaurant: {
    name: string;
    cuisine_tags: string[] | null;
    neighborhood: string | null;
    price_range: string | null;
  };
  preferenceLines: string;
  facts?: DiscoverPromptFacts;
}): { systemPrompt: string; userPrompt: string } {
  const facts =
    args.facts && Object.keys(args.facts).length > 0 ? args.facts : undefined;
  const row: {
    name: string;
    cuisine_tags: string[] | null;
    neighborhood: string | null;
    price_range: string | null;
    facts?: DiscoverPromptFacts;
  } = {
    name: clipChars(args.restaurant.name.trim(), ROULETTE_MAX_NAME_CHARS),
    cuisine_tags: args.restaurant.cuisine_tags,
    neighborhood: args.restaurant.neighborhood,
    price_range: args.restaurant.price_range,
  };
  if (facts) row.facts = facts;
  const factsNote = facts
    ? 'Researched notes are in facts. A missing fact is unknown. Do not invent hours, prices, phone numbers, or allergy handling.\n\n'
    : '';
  const prefs = args.preferenceLines.trim();
  const systemPrompt = `You write one short sentence for a discovery card in ${args.marketDisplayName}.

The restaurant is already chosen. Do not name any other place.

Return plain text only: one sentence, no quotes, no markdown, and no JSON.
Do not include a URL, a phone number, a price, a dollar amount, hours, a day of the week, or a discount.
Use only the fields you are given. Leave out anything unknown.`;
  const userPrompt = `Restaurant:
${JSON.stringify(row)}

${factsNote}User preferences (each line may be absent):
${prefs || '(No specific preferences.)'}`;
  return { systemPrompt, userPrompt };
}

/** Normalize, then reject. A kept line is trimmed, unquoted, and clipped. */
export function validateDiscoverLine(args: {
  text: string;
  otherRestaurantNames: readonly string[];
}): DiscoverLineDecision {
  const text = stripWrappingQuotes(args.text);
  if (!text || !/\p{L}/u.test(text)) return { ok: false, code: 'empty' };
  if (/[<>`{}[\]]/.test(text) || text.includes('**') || text.includes('__')) {
    return { ok: false, code: 'not_plain' };
  }
  if (URL.test(text)) return { ok: false, code: 'url' };
  if (PHONE.test(text)) return { ok: false, code: 'phone' };
  if (PRICE.test(text)) return { ok: false, code: 'price' };
  if (DAY_OR_HOURS.test(text)) return { ok: false, code: 'hours' };
  if (PROMO.test(text)) return { ok: false, code: 'promo' };
  if (mentionsOtherRestaurant(text, args.otherRestaurantNames)) {
    return { ok: false, code: 'other_restaurant' };
  }
  if (!isOneSentence(text)) return { ok: false, code: 'multi_sentence' };
  return { ok: true, line: clipChars(text, ROULETTE_MAX_RESULT_REASON_CHARS) };
}
