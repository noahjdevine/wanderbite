import { pluralize } from '@/lib/format/text';
import { redemptionIsVerified } from '@/lib/notes/note-rules';
import { PUBLIC_SITE_ORIGIN } from '@/lib/public-site';
import type { VisitStatus } from '@/lib/visits/visit-status';
import type { MyJourneyView } from '@/lib/my-journey-views';

/**
 * Share My Passport.
 *
 * `title` is always "My Wanderbite Food Passport".
 * `url` is always `https://wanderbite.co` (no path, no query).
 * `text` is the verified-visit counts and the Chicago month streak when
 * progress loaded:
 *   "I've explored {n restaurant(s)} across {n neighborhood(s)} with Wanderbite 🍽️🔥 {n month(s)} streak and counting."
 * When the neighborhood count was not loaded, the "across …" phrase is omitted.
 * When progress failed, `text` is only the title. It does not say zero.
 *
 * The builder never reads note text, email, or redemption codes. A public note
 * is also left out. Sharing a passport does not publish a memory.
 */
export type PassportShareSource = {
  progressUnavailable: boolean;
  uniqueRestaurants: number;
  neighborhoods: number | null;
  currentStreak: number;
  privateNotes?: readonly string[];
  email?: string | null;
  redemptionCodes?: readonly string[];
};

export type PassportSharePayload = {
  title: string;
  text: string;
  url: string;
};

export const PASSPORT_SHARE_TITLE = 'My Wanderbite Food Passport';

export const PASSPORT_UNAVAILABLE_MESSAGE = 'Passport temporarily unavailable';

export const PASSPORT_RETRY_HREF = '/journey?view=passport';

export const PASSPORT_SEGMENT_HREF = '/journey?view=passport';

export const MAP_SEGMENT_HREF = '/journey?view=map';

/** Display name used when the member has no usable first name. */
export const PASSPORT_UNNAMED_DISPLAY = 'Your';

/**
 * Cover line under the passport title. "Your" alone reads as a fragment,
 * so the unnamed member sees "Your Passport".
 */
export function passportHolderLine(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed || trimmed === PASSPORT_UNNAMED_DISPLAY) return 'Your Passport';
  return trimmed;
}

const SHARE_MARK = '🍽️🔥';

export function buildPassportShare(source: PassportShareSource): PassportSharePayload {
  const title = PASSPORT_SHARE_TITLE;
  if (source.progressUnavailable) {
    return { title, text: title, url: PUBLIC_SITE_ORIGIN };
  }
  const places = pluralize(source.uniqueRestaurants, 'restaurant');
  const streak = `${pluralize(source.currentStreak, 'month')} streak and counting.`;
  const text =
    source.neighborhoods == null
      ? `I've explored ${places} with Wanderbite ${SHARE_MARK} ${streak}`
      : `I've explored ${places} across ${pluralize(source.neighborhoods, 'neighborhood')} with Wanderbite ${SHARE_MARK} ${streak}`;
  return { title, text, url: PUBLIC_SITE_ORIGIN };
}

export type StampKind = 'stamp' | 'pending' | 'none';

/** Verified and note_added stamp. code_issued is pending. Nothing else is a stamp. */
export function stampKind(status: VisitStatus): StampKind {
  if (status === 'verified' || status === 'note_added') return 'stamp';
  if (status === 'code_issued') return 'pending';
  return 'none';
}

const ROTATION_MIN = -8;
const ROTATION_MAX = 6;

/**
 * Degrees in [-8, 6]. FNV-1a over the redemption id. Same result on the server
 * and the client. Does not use Math.random.
 */
export function stampRotationDegrees(redemptionId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < redemptionId.length; i += 1) {
    hash ^= redemptionId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const span = ROTATION_MAX - ROTATION_MIN + 1;
  return ROTATION_MIN + (hash >>> 0) % span;
}

export type CuisineInkMatch = {
  key: string;
  color: string;
  label: string;
};

/**
 * First matching tag wins, in array order. Colors are the spec inks plus
 * the same dark range so text on the stamp page stays at least 4.5:1 on white.
 * An empty list or an unrecognized tag uses the fallback.
 */
const CUISINE_INKS: readonly { keys: readonly string[]; ink: CuisineInkMatch }[] = [
  { keys: ['pizza'], ink: { key: 'pizza', color: '#c2410c', label: 'Pizza' } },
  { keys: ['sushi', 'japanese'], ink: { key: 'sushi', color: '#0f766e', label: 'Sushi' } },
  { keys: ['american', 'bar', 'burger'], ink: { key: 'american', color: '#6d28d9', label: 'American' } },
  { keys: ['mexican', 'taco', 'tex-mex', 'texmex'], ink: { key: 'mexican', color: '#9a3412', label: 'Mexican' } },
  { keys: ['thai'], ink: { key: 'thai', color: '#9f1239', label: 'Thai' } },
  { keys: ['chinese'], ink: { key: 'chinese', color: '#9a3412', label: 'Chinese' } },
  { keys: ['indian'], ink: { key: 'indian', color: '#9a3412', label: 'Indian' } },
  { keys: ['italian'], ink: { key: 'italian', color: '#9f1239', label: 'Italian' } },
  { keys: ['mediterranean'], ink: { key: 'mediterranean', color: '#0f766e', label: 'Mediterranean' } },
  { keys: ['seafood', 'fish'], ink: { key: 'seafood', color: '#155e75', label: 'Seafood' } },
  { keys: ['bbq', 'barbecue'], ink: { key: 'bbq', color: '#9a3412', label: 'Barbecue' } },
  { keys: ['korean'], ink: { key: 'korean', color: '#9f1239', label: 'Korean' } },
  { keys: ['vietnamese'], ink: { key: 'vietnamese', color: '#115e59', label: 'Vietnamese' } },
  { keys: ['greek'], ink: { key: 'greek', color: '#1e40af', label: 'Greek' } },
  { keys: ['french'], ink: { key: 'french', color: '#6d28d9', label: 'French' } },
  { keys: ['breakfast', 'brunch'], ink: { key: 'brunch', color: '#9a3412', label: 'Brunch' } },
  { keys: ['dessert', 'bakery'], ink: { key: 'dessert', color: '#9d174d', label: 'Dessert' } },
  { keys: ['coffee', 'cafe', 'café'], ink: { key: 'coffee', color: '#78350f', label: 'Coffee' } },
  { keys: ['steak'], ink: { key: 'steak', color: '#7f1d1d', label: 'Steak' } },
];

export const FALLBACK_CUISINE_INK: CuisineInkMatch = {
  key: 'unknown',
  color: '#5b21b6',
  label: 'Cuisine',
};

export function cuisineInk(tags: readonly string[] | null | undefined): CuisineInkMatch {
  for (const tag of tags ?? []) {
    const norm = tag.trim().toLowerCase();
    if (!norm) continue;
    for (const entry of CUISINE_INKS) {
      if (entry.keys.some((key) => norm.includes(key))) return entry.ink;
    }
  }
  return FALLBACK_CUISINE_INK;
}

export function allCuisineInkColors(): string[] {
  const colors = CUISINE_INKS.map((entry) => entry.ink.color);
  colors.push(FALLBACK_CUISINE_INK.color);
  return [...new Set(colors)];
}

const chicagoShort = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  month: 'short',
  day: 'numeric',
});

const chicagoLong = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const chicagoMonth = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  month: 'long',
});

const chicagoYear = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric',
});

export type ChicagoVisitDate = {
  short: string;
  long: string;
  month: string;
  year: string;
};

/** America/Chicago calendar parts. Independent of the process time zone. */
export function chicagoVisitDate(iso: string | null | undefined): ChicagoVisitDate | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return {
    short: chicagoShort.format(date),
    long: chicagoLong.format(date),
    month: chicagoMonth.format(date),
    year: chicagoYear.format(date),
  };
}

/** Member-facing Passport switcher. Journal is not a Passport segment. */
export type PassportSegmentId = 'stamps' | 'map';

export function segmentForJourneyView(view: MyJourneyView): PassportSegmentId | null {
  if (view === 'passport') return 'stamps';
  if (view === 'map') return 'map';
  return null;
}

/** Marks on one passport leaf. Fixed so the server and the browser page the same list. */
export const PASSPORT_PAGE_SIZE = 4;

export function passportPageCount(itemCount: number): number {
  if (itemCount <= 0) return 1;
  return Math.ceil(itemCount / PASSPORT_PAGE_SIZE);
}

export function passportPageItems<T>(items: readonly T[], pageIndex: number): T[] {
  const last = passportPageCount(items.length) - 1;
  const page = Math.min(Math.max(pageIndex, 0), last);
  const start = page * PASSPORT_PAGE_SIZE;
  return items.slice(start, start + PASSPORT_PAGE_SIZE);
}

/**
 * Chicago long date of the earliest verified visit. Pending codes are not
 * passed in. An empty list has no issued date.
 */
export function passportIssuedOn(verifiedAt: readonly (string | null | undefined)[]): string | null {
  let earliest: string | null = null;
  let earliestMs = Number.POSITIVE_INFINITY;
  for (const iso of verifiedAt) {
    if (!iso) continue;
    const ms = new Date(iso).getTime();
    if (Number.isNaN(ms) || ms >= earliestMs) continue;
    earliest = iso;
    earliestMs = ms;
  }
  return earliest ? chicagoVisitDate(earliest)?.long ?? null : null;
}

export function segmentHref(segment: PassportSegmentId): string {
  if (segment === 'stamps') return PASSPORT_SEGMENT_HREF;
  return MAP_SEGMENT_HREF;
}

/** Public is offered only when the redemption is verified and verified_at is set. */
export function offerPublicToggle(input: {
  redemptionStatus: string | null | undefined;
  verifiedAt: string | null | undefined;
}): boolean {
  return redemptionIsVerified(input.redemptionStatus, input.verifiedAt);
}
