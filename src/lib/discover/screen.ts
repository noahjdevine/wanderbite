import type { DiscoverEvent, DiscoverFood, DiscoverOffer, PartnerLite } from '@/lib/discover/events';
import { dietaryConstraintLabel } from '@/lib/discover/stages';
import type { CuisineId } from '@/lib/cuisines';
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
};

export const EMPTY_DISCOVER_VIEWER: DiscoverViewer = {
  firstName: null,
  savedDietary: [],
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

const MAPS_HOSTS = new Set(['google.com', 'www.google.com', 'maps.google.com']);

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

export function discoverGreeting(firstName: string | null): string {
  const name = firstName?.trim();
  if (!name) return 'Free · no account needed';
  return `Good evening, ${name}`;
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
  return { ...draft, surprise: false, message, vibe: chip.vibe };
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
    return { ...base, surprise: false, vibe: nextDiscoverVibe(base.vibe) };
  }
  return { ...base };
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

export function offerChipLabel(offer: DiscoverOffer): string {
  return `${formatCents(offer.amountOff)} off ${formatCents(offer.minSpend)}+`;
}

function readOwnString(partner: object, key: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(partner, key)) return null;
  const value = (partner as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A directions link exists only when this card carries an address or an
 * https Google Maps URL. The live stream partner has neither.
 */
export function directionsHref(partner: PartnerLite): string | null {
  const mapsUrl = readOwnString(partner, 'mapsUrl');
  if (mapsUrl) {
    try {
      const url = new URL(mapsUrl);
      if (url.protocol === 'https:' && MAPS_HOSTS.has(url.hostname)) return url.toString();
    } catch {
      // A bad maps URL does not block a real address on the same card.
    }
  }
  const address = readOwnString(partner, 'address');
  if (!address) return null;
  const query = `${partner.name} ${address}`.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
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
