import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DISCOVERY_ALLERGY_ERROR,
  DISCOVERY_MESSAGE_TOO_LONG_ERROR,
} from '@/lib/discovery-turn';
import { encodeDiscoverSse, type DiscoverEvent } from '@/lib/discover/events';
import {
  DISCOVER_MESSAGE_TOO_LONG,
  DISCOVER_RATE_LIMIT_MESSAGE,
  DISCOVER_STEP_DWELL_MS,
  applyQuickChip,
  cheaperPrice,
  closerChipIncluded,
  dietaryButtonLabel,
  directionsHref,
  draftToSpinBody,
  foodForOutcome,
  messageForDiscoverStatus,
  outcomeFromEvents,
  refineDiscoverDraft,
  scheduleDiscoverReveal,
  thinkingSteps,
  type DiscoverDraft,
} from '@/lib/discover/screen';
import type { PartnerLite } from '@/lib/discover/events';

const baseDraft: DiscoverDraft = {
  message: 'spicy noodles',
  vibe: 'Date Night',
  timeOfDay: 'Dinner',
  dietaryFlags: ['vegan'],
  excludedCuisines: [],
  priceRange: '$$',
  preferredCuisine: null,
  surprise: false,
};

const partner: PartnerLite = { id: 'rest-1', name: 'Noodle House', cuisine: 'Chinese' };

const steps: DiscoverEvent[] = [
  { type: 'step', id: 'parse', label: 'Reading your vibe', constraints: [] },
  {
    type: 'step',
    id: 'filter',
    label: 'Looking through 2 local partners',
    detail: 'Active partners in the launch market',
    sample: [partner],
    total: 2,
  },
];

function pickEvent(): DiscoverEvent {
  return {
    type: 'pick',
    partner,
    reason: 'Hot noodles.',
    matched: ['Vegan'],
    unknown: [{ label: 'Spicy', note: "Can't confirm that from the partner listing" }],
    unmet: ['Date Night'],
    isNewToMember: false,
    food: 'dumpling',
  };
}

describe('discover screen reducer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps arrived steps in order and does not invent memory or rank', () => {
    const events = [...steps, pickEvent()];
    expect(thinkingSteps(events).map((step) => step.id)).toEqual(['parse', 'filter']);
    expect(encodeDiscoverSse(events)).not.toContain('"id":"memory"');
    expect(encodeDiscoverSse(events)).not.toContain('"id":"rank"');
  });

  it('dwells about 700ms on each step before the outcome', () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    let outcome = false;
    const cancel = scheduleDiscoverReveal({
      stepCount: 2,
      reducedMotion: false,
      onVisibleSteps: (count) => seen.push(count),
      onOutcome: () => {
        outcome = true;
      },
    });
    expect(seen).toEqual([1]);
    expect(outcome).toBe(false);
    vi.advanceTimersByTime(DISCOVER_STEP_DWELL_MS - 1);
    expect(seen).toEqual([1]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([1, 2]);
    expect(outcome).toBe(false);
    vi.advanceTimersByTime(DISCOVER_STEP_DWELL_MS);
    expect(outcome).toBe(true);
    cancel();
  });

  it('shows every arrived step at once when motion is reduced', () => {
    const seen: number[] = [];
    let outcome = false;
    scheduleDiscoverReveal({
      stepCount: 2,
      reducedMotion: true,
      onVisibleSteps: (count) => seen.push(count),
      onOutcome: () => {
        outcome = true;
      },
    });
    expect(seen).toEqual([2]);
    expect(outcome).toBe(true);
  });

  it('labels a fallback as an alternative and keeps a pick as a match', () => {
    const fallback: DiscoverEvent = {
      type: 'fallback',
      reason: 'no_match',
      message: 'Alternative: Noodle House. This is not a match for that request.',
      alternative: partner,
    };
    const alternative = outcomeFromEvents([...steps, fallback]);
    expect(alternative.kind).toBe('fallback');
    if (alternative.kind === 'fallback') {
      expect(alternative.event.message).toContain('not a match');
      expect(alternative.event.message).toContain('Alternative:');
    }
    expect(foodForOutcome(alternative)).toBe('generic');
    const match = outcomeFromEvents([...steps, pickEvent()]);
    expect(match.kind).toBe('pick');
    expect(foodForOutcome(match)).toBe('dumpling');
  });

  it('resubmits refine chips with the original message', () => {
    const another = refineDiscoverDraft(baseDraft, 'another');
    const cheaper = refineDiscoverDraft(baseDraft, 'cheaper');
    const vibe = refineDiscoverDraft(baseDraft, 'new-vibe');
    expect(draftToSpinBody(another)).toMatchObject({ message: 'spicy noodles', priceRange: '$$' });
    expect(draftToSpinBody(cheaper)).toMatchObject({ message: 'spicy noodles', priceRange: '$' });
    expect(cheaper.message).toBe(baseDraft.message);
    expect(draftToSpinBody(vibe).message).toBe('spicy noodles');
    expect(vibe.vibe).not.toBe(baseDraft.vibe);
    expect(cheaperPrice('$$$$')).toBe('$$$');
    expect(cheaperPrice(null)).toBe('$');
  });

  it('keeps a typed message when a quick chip is pressed', () => {
    const chip = applyQuickChip(baseDraft, { label: 'Comfort food', vibe: 'Comfort Food' });
    expect(chip.message).toBe('spicy noodles');
    expect(chip.vibe).toBe('Comfort Food');
    const surprise = applyQuickChip(baseDraft, { label: 'Surprise me', surprise: true });
    expect(surprise.message).toBe('spicy noodles');
    expect(draftToSpinBody(surprise).message).toBeUndefined();
  });

  it('maps HTTP failures to the existing copy', () => {
    expect(messageForDiscoverStatus(400, null)).toBe(DISCOVERY_MESSAGE_TOO_LONG_ERROR);
    expect(DISCOVER_MESSAGE_TOO_LONG).toBe(DISCOVERY_MESSAGE_TOO_LONG_ERROR);
    expect(messageForDiscoverStatus(400, 'Invalid request body.')).toBe('Invalid request body.');
    expect(messageForDiscoverStatus(404, 'No restaurants match those dietary filters yet. Try fewer options, or we may still be tagging partners — check back soon.')).toContain(
      'No restaurants match',
    );
    expect(messageForDiscoverStatus(422, null)).toBe(DISCOVERY_ALLERGY_ERROR);
    expect(messageForDiscoverStatus(429, null)).toBe(DISCOVER_RATE_LIMIT_MESSAGE);
    expect(messageForDiscoverStatus(503, 'No restaurants available right now.')).toBe(
      'No restaurants available right now.',
    );
    expect(dietaryButtonLabel(['vegan'])).toBe('Dietary: Vegan');
    expect(dietaryButtonLabel([])).toBe('Dietary: none set');
  });

  it('links directions from partner.directions and omits Closer', () => {
    expect(directionsHref(partner)).toBeNull();
    const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=Noodle%20House%20McKinney%20TX';
    expect(directionsHref({ ...partner, directions: { mapsUrl } })).toBe(mapsUrl);
    expect(directionsHref({ ...partner, directions: { address: '100 Main St' } })).toContain(
      'maps/search',
    );
    expect(directionsHref({ ...partner, directions: { address: '100 Main St' } })).toContain(
      'McKinney',
    );
    expect(directionsHref({ ...partner, directions: { mapsUrl: 'http://example.com' } })).toBeNull();
    expect(
      directionsHref({
        ...partner,
        directions: { mapsUrl: 'http://example.com', address: '100 Main St' },
      }),
    ).toContain('McKinney');
    expect(closerChipIncluded(partner)).toBe(false);
    expect(closerChipIncluded({ ...partner, lat: 33.2, lon: -96.6 } as PartnerLite)).toBe(false);
  });
});
