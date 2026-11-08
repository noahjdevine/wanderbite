import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscoverFlow } from '@/components/discover/discover-flow';
import {
  forgetDiscoverAutoStartMemory,
  resetDiscoverAutoStartClaims,
} from '@/lib/discover/auto-start';
import { encodeDiscoverSse, type DiscoverEvent } from '@/lib/discover/events';
import {
  DISCOVERY_ALLERGY_ERROR,
  DISCOVERY_MESSAGE_TOO_LONG_ERROR,
} from '@/lib/discovery-turn';
import type { RouletteDietaryFlag } from '@/lib/roulette-dietary';

vi.mock('next/image', () => ({
  default: function MockImage(props: { alt?: string; src?: unknown }) {
    const src = typeof props.src === 'string' ? props.src : '';
    // The mock stands in for next/image. The screen itself uses Image.
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={props.alt ?? ''} src={src} />;
  },
}));

const mapsUrl =
  'https://www.google.com/maps/search/?api=1&query=Noodle%20House%20McKinney%20TX';
const partner = {
  id: 'rest-1',
  name: 'Noodle House',
  cuisine: 'Chinese',
  neighborhood: 'McKinney',
  directions: { mapsUrl },
};

function stream(events: DiscoverEvent[]): DiscoverEvent[] {
  return events;
}

function guestEvents(): DiscoverEvent[] {
  return stream([
    {
      type: 'step',
      id: 'parse',
      label: 'Reading your vibe',
      constraints: [{ key: 'vibe', label: 'spicy noodles', required: false }],
    },
    {
      type: 'step',
      id: 'filter',
      label: 'Looking through 2 local partners',
      detail: 'Active partners in the launch market',
      sample: [partner],
      total: 2,
    },
    {
      type: 'pick',
      partner,
      reason: 'Hot noodles, close to the ask.',
      matched: ['Chinese'],
      unknown: [{ label: 'Spicy', note: "Can't confirm that from the partner listing" }],
      unmet: ['Quiet'],
      isNewToMember: false,
      food: 'dumpling',
    },
  ]);
}

function sse(events: DiscoverEvent[], status = 200): Response {
  return new Response(encodeDiscoverSse(events), {
    status,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function postedBodies(): {
  message?: string;
  priceRange?: string;
  vibe?: string;
  excludeRestaurantIds?: string[];
}[] {
  return vi
    .mocked(fetch)
    .mock.calls.map((call) => {
      const init = call[1] as RequestInit | undefined;
      return JSON.parse(String(init?.body ?? '{}')) as {
        message?: string;
        priceRange?: string;
        vibe?: string;
        excludeRestaurantIds?: string[];
      };
    });
}

const RUN = '11111111-1111-4111-8111-111111111111';
const NEXT_RUN = '22222222-2222-4222-8222-222222222222';

describe('DiscoverFlow', () => {
  beforeEach(() => {
    resetDiscoverAutoStartClaims();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse(guestEvents())),
    );
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function flush() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it('prefills the ask and does not submit it', async () => {
    render(
      <DiscoverFlow initialMessage="spicy noodles" viewer={{ firstName: null, savedDietary: [] }} />,
    );
    expect(screen.getByLabelText('Tell Bea what you are craving')).toHaveProperty('value', 'spicy noodles');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('replays parse then filter for at least 700ms, then shows the named pick', async () => {
    render(
      <DiscoverFlow initialMessage="spicy noodles" viewer={{ firstName: null, savedDietary: [] }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ask Bea' }));
    await flush();
    expect(screen.getByText('Reading your vibe')).toBeTruthy();
    expect(screen.queryByText('Looking through 2 local partners')).toBeNull();
    expect(screen.queryByText(/Remembering what you love/)).toBeNull();
    expect(screen.queryByText(/Down to two/)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(screen.getByText('Looking through 2 local partners')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Noodle House' })).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    const heading = screen.getByRole('heading', { name: 'Noodle House' });
    expect(heading).toBeTruthy();
    expect(document.activeElement).toBe(heading);
    expect(screen.getAllByText('Chinese').length).toBeGreaterThan(0);
    expect(screen.getByText(/Can't confirm that from the partner listing/)).toBeTruthy();
    expect(screen.getByText('Quiet')).toBeTruthy();
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe('/api/discover');
  });

  it('labels a fallback restaurant as an alternative', async () => {
    vi.mocked(fetch).mockResolvedValue(
      sse([
        { type: 'step', id: 'parse', label: 'Reading your vibe', constraints: [] },
        {
          type: 'fallback',
          reason: 'no_match',
          message: 'Alternative: Noodle House. This is not a match for that request.',
          alternative: partner,
        },
      ]),
    );
    render(<DiscoverFlow initialMessage="sushi" viewer={{ firstName: null, savedDietary: [] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask Bea' }));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(screen.getByText('An alternative')).toBeTruthy();
    expect(screen.getByText(/not a match/)).toBeTruthy();
    expect(screen.queryByText('Picked for you')).toBeNull();
  });

  it('shows a saved dietary setting on Ask and Pick', async () => {
    const saved: RouletteDietaryFlag[] = ['vegan'];
    vi.mocked(fetch).mockResolvedValue(
      sse([
        ...guestEvents().slice(0, 2),
        {
          type: 'pick',
          partner,
          reason: 'This one keeps the vegan filter.',
          matched: ['Vegan'],
          unknown: [],
          unmet: [],
          isNewToMember: false,
          food: 'dumpling',
        },
      ]),
    );
    render(
      <DiscoverFlow initialMessage="noodles" viewer={{ firstName: 'Noah', savedDietary: saved }} />,
    );
    expect(screen.getByRole('button', { name: 'Dietary: Vegan' })).toBeTruthy();
    expect(screen.getByText('Good evening, Noah')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask Bea' }));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400);
    });
    expect(screen.getByRole('button', { name: 'Dietary: Vegan' })).toBeTruthy();
    expect(screen.getByText('Vegan')).toBeTruthy();
  });

  it('resubmits Another idea and Cheaper with the original message', async () => {
    render(
      <DiscoverFlow initialMessage="spicy noodles" viewer={{ firstName: null, savedDietary: [] }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ask Bea' }));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400);
    });
    const link = screen.getByRole('link', { name: "Let's go" });
    expect(link.getAttribute('href')).toBe(mapsUrl);
    expect(link.getAttribute('target')).toBe('_blank');
    fireEvent.click(screen.getByRole('button', { name: 'Cheaper' }));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Another idea' }));
    await flush();
    const bodies = postedBodies();
    expect(bodies[0]?.message).toBe('spicy noodles');
    expect(bodies[0]?.excludeRestaurantIds).toBeUndefined();
    expect(bodies[1]?.message).toBe('spicy noodles');
    expect(bodies[1]?.priceRange).toBe('$');
    expect(bodies[1]?.excludeRestaurantIds).toBeUndefined();
    expect(bodies[2]?.message).toBe('spicy noodles');
    expect(bodies[2]?.priceRange).toBeUndefined();
    expect(bodies[2]?.excludeRestaurantIds).toEqual(['rest-1']);
  });

  it('shows arrived steps immediately when reduced motion is on', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    render(
      <DiscoverFlow initialMessage="spicy noodles" viewer={{ firstName: null, savedDietary: [] }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ask Bea' }));
    await flush();
    await flush();
    expect(screen.getByRole('heading', { name: 'Noodle House' })).toBeTruthy();
    expect(screen.getByText('Reading your vibe')).toBeTruthy();
  });

  it.each([
    [400, DISCOVERY_MESSAGE_TOO_LONG_ERROR],
    [404, 'No restaurants match those dietary filters yet. Try fewer options, or we may still be tagging partners — check back soon.'],
    [422, DISCOVERY_ALLERGY_ERROR],
    [429, 'Too many requests. Please wait a moment and try again.'],
    [503, 'No restaurants available right now.'],
  ])('shows status %s and returns to Ask', async (status, message) => {
    vi.mocked(fetch).mockResolvedValue(jsonError(status, message));
    render(<DiscoverFlow initialMessage="spicy noodles" viewer={{ firstName: null, savedDietary: [] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask Bea' }));
    await flush();
    expect(screen.getByText(message)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Ask' }));
    expect(screen.getByLabelText('Tell Bea what you are craving')).toHaveProperty('value', 'spicy noodles');
  });

  it('starts a homepage ask once and still accepts a manual submit', async () => {
    render(
      <DiscoverFlow
        initialMessage="tacos near downtown, Halal"
        autoStartToken={RUN}
        viewer={{ firstName: null, savedDietary: [] }}
      />,
    );
    expect(fetch).not.toHaveBeenCalled();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(postedBodies()[0]?.message).toBe('tacos near downtown, Halal');
    expect(postedBodies()[0]).not.toHaveProperty('dietaryQuick');
    expect(screen.getByText('“tacos near downtown, Halal”')).toBeTruthy();

    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.change(screen.getByLabelText('Tell Bea what you are craving'), {
      target: { value: 'tacos near downtown, Halal, extra spicy' },
    });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ask Bea' }));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(postedBodies()[1]?.message).toBe('tacos near downtown, Halal, extra spicy');
  });

  it('does not start twice under strict mode, refresh, or a repeated back visit', async () => {
    const { unmount } = render(
      <StrictMode>
        <DiscoverFlow
          initialMessage="spicy noodles"
          autoStartToken={RUN}
          viewer={{ firstName: null, savedDietary: [] }}
        />
      </StrictMode>,
    );
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    unmount();

    forgetDiscoverAutoStartMemory();
    vi.mocked(fetch).mockClear();
    const reloaded = render(
      <DiscoverFlow
        initialMessage="spicy noodles"
        autoStartToken={RUN}
        viewer={{ firstName: null, savedDietary: [] }}
      />,
    );
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    reloaded.unmount();

    vi.mocked(fetch).mockClear();
    render(
      <DiscoverFlow
        initialMessage="spicy noodles"
        autoStartToken={NEXT_RUN}
        viewer={{ firstName: null, savedDietary: [] }}
      />,
    );
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(postedBodies()[0]?.message).toBe('spicy noodles');
  });

  it('does not auto-start after the ask is edited', async () => {
    render(
      <DiscoverFlow
        initialMessage="spicy noodles"
        autoStartToken={RUN}
        viewer={{ firstName: null, savedDietary: [] }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Tell Bea what you are craving'), {
      target: { value: 'spicy noodles, keep it mild' },
    });
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ask Bea' }));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(postedBodies()[0]?.message).toBe('spicy noodles, keep it mild');
  });

  it('shows a broken stream and returns to Ask', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('data: {"type":\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    render(<DiscoverFlow initialMessage="spicy noodles" viewer={{ firstName: null, savedDietary: [] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask Bea' }));
    await flush();
    expect(screen.getByText(/suggestion stream stopped/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Ask' }));
    expect(screen.getByRole('heading', { name: /Where should we eat/ })).toBeTruthy();
  });
});
