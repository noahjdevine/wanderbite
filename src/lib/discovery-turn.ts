import { ROULETTE_MAX_MESSAGE_CHARS } from '@/lib/ai-bounds';
import { discoveryReplayMacEqual } from '@/lib/ai-guest';
import { isCuisineId, type CuisineId } from '@/lib/cuisines';
import { isRouletteDietaryFlag, type RouletteDietaryFlag } from '@/lib/roulette-dietary';

export const DISCOVERY_ALLERGY_ERROR =
  'We cannot confirm that a kitchen can avoid that ingredient or cross-contact. This list does not include allergen handling. Ask the restaurant.';

export const DISCOVERY_MESSAGE_TOO_LONG_ERROR =
  'That message is too long. Keep it to 500 characters.';

export const DISCOVERY_PROFILE_ERROR =
  'We could not load your discovery settings. Please try again.';

export const DISCOVERY_REPLAY_MISMATCH_ERROR =
  'That request does not match the earlier one. Start a new ask.';

const SAFETY_PHRASES = [
  'cross-contact',
  'cross contact',
  'cross-contamination',
  'cross contamination',
  "can't eat",
  'cannot eat',
  "can't have",
  'cannot have',
  'must avoid',
  'tree nut',
] as const;

const SAFETY_WORDS = [
  'allergy',
  'allergic',
  'allergen',
  'anaphylaxis',
  'intolerance',
  'celiac',
  'peanut',
  'shellfish',
  'crustacean',
  'shrimp',
  'prawn',
  'sesame',
  'soy',
  'egg',
  'milk',
  'dairy',
  'gluten',
  'wheat',
  'fish',
  'sulfite',
] as const;

const SAFETY_WORD_PATTERN = new RegExp(`\\b(?:${SAFETY_WORDS.join('|')})\\b`, 'i');

export type DiscoveryMessageGate =
  | { ok: true; message: string }
  | { ok: false; status: 400 | 422; error: string };

export type DiscoveryProfileGate =
  | { ok: false; reason: 'unavailable' }
  | { ok: false; reason: 'allergy' }
  | {
      ok: true;
      accountTier: 'paid' | 'free';
      dietaryFlags: readonly string[] | null;
      excludedCuisines: readonly string[];
    };

export type DiscoveryReplayDecision =
  | { outcome: 'ai'; restaurantId: string }
  | { outcome: 'legacy'; restaurantId: string }
  | { outcome: 'legacy_discard' }
  | { outcome: 'mismatch' };

type DiscoveryCardRow = {
  name: string;
  neighborhood: string | null;
  cuisine_tags: string[] | null;
  price_range: string | null;
};

function normalizeForScan(message: string): string {
  return message.toLowerCase().replace(/[\u2018\u2019\u02BC]/g, "'");
}

export function messageHitsSafetyList(message: string): boolean {
  const text = normalizeForScan(message);
  if (SAFETY_PHRASES.some((phrase) => text.includes(phrase))) return true;
  return SAFETY_WORD_PATTERN.test(text);
}

/** Reject the whole string. Do not clip, and do not scan a prefix of an over-long message. */
export function gateDiscoveryMessage(raw: unknown): DiscoveryMessageGate {
  if (typeof raw !== 'string') return { ok: true, message: '' };
  if (raw.length > ROULETTE_MAX_MESSAGE_CHARS) {
    return { ok: false, status: 400, error: DISCOVERY_MESSAGE_TOO_LONG_ERROR };
  }
  const message = raw.trim();
  if (messageHitsSafetyList(message)) {
    return { ok: false, status: 422, error: DISCOVERY_ALLERGY_ERROR };
  }
  return { ok: true, message };
}

export function hasSavedAllergy(flags: unknown): boolean {
  if (!Array.isArray(flags)) return false;
  return flags.some((flag) => typeof flag === 'string' && flag.trim().length > 0);
}

export function gateSignedInProfile(args: {
  profileError: boolean;
  profile: {
    subscription_status: string | null;
    dietary_flags: string[] | null;
    allergy_flags: string[] | null;
  } | null;
  preferencesError: boolean;
  excludedCuisines: readonly string[] | null;
}): DiscoveryProfileGate {
  if (args.profileError || !args.profile) return { ok: false, reason: 'unavailable' };
  if (hasSavedAllergy(args.profile.allergy_flags)) return { ok: false, reason: 'allergy' };
  if (args.preferencesError) return { ok: false, reason: 'unavailable' };
  return {
    ok: true,
    accountTier: args.profile.subscription_status === 'active' ? 'paid' : 'free',
    dietaryFlags: args.profile.dietary_flags,
    excludedCuisines: args.excludedCuisines ?? [],
  };
}

export function mergeDietaryFlags(
  body: readonly string[],
  saved: unknown,
): RouletteDietaryFlag[] {
  const fromSaved = Array.isArray(saved)
    ? saved.filter((item): item is string => typeof item === 'string')
    : [];
  const merged = [...body, ...fromSaved].filter((flag): flag is RouletteDietaryFlag =>
    isRouletteDietaryFlag(flag),
  );
  return [...new Set(merged)];
}

export function mergeExcludedCuisines(body: readonly string[], saved: unknown): CuisineId[] {
  const fromSaved = Array.isArray(saved)
    ? saved.filter((item): item is string => typeof item === 'string')
    : [];
  const merged = [...body, ...fromSaved].filter((id): id is CuisineId => isCuisineId(id));
  return [...new Set(merged)];
}

/** Validated, merged filters. Empty tokens mark omitted soft preferences. */
export function canonicalFilterString(args: {
  dietary: readonly string[];
  excluded: readonly string[];
  vibe?: string | null;
  timeOfDay?: string | null;
  priceRange?: string | null;
  preferredCuisine?: string | null;
}): string {
  const dietary = [...args.dietary].sort().join(',');
  const excluded = [...args.excluded].sort().join(',');
  const vibe = args.vibe ?? '';
  const timeOfDay = args.timeOfDay ?? '';
  const priceRange = args.priceRange ?? '';
  const preferredCuisine = args.preferredCuisine ?? '';
  return `dietary=${dietary}|excluded=${excluded}|vibe=${vibe}|time=${timeOfDay}|price=${priceRange}|cuisine=${preferredCuisine}`;
}

export function discoveryCardSentence(row: DiscoveryCardRow, marketDisplayName: string): string {
  const clauses = [`${row.name} is a ${marketDisplayName} partner`];
  const neighborhood = row.neighborhood?.trim();
  if (neighborhood) clauses.push(`in ${neighborhood}`);
  const tags = (row.cuisine_tags ?? []).map((tag) => tag.trim()).filter(Boolean);
  if (tags.length > 0) clauses.push(`tagged ${tags.join(', ')}`);
  const price = row.price_range?.trim();
  if (price) clauses.push(`listed at ${price}`);
  return `${clauses.join(', ')}. Confirm details with the restaurant.`;
}

export function parseModelRestaurantId(text: string): string | null {
  const tryParse = (source: string): string | null => {
    try {
      const obj = JSON.parse(source) as unknown;
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
      const restaurantId = (obj as Record<string, unknown>).restaurantId;
      if (typeof restaurantId !== 'string') return null;
      const id = restaurantId.trim();
      if (!id || id.length > 64) return null;
      return id;
    } catch {
      return null;
    }
  };

  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (direct) return direct;

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const fenced = tryParse(fence[1].trim());
    if (fenced) return fenced;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    return tryParse(trimmed.slice(start, end + 1));
  }
  return null;
}

export function isIdInPromptRows(id: string | null, promptIds: readonly string[]): boolean {
  return id !== null && promptIds.includes(id);
}

export function buildStoredDiscoveryPayload(args: {
  restaurantId: string;
  selectionMode: 'ai' | 'random_fallback';
  promptIds: readonly string[];
  messageMac: string;
  filterMac: string;
}): Record<string, string | string[]> {
  return {
    restaurantId: args.restaurantId,
    selectionMode: args.selectionMode,
    promptIds: [...args.promptIds],
    messageMac: args.messageMac,
    filterMac: args.filterMac,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * `ai` only when the stored payload proves the id was sent and this request matches.
 * A MAC mismatch is the only 409. Missing MAC fields are legacy and never `ai`.
 */
export function decideReplay(args: {
  payload: unknown;
  messageMac: string;
  filterMac: string;
  poolIds: ReadonlySet<string>;
}): DiscoveryReplayDecision {
  if (!args.payload || typeof args.payload !== 'object' || Array.isArray(args.payload)) {
    return { outcome: 'legacy_discard' };
  }
  const stored = args.payload as Record<string, unknown>;
  const restaurantId = stored.restaurantId;
  if (typeof restaurantId !== 'string' || restaurantId.length === 0) {
    return { outcome: 'legacy_discard' };
  }

  const fingerprintComplete =
    isStringArray(stored.promptIds) &&
    typeof stored.messageMac === 'string' &&
    stored.messageMac.length > 0 &&
    typeof stored.filterMac === 'string' &&
    stored.filterMac.length > 0;

  if (!fingerprintComplete) {
    return args.poolIds.has(restaurantId)
      ? { outcome: 'legacy', restaurantId }
      : { outcome: 'legacy_discard' };
  }

  const macsMatch =
    discoveryReplayMacEqual(stored.messageMac as string, args.messageMac) &&
    discoveryReplayMacEqual(stored.filterMac as string, args.filterMac);
  if (!macsMatch) return { outcome: 'mismatch' };

  const promptIds = stored.promptIds as string[];
  if (
    stored.selectionMode === 'ai' &&
    promptIds.includes(restaurantId) &&
    args.poolIds.has(restaurantId)
  ) {
    return { outcome: 'ai', restaurantId };
  }
  if (stored.selectionMode === 'ai') return { outcome: 'legacy_discard' };
  return args.poolIds.has(restaurantId)
    ? { outcome: 'legacy', restaurantId }
    : { outcome: 'legacy_discard' };
}
