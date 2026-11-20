import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscoverPick } from '@/components/discover/discover-pick';
import { discoverMapsSearchUrl } from '@/lib/discover/directions';
import type { DiscoverEvent } from '@/lib/discover/events';
import { LAUNCH_MARKET } from '@/lib/launch-market';

const handlers = {
  onDietary: () => {},
  onAnother: () => {},
  onCheaper: () => {},
  onNewVibe: () => {},
  onFollowUp: () => {},
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
            message: "Closest I've got: Mystery. It may not match everything you asked for.",
            tone: 'alternative',
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
    expect(screen.getByText('Closest pick')).toBeTruthy();
    expect(screen.queryByText('An alternative')).toBeNull();
    expect(screen.queryByText('Not a match')).toBeNull();
  });

  it('reads a surprise fallback as a suggestion', () => {
    render(
      <DiscoverPick
        outcome={{
          kind: 'fallback',
          event: {
            type: 'fallback',
            reason: 'no_match',
            message: "Here's a surprise: Noodle House.",
            tone: 'surprise',
            alternative: { id: 'rest-1', name: 'Noodle House' },
          },
        }}
        food="generic"
        dietaryLabel="Dietary: none set"
        {...handlers}
      />,
    );
    expect(screen.getByText("Here's a surprise")).toBeTruthy();
    expect(screen.getByText("Here's a surprise: Noodle House.")).toBeTruthy();
    expect(screen.queryByText('Not a match')).toBeNull();
    expect(screen.queryByText(/not a match/i)).toBeNull();
    expect(screen.queryByText('An alternative')).toBeNull();
  });

  it('reads another idea as a suggestion', () => {
    render(
      <DiscoverPick
        outcome={{
          kind: 'fallback',
          event: {
            type: 'fallback',
            reason: 'provider_error',
            message: "The model wrote something else.",
            tone: 'another',
            alternative: { id: 'rest-1', name: 'Noodle House' },
          },
        }}
        food="generic"
        dietaryLabel="Dietary: none set"
        {...handlers}
      />,
    );
    expect(screen.getByText("Here's another idea")).toBeTruthy();
    expect(screen.getByText('The model wrote something else.')).toBeTruthy();
    expect(screen.queryByText('Closest pick')).toBeNull();
    expect(screen.queryByText('Not a match')).toBeNull();
    expect(screen.queryByText(/not a match/i)).toBeNull();
  });

  it('reads a closest-pick prefix when the stream omitted tone', () => {
    render(
      <DiscoverPick
        outcome={{
          kind: 'fallback',
          event: {
            type: 'fallback',
            reason: 'no_match',
            message: "Closest I've got: Noodle House. It may not match everything you asked for.",
            alternative: { id: 'rest-1', name: 'Noodle House' },
          },
        }}
        food="generic"
        dietaryLabel="Dietary: none set"
        {...handlers}
      />,
    );
    expect(screen.getByText('Closest pick')).toBeTruthy();
    expect(screen.queryByText('An alternative')).toBeNull();
    expect(screen.queryByText('Picked for you')).toBeNull();
  });

  it('sends a trimmed follow-up and ignores an empty or too-long one', () => {
    const onFollowUp = vi.fn();
    render(
      <DiscoverPick
        outcome={{
          kind: 'pick',
          event: pickEvent({ id: 'rest-1', name: 'Noodle House' }),
        }}
        food="dumpling"
        dietaryLabel="Dietary: none set"
        {...handlers}
        onFollowUp={onFollowUp}
      />,
    );
    const field = screen.getByLabelText('Tell Bea something else');
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(onFollowUp).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: 'a'.repeat(501) } });
    expect(screen.getByText('That message is too long. Keep it to 500 characters.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(onFollowUp).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '  something spicy instead  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(onFollowUp).toHaveBeenCalledTimes(1);
    expect(onFollowUp).toHaveBeenCalledWith('something spicy instead');

    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(onFollowUp).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(onFollowUp).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onFollowUp).toHaveBeenCalledTimes(2);
    expect(onFollowUp).toHaveBeenLastCalledWith('something spicy instead');
  });
});
