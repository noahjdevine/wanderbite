import { describe, expect, it } from 'vitest';
import { eventsForDiscoverCard } from '@/lib/discover/card-events';
import {
  fallbackAlternativeMessage,
  fallbackBadgeLabel,
  fallbackPresentation,
  fallbackToneForAsk,
  MEMORY_STEP_LABEL,
  memoryStepLine,
  parseDiscoverAskTone,
  type DiscoverEvent,
} from '@/lib/discover/events';
import type { DiscoverRestaurant } from '@/lib/discover/stages';

function restaurant(name = 'Green Table', tags: string[] = ['vegan', 'noodles', 'sushi']): DiscoverRestaurant {
  return {
    id: 'rest-vegan',
    name,
    cuisine_tags: tags,
    neighborhood: 'Downtown',
    address: '1 Main',
    price_range: '$$',
    image_url: null,
    google_place_id: null,
    is_dairy_free: true,
    is_vegan: true,
    is_halal: false,
  };
}

function fallbackMessage(events: DiscoverEvent[]): string {
  const event = events.find((item) => item.type === 'fallback');
  if (!event || event.type !== 'fallback') throw new Error('expected a fallback');
  return event.message;
}

const chosen = restaurant();

describe('fallback copy', () => {
  it('rejects an unknown ask tone', () => {
    expect(parseDiscoverAskTone('surprise')).toBe('surprise');
    expect(parseDiscoverAskTone('another')).toBe('another');
    expect(parseDiscoverAskTone('request')).toBe('request');
    expect(parseDiscoverAskTone('match')).toBeNull();
    expect(parseDiscoverAskTone(true)).toBeNull();
  });

  it('treats surprise and another idea as suggestions', () => {
    expect(fallbackAlternativeMessage('Green Table', 'surprise')).toBe("Here's a surprise: Green Table.");
    expect(fallbackAlternativeMessage('Green Table', 'another')).toBe("Here's another idea: Green Table.");
    expect(fallbackAlternativeMessage('Green Table', 'surprise').toLowerCase()).not.toContain('not a match');
    expect(fallbackAlternativeMessage('Green Table', 'another').toLowerCase()).not.toContain('not a match');
    expect(fallbackToneForAsk({ askTone: 'surprise', message: 'ignored' })).toBe('surprise');
    expect(
      fallbackToneForAsk({
        askTone: 'another',
        message: 'quiet sushi',
        preferredCuisine: 'japanese',
      }),
    ).toBe('another');
    expect(fallbackToneForAsk({ askTone: null, message: '' })).toBe('surprise');
  });

  it('keeps a constrained fallback as a closest pick', () => {
    const message = fallbackAlternativeMessage('Green Table', 'alternative');
    expect(message).toBe(
      "Closest I've got: Green Table. It may not match everything you asked for.",
    );
    expect(fallbackAlternativeMessage('  ', 'alternative')).toBe(
      "Closest I've got. It may not match everything you asked for.",
    );
    expect(message.toLowerCase()).not.toContain('not a match');
    expect(message.toLowerCase()).not.toContain('perfect match');
    expect(message.toLowerCase()).not.toContain('matched');
    expect(fallbackPresentation(message)).toBe('alternative');
    expect(fallbackPresentation('Alternative: Green Table. This is a different pick from that request.')).toBe(
      'alternative',
    );
    expect(fallbackPresentation("Here's a surprise: Green Table.")).toBe('surprise');
    expect(fallbackPresentation("Here's another idea: Green Table.")).toBe('another');
    expect(fallbackBadgeLabel('alternative')).toBe('Closest pick');
    expect(fallbackBadgeLabel('surprise')).toBe("Here's a surprise");
    expect(fallbackBadgeLabel('another')).toBe("Here's another idea");
    expect(fallbackToneForAsk({ askTone: 'request', message: 'quiet sushi', vibe: 'Date Night' })).toBe(
      'alternative',
    );
    expect(
      fallbackToneForAsk({
        askTone: null,
        message: 'quiet sushi',
        preferredCuisine: 'japanese',
      }),
    ).toBe('alternative');
  });
});

describe('eventsForDiscoverCard copy', () => {
  it('writes surprise copy when the turn has nothing to match', () => {
    const events = eventsForDiscoverCard({
      message: '',
      dietary: ['vegan'],
      excludedCuisineIds: ['thai'],
      restaurants: [chosen],
      chosen,
      reason: 'Green Table is a partner.',
      selectionMode: 'random_fallback',
      fallbackReason: 'ai_disabled',
      providerTimedOut: false,
      askTone: 'surprise',
    });
    const surprise = events.find((event) => event.type === 'pick');
    expect(surprise).toMatchObject({
      type: 'pick',
      badge: 'Surprise',
      reason: "Bea's wild card: Green Table. Trust me on this one.",
    });
    expect(events.some((event) => event.type === 'fallback')).toBe(false);
    expect(JSON.stringify(events)).not.toContain("Closest I've got");
    expect(JSON.stringify(events).toLowerCase()).not.toContain('not a match');
    const parse = events.find((event) => event.type === 'step' && event.id === 'parse');
    expect(parse && parse.type === 'step' && parse.id === 'parse' ? parse.constraints : []).toEqual([
      expect.objectContaining({ key: 'dietary', label: 'Vegan', required: true }),
    ]);
  });

  it('writes another-idea copy even when the draft still has a request', () => {
    const events = eventsForDiscoverCard({
      message: 'quiet sushi',
      dietary: ['vegan'],
      excludedCuisineIds: [],
      vibe: 'Date Night',
      preferredCuisine: 'japanese',
      restaurants: [chosen],
      chosen,
      reason: 'Green Table is a partner.',
      selectionMode: 'random_fallback',
      fallbackReason: 'rate_limited',
      providerTimedOut: false,
      askTone: 'another',
    });
    const another = events.find((event) => event.type === 'pick');
    expect(another).toMatchObject({
      type: 'pick',
      badge: "Here's another idea",
      reason: "Here's another idea: Green Table.",
    });
    expect(events.some((event) => event.type === 'fallback')).toBe(false);
    expect(JSON.stringify(events).toLowerCase()).not.toContain('not a match');
    expect(JSON.stringify(events)).not.toContain('different pick');
  });

  it('writes alternative copy for a constrained request', () => {
    const events = eventsForDiscoverCard({
      message: 'quiet sushi',
      dietary: ['vegan'],
      excludedCuisineIds: ['thai'],
      preferredCuisine: 'japanese',
      restaurants: [chosen],
      chosen: restaurant('Green Table', ['vegan', 'noodles']),
      reason: 'Green Table is a partner.',
      selectionMode: 'random_fallback',
      fallbackReason: 'budget_exceeded',
      providerTimedOut: false,
      askTone: 'request',
    });
    expect(fallbackMessage(events)).toBe(
      "Closest I've got: Green Table. I couldn't match sushi with vegan.",
    );
    expect(fallbackMessage(events)).toContain("Closest I've got: Green Table.");
    expect(fallbackMessage(events).toLowerCase()).not.toContain('not a match');
    expect(fallbackMessage(events).toLowerCase()).not.toContain('matched');
    expect(events.find((event) => event.type === 'fallback')).toMatchObject({ tone: 'alternative' });
    const filter = events.find((event) => event.type === 'step' && event.id === 'filter');
    expect(filter && filter.type === 'step' && filter.id === 'filter' ? filter.detail : '').toContain(
      'Vegan',
    );
    expect(filter && filter.type === 'step' && filter.id === 'filter' ? filter.detail : '').toContain(
      'Thai',
    );
  });

  it('leaves an AI pick on the match path', () => {
    const events = eventsForDiscoverCard({
      message: 'quiet sushi',
      dietary: ['vegan'],
      excludedCuisineIds: [],
      preferredCuisine: 'japanese',
      restaurants: [chosen],
      chosen,
      reason: 'Green Table is a partner.',
      selectionMode: 'ai',
      fallbackReason: null,
      providerTimedOut: false,
      askTone: 'request',
    });
    const pick = events.find((event) => event.type === 'pick');
    expect(pick).toMatchObject({
      type: 'pick',
      reason: 'Green Table is a partner.',
      partner: { id: 'rest-vegan', name: 'Green Table' },
    });
    expect(events.some((event) => event.type === 'fallback')).toBe(false);
    expect(JSON.stringify(events)).not.toContain("Here's a surprise");
    expect(JSON.stringify(events)).not.toContain('not a match');
    expect(pick && pick.type === 'pick' ? pick.isNewToMember : true).toBe(false);
    expect(events.some((event) => event.type === 'step' && event.id === 'memory')).toBe(false);
    expect(events.some((event) => event.type === 'step' && event.id === 'rank')).toBe(false);
  });

  it('attaches card facts on a pick and a fallback without changing the reason or tone', () => {
    const facts = [
      {
        field: 'known_for' as const,
        label: 'Known for',
        text: 'Known for brisket.',
        sourceUrl: 'https://maps.google.com/x',
        lastVerifiedAt: '2026-11-05T06:00:00.000Z',
      },
      {
        field: 'vibe' as const,
        label: 'Vibe',
        text: 'The room is cozy.',
        sourceUrl: 'https://example.com/vibe',
        lastVerifiedAt: '2026-11-05T06:00:00.000Z',
      },
    ];
    const picked = eventsForDiscoverCard({
      message: 'quiet sushi',
      dietary: ['vegan'],
      excludedCuisineIds: [],
      restaurants: [chosen],
      chosen,
      reason: 'Green Table is a partner.',
      selectionMode: 'ai',
      fallbackReason: null,
      providerTimedOut: false,
      askTone: 'request',
      facts,
    });
    const pick = picked.find((event) => event.type === 'pick');
    expect(pick).toMatchObject({
      type: 'pick',
      reason: 'Green Table is a partner.',
      isNewToMember: false,
      facts,
    });
    if (pick?.type === 'pick') {
      const chips = JSON.stringify({
        matched: pick.matched,
        unknown: pick.unknown,
        unmet: pick.unmet,
      });
      expect(chips).not.toContain('brisket');
      expect(chips).not.toContain('cozy');
    }
    expect(picked.some((event) => event.type === 'step' && event.id === 'memory')).toBe(false);

    const unmatched = restaurant('Green Table', ['bbq']);
    const fallback = eventsForDiscoverCard({
      message: 'quiet sushi',
      dietary: [],
      excludedCuisineIds: [],
      restaurants: [unmatched],
      chosen: unmatched,
      reason: 'Green Table is a partner.',
      selectionMode: 'random_fallback',
      fallbackReason: 'invalid_pick',
      providerTimedOut: false,
      askTone: 'request',
      facts,
    });
    const card = fallback.find((event) => event.type === 'fallback');
    expect(card).toMatchObject({
      type: 'fallback',
      tone: 'alternative',
      facts,
    });
    expect(card && card.type === 'fallback' ? card.message : '').toContain("Closest I've got: Green Table.");
    expect(card && card.type === 'fallback' ? card.message : '').not.toContain('brisket');
    expect(fallback.some((event) => event.type === 'step' && event.id === 'memory')).toBe(false);
  });

  it('omits the facts key when the restaurant has none', () => {
    const events = eventsForDiscoverCard({
      message: '',
      dietary: [],
      excludedCuisineIds: [],
      restaurants: [chosen],
      chosen,
      reason: 'Green Table is a partner.',
      selectionMode: 'ai',
      fallbackReason: null,
      providerTimedOut: false,
      facts: [],
    });
    const pick = events.find((event) => event.type === 'pick');
    expect(pick && pick.type === 'pick' ? Object.hasOwn(pick, 'facts') : true).toBe(false);
    const surprise = eventsForDiscoverCard({
      message: '',
      dietary: [],
      excludedCuisineIds: [],
      restaurants: [chosen],
      chosen,
      reason: 'Green Table is a partner.',
      selectionMode: 'random_fallback',
      fallbackReason: 'ai_disabled',
      providerTimedOut: false,
      askTone: 'surprise',
    });
    const surprisePick = surprise.find((event) => event.type === 'pick');
    expect(surprisePick).toMatchObject({
      badge: 'Surprise',
      reason: "Bea's wild card: Green Table. Trust me on this one.",
    });
    expect(surprisePick && surprisePick.type === 'pick' ? Object.hasOwn(surprisePick, 'facts') : true).toBe(false);
    expect(surprise.some((event) => event.type === 'fallback')).toBe(false);
  });

  it('emits a memory step and isNewToMember without dropping tone or facts', () => {
    const facts = [
      {
        field: 'known_for' as const,
        label: 'Known for',
        text: 'Known for brisket.',
        sourceUrl: 'https://maps.google.com/x',
        lastVerifiedAt: '2026-11-05T06:00:00.000Z',
      },
    ];
    const fresh = eventsForDiscoverCard({
      message: 'quiet sushi',
      dietary: ['vegan'],
      excludedCuisineIds: [],
      restaurants: [chosen],
      chosen,
      reason: 'Green Table is a partner.',
      selectionMode: 'ai',
      fallbackReason: null,
      providerTimedOut: false,
      askTone: 'request',
      facts,
      visitedRestaurantIds: new Set(),
    });
    expect(fresh.map((event) => (event.type === 'step' ? event.id : event.type))).toEqual([
      'parse',
      'filter',
      'memory',
      'pick',
    ]);
    expect(fresh.find((event) => event.type === 'step' && event.id === 'memory')).toEqual({
      type: 'step',
      id: 'memory',
      label: MEMORY_STEP_LABEL,
      line: memoryStepLine('Green Table', true),
    });
    expect(fresh.find((event) => event.type === 'pick')).toMatchObject({
      isNewToMember: true,
      reason: 'Green Table is a partner.',
      facts,
    });

    const visited = eventsForDiscoverCard({
      message: 'quiet sushi',
      dietary: [],
      excludedCuisineIds: [],
      restaurants: [chosen],
      chosen,
      reason: 'Green Table is a partner.',
      selectionMode: 'random_fallback',
      fallbackReason: 'invalid_pick',
      providerTimedOut: false,
      askTone: 'another',
      facts,
      visitedRestaurantIds: new Set([chosen.id]),
    });
    expect(visited.find((event) => event.type === 'step' && event.id === 'memory')).toMatchObject({
      line: "You've been here before.",
    });
    expect(visited.find((event) => event.type === 'pick')).toMatchObject({
      badge: "Here's another idea",
      isNewToMember: false,
      facts,
      reason: "Here's another idea: Green Table.",
    });
    expect(visited.some((event) => event.type === 'step' && event.id === 'rank')).toBe(false);
  });
});
