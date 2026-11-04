import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DiscoverPick } from '@/components/discover/discover-pick';
import { discoverMapsSearchUrl } from '@/lib/discover/directions';
import type { DiscoverEvent } from '@/lib/discover/events';
import { LAUNCH_MARKET } from '@/lib/launch-market';

const handlers = {
  onDietary: () => {},
  onAnother: () => {},
  onCheaper: () => {},
  onNewVibe: () => {},
};

function pickEvent(
  partner: Extract<DiscoverEvent, { type: 'pick' }>['partner'],
): Extract<DiscoverEvent, { type: 'pick' }> {
  return {
    type: 'pick',
    partner,
    reason: 'Hot noodles.',
    matched: [],
    unknown: [],
    unmet: [],
    isNewToMember: false,
    food: 'dumpling',
  };
}

describe('DiscoverPick directions', () => {
  afterEach(() => {
    cleanup();
  });

  it('opens Google Maps in a new tab from the streamed directions URL', () => {
    const mapsUrl = discoverMapsSearchUrl('Noodle House', LAUNCH_MARKET.cityQuery);
    render(
      <DiscoverPick
        outcome={{
          kind: 'pick',
          event: pickEvent({
            id: 'rest-1',
            name: 'Noodle House',
            directions: { mapsUrl: mapsUrl ?? undefined },
          }),
        }}
        food="dumpling"
        dietaryLabel="Dietary: none set"
        {...handlers}
      />,
    );
    const link = screen.getByRole('link', { name: "Let's go" });
    expect(link.getAttribute('href')).toBe(mapsUrl);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.queryByText(/no address/i)).toBeNull();
  });

  it('keeps the no-address note when the card has neither an address nor a maps URL', () => {
    render(
      <DiscoverPick
        outcome={{
          kind: 'fallback',
          event: {
            type: 'fallback',
            reason: 'no_match',
            message: 'Alternative: Mystery. This is not a match for that request.',
            alternative: { id: 'rest-2', name: '' },
          },
        }}
        food="generic"
        dietaryLabel="Dietary: none set"
        {...handlers}
      />,
    );
    expect(screen.queryByRole('link', { name: "Let's go" })).toBeNull();
    expect(screen.getByRole('button', { name: "Let's go" })).toBeTruthy();
    expect(screen.getByText('This card has no address, so directions stay closed.')).toBeTruthy();
  });
});
