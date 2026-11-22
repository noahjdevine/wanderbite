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

  it('shows two researched notes with a source and a Chicago checked date', () => {
    render(
      <DiscoverPick
        outcome={{
          kind: 'pick',
          event: {
            ...pickEvent({ id: 'rest-1', name: 'Noodle House' }),
            facts: [
              {
                field: 'good_for',
                label: 'Good for',
                text: 'Birthdays.',
                sourceUrl: 'https://example.com/good-for',
                lastVerifiedAt: '2026-11-05T06:00:00.000Z',
              },
              {
                field: 'vibe',
                label: 'Vibe',
                text: 'The room is cozy and candlelit.',
                sourceUrl: 'https://example.com/vibe',
                lastVerifiedAt: '2026-11-05T06:00:00.000Z',
              },
              {
                field: 'known_for',
                label: 'Known for',
                text: 'Hand-pulled noodles.',
                sourceUrl: 'https://maps.google.com/maps/place/noodle',
                lastVerifiedAt: '2026-11-05T06:00:00.000Z',
              },
            ],
          },
        }}
        food="dumpling"
        dietaryLabel="Dietary: none set"
        {...handlers}
      />,
    );
    expect(
      screen.getByText(
        (_, node) => node?.tagName === 'P' && node.textContent === 'Known for Hand-pulled noodles.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        (_, node) =>
          node?.tagName === 'P' && node.textContent === 'Vibe The room is cozy and candlelit.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Birthdays.')).toBeNull();
    expect(screen.queryByText('Sample')).toBeNull();
    expect(screen.queryByText('First visit')).toBeNull();
    expect(screen.getAllByText('Checked Nov 5, 2026')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: /Google Maps|Source/ })).toBeNull();
    expect(screen.queryByText('Google Maps')).toBeNull();
    expect(screen.queryByText(/Source:/)).toBeNull();
    expect(screen.getByText('“Hot noodles.”')).toBeTruthy();
  });

  it('leaves the card unchanged when the restaurant has no notes', () => {
    render(
      <DiscoverPick
        outcome={{
          kind: 'pick',
          event: pickEvent({ id: 'rest-1', name: 'Noodle House' }),
        }}
        food="dumpling"
        dietaryLabel="Dietary: none set"
        {...handlers}
      />,
    );
    expect(screen.queryByText(/^Checked /)).toBeNull();
    expect(screen.queryByRole('link', { name: /^Google Maps/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Source/ })).toBeNull();
    expect(screen.queryByText('Sample')).toBeNull();
    expect(screen.queryByText('First visit')).toBeNull();
    expect(screen.getByText('Picked for you')).toBeTruthy();
    expect(screen.getByText('“Hot noodles.”')).toBeTruthy();
  });

  it('keeps a closest pick honest while showing its notes', () => {
    render(
      <DiscoverPick
        outcome={{
          kind: 'fallback',
          event: {
            type: 'fallback',
            reason: 'no_match',
            message: "Closest I've got: Noodle House. It may not match everything you asked for.",
            tone: 'alternative',
            alternative: { id: 'rest-1', name: 'Noodle House' },
            facts: [
              {
                field: 'known_for',
                label: 'Known for',
                text: 'Hand-pulled noodles.',
                sourceUrl: 'https://example.com/known',
                lastVerifiedAt: '2026-11-05T05:30:00.000Z',
              },
            ],
          },
        }}
        food="generic"
        dietaryLabel="Dietary: none set"
        {...handlers}
      />,
    );
    expect(screen.getByText('Closest pick')).toBeTruthy();
    expect(
      screen.getByText("Closest I've got: Noodle House. It may not match everything you asked for."),
    ).toBeTruthy();
    expect(
      screen.getByText(
        (_, node) => node?.tagName === 'P' && node.textContent === 'Known for Hand-pulled noodles.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Source/ })).toBeNull();
    expect(screen.queryByText(/Source:/)).toBeNull();
    expect(screen.getByText('Checked Nov 4, 2026')).toBeTruthy();
    expect(screen.queryByText('Sample')).toBeNull();
    expect(screen.queryByText('First visit')).toBeNull();
    expect(screen.queryByText('Picked for you')).toBeNull();
    expect(screen.queryByText('An alternative')).toBeNull();
    expect(screen.queryByText(/not a match/i)).toBeNull();
  });

  it('shows one about paragraph and hides labeled notes and sources', () => {
    render(
      <DiscoverPick
        outcome={{
          kind: 'pick',
          event: {
            ...pickEvent({ id: 'rest-1', name: 'Noodle House' }),
            facts: [
              {
                field: 'about',
                label: '',
                text: 'A lively room with hand-pulled noodles. Order the chili oil. Tip: sit by the window.',
                sourceUrl: 'https://example.com/about',
                lastVerifiedAt: '2026-11-05T06:00:00.000Z',
              },
              {
                field: 'known_for',
                label: 'Known for',
                text: 'Hand-pulled noodles.',
                sourceUrl: 'https://maps.google.com/maps/place/noodle',
                lastVerifiedAt: '2026-11-05T06:00:00.000Z',
              },
            ],
          },
        }}
        food="dumpling"
        dietaryLabel="Dietary: none set"
        {...handlers}
      />,
    );
    expect(
      screen.getByText(
        'A lively room with hand-pulled noodles. Order the chili oil. Tip: sit by the window.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Known for')).toBeNull();
    expect(screen.queryByText(/^Checked /)).toBeNull();
    expect(screen.queryByText('About')).toBeNull();
    expect(screen.queryByRole('link', { name: /Google Maps|Source/ })).toBeNull();
    expect(screen.queryByText(/Source:/)).toBeNull();
    expect(screen.queryByText('example.com')).toBeNull();
  });

  it('shows an about paragraph through 600 characters and hides 601', () => {
    const paragraph = 'A'.repeat(475);
    render(
      <DiscoverPick
        outcome={{
          kind: 'pick',
          event: {
            ...pickEvent({ id: 'rest-1', name: 'Noodle House' }),
            facts: [
              {
                field: 'about',
                label: '',
                text: paragraph,
                sourceUrl: 'https://example.com/about',
                lastVerifiedAt: '2026-11-05T06:00:00.000Z',
              },
              {
                field: 'known_for',
                label: 'Known for',
                text: 'K'.repeat(401),
                sourceUrl: 'https://example.com/known',
                lastVerifiedAt: '2026-11-05T06:00:00.000Z',
              },
            ],
          },
        }}
        food="dumpling"
        dietaryLabel="Dietary: none set"
        {...handlers}
      />,
    );
    expect(screen.getByText(paragraph)).toBeTruthy();
    expect(screen.queryByText('Known for')).toBeNull();
    expect(screen.queryByText('K'.repeat(401))).toBeNull();
    cleanup();

    render(
      <DiscoverPick
        outcome={{
          kind: 'pick',
          event: {
            ...pickEvent({ id: 'rest-2', name: 'Noodle House' }),
            facts: [
              {
                field: 'about',
                label: '',
                text: 'B'.repeat(601),
                sourceUrl: 'https://example.com/about',
                lastVerifiedAt: '2026-11-05T06:00:00.000Z',
              },
              {
                field: 'good_for',
                label: 'Good for',
                text: 'G'.repeat(401),
                sourceUrl: 'https://example.com/good',
                lastVerifiedAt: '2026-11-05T06:00:00.000Z',
              },
            ],
          },
        }}
        food="dumpling"
        dietaryLabel="Dietary: none set"
        {...handlers}
      />,
    );
    expect(screen.queryByText('B'.repeat(601))).toBeNull();
    expect(screen.queryByText('Good for')).toBeNull();
    expect(screen.queryByText('G'.repeat(401))).toBeNull();
  });

  it('shows a New to you chip with researched notes', () => {
    render(
      <DiscoverPick
        outcome={{
          kind: 'pick',
          event: {
            ...pickEvent({ id: 'rest-1', name: 'Noodle House', cuisine: 'Noodles' }),
            isNewToMember: true,
            facts: [
              {
                field: 'known_for',
                label: 'Known for',
                text: 'Hand-pulled noodles.',
                sourceUrl: 'https://example.com/known',
                lastVerifiedAt: '2026-11-05T06:00:00.000Z',
              },
            ],
          },
        }}
        food="dumpling"
        dietaryLabel="Dietary: none set"
        steps={[
          { type: 'step', id: 'memory', label: 'From your visits', line: "You haven't been to Noodle House yet." },
        ]}
        {...handlers}
      />,
    );
    expect(screen.getByText('New to you')).toBeTruthy();
    expect(screen.getByText("You haven't been to Noodle House yet.")).toBeTruthy();
    expect(screen.queryByText('New to your Passport')).toBeNull();
    expect(
      screen.getByText(
        (_, node) => node?.tagName === 'P' && node.textContent === 'Known for Hand-pulled noodles.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Checked Nov 5, 2026')).toBeTruthy();
    expect(screen.getByText('Picked for you')).toBeTruthy();
  });

  it('shows the chip without notes and hides it after a verified visit', () => {
    const { rerender } = render(
      <DiscoverPick
        outcome={{
          kind: 'pick',
          event: { ...pickEvent({ id: 'rest-1', name: 'Noodle House' }), isNewToMember: true },
        }}
        food="dumpling"
        dietaryLabel="Dietary: none set"
        {...handlers}
      />,
    );
    expect(screen.getByText('New to you')).toBeTruthy();
    expect(screen.queryByText(/^Checked /)).toBeNull();

    rerender(
      <DiscoverPick
        outcome={{
          kind: 'pick',
          event: pickEvent({ id: 'rest-1', name: 'Noodle House' }),
        }}
        food="dumpling"
        dietaryLabel="Dietary: none set"
        steps={[
          { type: 'step', id: 'memory', label: 'From your visits', line: "You've been here before." },
        ]}
        {...handlers}
      />,
    );
    expect(screen.queryByText('New to you')).toBeNull();
    expect(screen.getByText("You've been here before.")).toBeTruthy();
    expect(screen.getByText('Picked for you')).toBeTruthy();
  });

  it('keeps the Closest pick badge when a fallback is new to the member', () => {
    render(
      <DiscoverPick
        outcome={{
          kind: 'fallback',
          event: {
            type: 'fallback',
            reason: 'no_match',
            message: "Closest I've got: Noodle House. It may not match everything you asked for.",
            tone: 'alternative',
            alternative: { id: 'rest-1', name: 'Noodle House' },
            isNewToMember: true,
          },
        }}
        food="generic"
        dietaryLabel="Dietary: none set"
        {...handlers}
      />,
    );
    expect(screen.getByText('Closest pick')).toBeTruthy();
    expect(screen.getByText('New to you')).toBeTruthy();
    expect(screen.queryByText('Picked for you')).toBeNull();
    expect(screen.queryByText(/not a match/i)).toBeNull();
  });

  it('keeps the memory line on a closest pick', () => {
    render(
      <DiscoverPick
        outcome={{
          kind: 'fallback',
          event: {
            type: 'fallback',
            reason: 'no_match',
            message: "Closest I've got: The Common Table. It may not match everything you asked for.",
            tone: 'alternative',
            alternative: { id: 'common', name: 'The Common Table' },
            isNewToMember: true,
          },
        }}
        food="generic"
        dietaryLabel="Dietary: none set"
        steps={[
          {
            type: 'step',
            id: 'memory',
            label: 'From your visits',
            line: "You haven't been to The Common Table yet.",
          },
        ]}
        {...handlers}
      />,
    );
    expect(screen.getByText('Closest pick')).toBeTruthy();
    expect(screen.getByText('New to you')).toBeTruthy();
    expect(screen.getByText("You haven't been to The Common Table yet.")).toBeTruthy();
  });

  it('renders no subtitle when cuisine and neighborhood are blank', () => {
    render(
      <DiscoverPick
        outcome={{
          kind: 'fallback',
          event: {
            type: 'fallback',
            reason: 'no_match',
            message: "Here's another idea: The Common Table.",
            tone: 'another',
            alternative: {
              id: 'common',
              name: 'The Common Table',
              cuisine: '   ',
              neighborhood: '',
            },
          },
        }}
        food="generic"
        dietaryLabel="Dietary: none set"
        {...handlers}
      />,
    );
    expect(screen.getByRole('heading', { name: 'The Common Table' })).toBeTruthy();
    expect(screen.getByText("Here's another idea: The Common Table.")).toBeTruthy();
    expect(document.querySelector('[data-discover-subtitle]')).toBeNull();
  });

  it('shows a neighborhood subtitle without a dangling separator', () => {
    render(
      <DiscoverPick
        outcome={{
          kind: 'fallback',
          event: {
            type: 'fallback',
            reason: 'no_match',
            message: "Here's another idea: The Common Table.",
            tone: 'another',
            alternative: { id: 'common', name: 'The Common Table', neighborhood: ' Historic ' },
          },
        }}
        food="generic"
        dietaryLabel="Dietary: none set"
        {...handlers}
      />,
    );
    expect(document.querySelector('[data-discover-subtitle]')?.textContent).toBe('Historic');
  });
});
