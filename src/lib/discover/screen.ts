import {
  discoverMapsSearchUrl,
  googleMapsSearchUrl,
  httpsGoogleMapsUrl,
} from '@/lib/discover/directions';
import type { DiscoverEvent, DiscoverFood, DiscoverOffer, PartnerLite } from '@/lib/discover/events';
import { dietaryConstraintLabel } from '@/lib/discover/stages';
import { LAUNCH_MARKET } from '@/lib/launch-market';
import type { CuisineId } from '@/lib/cuisines';
import { ROULETTE_MAX_EXCLUDED } from '@/lib/ai-bounds';
import { formatCents } from '@/lib/offers/sealed-base';
import type { RouletteDietaryFlag } from '@/lib/roulette-dietary';
import {
  ROULETTE_VIBES,
  buildRouletteSpinBody,
  type RoulettePriceRange,
  type RouletteSpinPayload,
  type RouletteTime,
  type RouletteVibe,
} from '@/lib/roulette-options';
import type { BeaState } from '@/components/bea';

/** Same sentence the current Discover page shows above the form and the result. */
export const DISCOVER_ALLERGY_NOTICE =
  'Discovery cannot assess allergies. Ask the restaurant.';

export const DISCOVER_STEP_DWELL_MS = 700;

export const DISCOVER_STREAM_BROKE =
  'The suggestion stream stopped. You can ask again.';

export const DISCOVER_RATE_LIMIT_MESSAGE =
  'Too many requests. Please wait a moment and try again.';

export const DISCOVER_NETWORK_ERROR =
  'Network error. Check your connection and try again.';

export const DISCOVER_UNEXPECTED_RESPONSE =
  'We got an unexpected response. Please try again.';

export const DISCOVER_FOUND_LINE = "Ooh, I've got one for you.";

export type DiscoverViewer = {
  firstName: string | null;
  savedDietary: readonly RouletteDietaryFlag[];
  /** False for a guest. A signed-in member stays true even when the name is blank. */
  signedIn?: boolean;
};

export const EMPTY_DISCOVER_VIEWER: DiscoverViewer = {
  firstName: null,
  savedDietary: [],
  signedIn: false,
};

export type DiscoverDraft = {
  message: string;
  vibe: RouletteVibe | null;
  timeOfDay: RouletteTime | null;
  dietaryFlags: RouletteDietaryFlag[];
  excludedCuisines: CuisineId[];
  priceRange: RoulettePriceRange | null;
  preferredCuisine: CuisineId | null;
  surprise: boolean;
};

export const EMPTY_DISCOVER_DRAFT: DiscoverDraft = {
  message: '',
  vibe: null,
  timeOfDay: null,
  dietaryFlags: [],
  excludedCuisines: [],
  priceRange: null,
  preferredCuisine: null,
  surprise: false,
};

type QuickChip =
  | { label: string; vibe: RouletteVibe; surprise?: false }
  | { label: string; surprise: true };

export const DISCOVER_QUICK_CHIPS: readonly QuickChip[] = [
  { label: 'Date night', vibe: 'Date Night' },
  { label: 'Quick bite', vibe: 'Quick Bite' },
  { label: 'Comfort food', vibe: 'Comfort Food' },
  { label: 'Surprise me', surprise: true },
];

const PRICE_ORDER: readonly RoulettePriceRange[] = ['$', '$$', '$$$', '$$$$'];

/** Same sentences as `src/lib/discovery-turn.ts`. Duplicated so the client bundle stays off `node:crypto`. */
export const DISCOVER_MESSAGE_TOO_LONG = 'That message is too long. Keep it to 500 characters.';
const SAVED_ALLERGY =
  'We cannot confirm that a kitchen can avoid that ingredient or cross-contact. This list does not include allergen handling. Ask the restaurant.';

const NO_MATCH_404 =
  'No restaurants match those dietary filters yet. Try fewer options, or we may still be tagging partners — check back soon.';

const EMPTY_CATALOG_503 = 'No restaurants available right now.';

export type DiscoverStepEvent = Extract<DiscoverEvent, { type: 'step' }>;

export type DiscoverOutcome =
  | { kind: 'pick'; event: Extract<DiscoverEvent, { type: 'pick' }> }
  | { kind: 'fallback'; event: Extract<DiscoverEvent, { type: 'fallback' }> }
  | { kind: 'error'; message: string }
  | { kind: 'empty' };

const CHICAGO_HOUR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: 'numeric',
  hourCycle: 'h23',
});

/** Hour 0–23 in America/Chicago. Independent of the process time zone. */
export function chicagoHour(now: Date): number {
  const value = CHICAGO_HOUR.formatToParts(now).find((part) => part.type === 'hour')?.value;
  const hour = Number(value);
  return Number.isFinite(hour) ? hour : 0;
}

/**
 * 05:00–11:59 morning, 12:00–16:59 afternoon, otherwise evening.
 * 04:59 is still evening. 17:00 is evening.
 */
export function discoverDayPart(now: Date): 'morning' | 'afternoon' | 'evening' {
  const hour = chicagoHour(now);
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

export function discoverGreeting(
  firstName: string | null,
  signedIn = false,
  now: Date = new Date(),
): string {
  const name = firstName?.trim();
  if (!signedIn && !name) return 'Free · no account needed';
  const part = discoverDayPart(now);
  const hello =
    part === 'morning' ? 'Good morning' : part === 'afternoon' ? 'Good afternoon' : 'Good evening';
  return name ? `${hello}, ${name}` : hello;
}

export function dietaryFlagsForStatus(
  saved: readonly RouletteDietaryFlag[],
  session: readonly RouletteDietaryFlag[],
): RouletteDietaryFlag[] {
  const seen = new Set<string>();
  const flags: RouletteDietaryFlag[] = [];
  for (const flag of [...saved, ...session]) {
    if (seen.has(flag)) continue;
    seen.add(flag);
    flags.push(flag);
  }
  return flags;
}

export function dietaryButtonLabel(flags: readonly RouletteDietaryFlag[]): string {
  if (flags.length === 0) return 'Dietary: none set';
  return `Dietary: ${flags.map((flag) => dietaryConstraintLabel(flag)).join(', ')}`;
}

export function thinkingSteps(events: readonly DiscoverEvent[]): DiscoverStepEvent[] {
  return events.filter((event): event is DiscoverStepEvent => event.type === 'step');
}

/**
 * Steps stay in arrival order. Memory and rank are included only when the
 * stream actually sent them. Nothing here invents a step.
 */
export function outcomeFromEvents(events: readonly DiscoverEvent[]): DiscoverOutcome {
  for (const event of events) {
    if (event.type === 'pick') return { kind: 'pick', event };
  }
  for (const event of events) {
    if (event.type === 'fallback') return { kind: 'fallback', event };
  }
  for (const event of events) {
    if (event.type === 'error') return { kind: 'error', message: event.message };
  }
  return { kind: 'empty' };
}

export function foodForOutcome(outcome: DiscoverOutcome): DiscoverFood | 'generic' {
  if (outcome.kind === 'pick') return outcome.event.food;
  return 'generic';
}

export function shownRestaurantId(events: readonly DiscoverEvent[]): string | null {
  const outcome = outcomeFromEvents(events);
  if (outcome.kind === 'pick') return outcome.event.partner.id;
  if (outcome.kind === 'fallback') return outcome.event.alternative.id;
  return null;
}

/**
 * Session memory for Another idea and a typed follow-up.
 * Newest id last. A repeat moves to the end. The route accepts at most
 * `ROULETTE_MAX_EXCLUDED` ids and keeps the front of the list, so this
 * keeps the most recent ids, still oldest first.
 */
export function rememberShownRestaurant(shown: readonly string[], restaurantId: string): string[] {
  const id = restaurantId.trim();
  if (!id) return [...shown];
  const next = shown.filter((item) => item !== id);
  next.push(id);
  if (next.length <= ROULETTE_MAX_EXCLUDED) return next;
  return next.slice(next.length - ROULETTE_MAX_EXCLUDED);
}

export function shownRestaurantExclusions(shown: readonly string[]): string[] {
  if (shown.length <= ROULETTE_MAX_EXCLUDED) return [...shown];
  return shown.slice(shown.length - ROULETTE_MAX_EXCLUDED);
}

/**
 * Enter sends the composer. Shift+Enter keeps the newline. Enter during IME
 * composition confirms the character and does not send.
 */
export function discoverEnterSubmits(event: {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}): boolean {
  if (event.key !== 'Enter' || event.shiftKey) return false;
  if (event.isComposing || event.nativeEvent?.isComposing) return false;
  const keyCode = event.keyCode ?? event.nativeEvent?.keyCode;
  if (keyCode === 229) return false;
  return true;
}

export function beaStateForPhase(phase: 'ask' | 'thinking' | 'pick' | 'error' | 'recipe'): BeaState {
  if (phase === 'thinking') return 'thinking';
  if (phase === 'pick') return 'found';
  return 'idle';
}

/**
 * First step is visible immediately. Each later step, then the outcome, waits
 * `dwellMs`. Reduced motion shows every arrived step and the outcome at once.
 */
export function scheduleDiscoverReveal(args: {
  stepCount: number;
  dwellMs?: number;
  reducedMotion: boolean;
  onVisibleSteps: (count: number) => void;
  onOutcome: () => void;
}): () => void {
  const dwellMs = args.dwellMs ?? DISCOVER_STEP_DWELL_MS;
  if (args.reducedMotion || args.stepCount <= 0) {
    args.onVisibleSteps(Math.max(0, args.stepCount));
    args.onOutcome();
    return () => {};
  }

  args.onVisibleSteps(1);
  const timers: ReturnType<typeof setTimeout>[] = [];
  for (let index = 1; index <= args.stepCount; index += 1) {
    timers.push(
      setTimeout(() => {
        if (index < args.stepCount) args.onVisibleSteps(index + 1);
        else args.onOutcome();
      }, dwellMs * index),
    );
  }
  return () => {
    for (const timer of timers) clearTimeout(timer);
  };
}

export function messageForDiscoverStatus(
  status: number,
  serverError: string | null | undefined,
): string {
  const server = typeof serverError === 'string' ? serverError.trim() : '';
  if (server) return server;
  if (status === 400) return DISCOVER_MESSAGE_TOO_LONG;
  if (status === 404) return NO_MATCH_404;
  if (status === 422) return SAVED_ALLERGY;
  if (status === 429) return DISCOVER_RATE_LIMIT_MESSAGE;
  if (status === 503) return EMPTY_CATALOG_503;
  return 'Something went wrong. Please try again.';
}

export function applyQuickChip(draft: DiscoverDraft, chip: QuickChip): DiscoverDraft {
  if ('surprise' in chip && chip.surprise) {
    return {
      ...draft,
      surprise: true,
      vibe: null,
      timeOfDay: null,
      priceRange: null,
      preferredCuisine: null,
    };
  }
  const message = draft.message.trim().length > 0 ? draft.message : chip.label;
  return {
    ...draft,
    surprise: false,
    message,
    vibe: chip.vibe,
    timeOfDay: null,
    priceRange: null,
    preferredCuisine: null,
  };
}

export function cheaperPrice(current: RoulettePriceRange | null): RoulettePriceRange {
  if (!current) return '$';
  const index = PRICE_ORDER.indexOf(current);
  if (index <= 0) return '$';
  return PRICE_ORDER[index - 1] ?? '$';
}

export function nextDiscoverVibe(current: RouletteVibe | null): RouletteVibe {
  if (!current) return ROULETTE_VIBES[0];
  const index = ROULETTE_VIBES.indexOf(current);
  if (index < 0) return ROULETTE_VIBES[0];
  return ROULETTE_VIBES[(index + 1) % ROULETTE_VIBES.length] ?? ROULETTE_VIBES[0];
}

export type DiscoverRefine = 'another' | 'cheaper' | 'new-vibe';

/** Another idea repeats the ask. Cheaper and New vibe keep the message text. */
export function refineDiscoverDraft(base: DiscoverDraft, refine: DiscoverRefine): DiscoverDraft {
  if (refine === 'cheaper') {
    return { ...base, surprise: false, priceRange: cheaperPrice(base.priceRange) };
  }
  if (refine === 'new-vibe') {
    if (!base.vibe) return { ...base, surprise: false };
    return { ...base, surprise: false, vibe: nextDiscoverVibe(base.vibe) };
  }
  return { ...base };
}

/**
 * A newly typed ask drops a chip vibe the words do not repeat.
 * Re-selecting the chip, or typing "date night", keeps it.
 */
export function vibeKeptByMessage(
  message: string,
  vibe: RouletteVibe | null,
): RouletteVibe | null {
  if (!vibe) return null;
  return message.toLowerCase().includes(vibe.toLowerCase()) ? vibe : null;
}

export function timeKeptByMessage(
  message: string,
  timeOfDay: DiscoverDraft['timeOfDay'],
): DiscoverDraft['timeOfDay'] {
  if (!timeOfDay) return null;
  return message.toLowerCase().includes(timeOfDay.toLowerCase()) ? timeOfDay : null;
}

/**
 * A newly typed ask replaces the previous one.
 * Chip vibes, hours, price, and cuisine do not come along unless the new words
 * name that vibe or time. Session dietary flags stay until the dietary pill changes them.
 */
export function draftForNewTypedAsk(base: DiscoverDraft, message: string): DiscoverDraft {
  return {
    ...base,
    message,
    surprise: false,
    vibe: vibeKeptByMessage(message, base.vibe),
    timeOfDay: timeKeptByMessage(message, base.timeOfDay),
    priceRange: null,
    preferredCuisine: null,
  };
}

/** A typed follow-up replaces the ask. Surprise must clear or the message is omitted. */
export function followUpDiscoverDraft(base: DiscoverDraft, message: string): DiscoverDraft {
  return draftForNewTypedAsk(base, message);
}

export const DISCOVER_SURPRISE_INDEX_KEY = 'wanderbite.discover.surpriseIndex';
export const DISCOVER_SHOWN_IDS_KEY = 'wanderbite.discover.shownIds';

export type DiscoverSessionMemory = {
  surpriseIndex: number;
  shownIds: string[];
};

/** Browser session only. A missing or broken store reads as a fresh visit. */
export function readDiscoverSession(storage: Pick<Storage, 'getItem'> | null): DiscoverSessionMemory {
  if (!storage) return { surpriseIndex: 0, shownIds: [] };
  let surpriseIndex = 0;
  let shownIds: string[] = [];
  try {
    const index = Number(storage.getItem(DISCOVER_SURPRISE_INDEX_KEY));
    if (Number.isFinite(index) && index >= 0) surpriseIndex = Math.trunc(index);
  } catch {
    surpriseIndex = 0;
  }
  try {
    const raw = storage.getItem(DISCOVER_SHOWN_IDS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      shownIds = parsed.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    }
  } catch {
    shownIds = [];
  }
  return { surpriseIndex, shownIds };
}

export function writeDiscoverSession(
  storage: Pick<Storage, 'setItem'> | null,
  memory: DiscoverSessionMemory,
): void {
  if (!storage) return;
  try {
    storage.setItem(DISCOVER_SURPRISE_INDEX_KEY, String(memory.surpriseIndex));
    storage.setItem(DISCOVER_SHOWN_IDS_KEY, JSON.stringify(memory.shownIds));
  } catch {
    // A private window can reject storage. The in-memory list still works.
  }
}

export function draftToSpinBody(draft: DiscoverDraft): RouletteSpinPayload {
  return buildRouletteSpinBody({
    vibe: draft.vibe,
    timeOfDay: draft.timeOfDay,
    dietaryFlags: [...draft.dietaryFlags],
    excludedCuisines: [...draft.excludedCuisines],
    priceRange: draft.priceRange,
    preferredCuisine: draft.preferredCuisine,
    message: draft.message,
    surprise: draft.surprise,
  });
}

/**
 * Fields `draftToSpinBody` sends besides the message. A blank box still asks
 * when any of these is set. Surprise alone is a chip, not a Refine selection.
 */
export function discoverDraftHasSelection(draft: DiscoverDraft): boolean {
  return (
    draft.vibe !== null ||
    draft.timeOfDay !== null ||
    draft.priceRange !== null ||
    draft.preferredCuisine !== null ||
    draft.dietaryFlags.length > 0 ||
    draft.excludedCuisines.length > 0
  );
}

export function offerChipLabel(offer: DiscoverOffer): string {
  return `${formatCents(offer.amountOff)} off ${formatCents(offer.minSpend)}+`;
}

/**
 * Let's go uses `partner.directions`. A valid https Google Maps URL wins.
 * An address without a usable URL falls back to the same name-plus-city
 * search the roulette page builds. Neither one leaves the link closed.
 */
export function directionsHref(partner: PartnerLite): string | null {
  const mapsUrl = httpsGoogleMapsUrl(partner.directions?.mapsUrl);
  if (mapsUrl) return mapsUrl;
  const address = partner.directions?.address?.trim() ?? '';
  if (!address) return null;
  return (
    discoverMapsSearchUrl(partner.name, LAUNCH_MARKET.cityQuery) ?? googleMapsSearchUrl(address)
  );
}

function readOwnFinite(partner: object, key: string): number | null {
  if (!Object.prototype.hasOwnProperty.call(partner, key)) return null;
  const value = (partner as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Closer stays off. The streamed partner has no coordinates or distance, and
 * the ask body has no field that would make a resubmit "closer". A lat/lon
 * stuck on the object still does not enable the chip.
 */
export function closerChipIncluded(partner: PartnerLite): boolean {
  const hasPoint =
    readOwnFinite(partner, 'lat') != null && readOwnFinite(partner, 'lon') != null;
  const hasDistance = readOwnFinite(partner, 'distanceMeters') != null;
  if (!hasPoint && !hasDistance) return false;
  return false;
}
