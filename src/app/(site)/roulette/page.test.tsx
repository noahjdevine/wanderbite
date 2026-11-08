import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: function MockImage(props: { alt?: string; src?: unknown }) {
    const src = typeof props.src === 'string' ? props.src : '';
    // The mock stands in for next/image. The screen itself uses Image.
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={props.alt ?? ''} src={src} />;
  },
}));

const loadDiscoverViewer = vi.fn(async () => ({ firstName: null, savedDietary: [] as const }));
const getUser = vi.hoisted(() =>
  vi.fn(async (): Promise<{ data: { user: { id: string } | null } }> => ({
    data: { user: null },
  })),
);
const maybeSingle = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{
      data: { subscription_status: string | null } | null;
      error: null;
    }> => ({ data: null, error: null }),
  ),
);
const eq = vi.hoisted(() => vi.fn(() => ({ maybeSingle })));
const select = vi.hoisted(() => vi.fn(() => ({ eq })));
const from = vi.hoisted(() => vi.fn(() => ({ select })));

vi.mock('@/app/actions/bite-notes', () => ({
  getPublicReviews: vi.fn(async () => ({ ok: true, data: [] })),
}));

vi.mock('@/lib/discover/viewer', () => ({
  loadDiscoverViewer: () => loadDiscoverViewer(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from,
  }),
}));

import RoulettePage from '@/app/(site)/roulette/page';
import { resetDiscoverAutoStartClaims } from '@/lib/discover/auto-start';
import { encodeDiscoverSse, type DiscoverEvent } from '@/lib/discover/events';

const HOME_RUN = '44444444-4444-4444-8444-444444444444';

describe('roulette page flag switch', () => {
  beforeEach(() => {
    resetDiscoverAutoStartClaims();
    loadDiscoverViewer.mockClear();
    getUser.mockClear();
    from.mockClear();
    select.mockClear();
    eq.mockClear();
    maybeSingle.mockClear();
    getUser.mockResolvedValue({ data: { user: null } });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    vi.stubEnv('DISCOVER_STREAM_ENABLED', '');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('keeps the current page when the flag is unset', async () => {
    const ui = await RoulettePage({ searchParams: Promise.resolve({ q: 'spicy noodles' }) });
    render(ui);
    expect(screen.getByRole('heading', { name: 'Not sure where to eat tonight?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Find a spot' })).toBeTruthy();
    expect(screen.getByText('Discovery cannot assess allergies. Ask the restaurant.')).toBeTruthy();
    expect(screen.getByLabelText('What are you in the mood for?')).toHaveProperty('value', 'spicy noodles');
    expect(screen.queryByRole('heading', { name: /Where should we eat/ })).toBeNull();
    expect(loadDiscoverViewer).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('treats TRUE as off', async () => {
    vi.stubEnv('DISCOVER_STREAM_ENABLED', 'TRUE');
    const ui = await RoulettePage({ searchParams: Promise.resolve({}) });
    render(ui);
    expect(screen.getByRole('heading', { name: 'Not sure where to eat tonight?' })).toBeTruthy();
    expect(loadDiscoverViewer).not.toHaveBeenCalled();
  });

  it('renders the new ask screen only when the flag is exactly true', async () => {
    vi.stubEnv('DISCOVER_STREAM_ENABLED', 'true');
    const ui = await RoulettePage({ searchParams: Promise.resolve({ q: 'spicy noodles' }) });
    render(ui);
    expect(screen.getByRole('heading', { name: /Where should we eat/ })).toBeTruthy();
    expect(screen.getByLabelText('Tell Bea what you are craving')).toHaveProperty('value', 'spicy noodles');
    expect(screen.queryByRole('heading', { name: 'Not sure where to eat tonight?' })).toBeNull();
    expect(loadDiscoverViewer).toHaveBeenCalledOnce();
    expect(getUser).not.toHaveBeenCalled();
    const clientFiles = [
      'src/components/discover/discover-flow.tsx',
      'src/components/discover/discover-ask.tsx',
      'src/components/discover/discover-thinking.tsx',
      'src/components/discover/discover-pick.tsx',
      'src/lib/discover/client.ts',
    ];
    for (const file of clientFiles) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source).not.toContain('DISCOVER_STREAM_ENABLED');
    }
  });

  it('auto-starts once when the homepage hands over a run token', async () => {
    vi.stubEnv('DISCOVER_STREAM_ENABLED', 'true');
    const events: DiscoverEvent[] = [
      {
        type: 'step',
        id: 'parse',
        label: 'Reading your vibe',
        constraints: [{ key: 'vibe', label: 'spicy noodles', required: false }],
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(encodeDiscoverSse(events), {
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      })),
    );
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const ui = await RoulettePage({
      searchParams: Promise.resolve({ q: 'spicy noodles', run: HOME_RUN }),
    });
    render(ui);
    expect(await screen.findByText('Reading your vibe')).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body));
    expect(body.message).toBe('spicy noodles');

    cleanup();
    vi.mocked(fetch).mockClear();
    const again = await RoulettePage({
      searchParams: Promise.resolve({ q: 'spicy noodles', run: HOME_RUN }),
    });
    render(again);
    expect(screen.getByLabelText('Tell Bea what you are craving')).toHaveProperty('value', 'spicy noodles');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'inactive', visible: true },
    { status: null, visible: true },
    { status: 'active', visible: false },
  ])('uses subscription_status $status for the join upsell', async ({ status, visible }) => {
    getUser.mockResolvedValue({ data: { user: { id: 'member-1' } } });
    maybeSingle.mockResolvedValue({
      data: { subscription_status: status },
      error: null,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              restaurantId: '11111111-1111-4111-8111-111111111111',
              restaurantName: 'Umai Sushi',
              reason: 'A quiet room for two.',
              cuisine_tags: ['Japanese'],
              neighborhood: 'McKinney',
              address: '1 Main St',
              price_range: '$$',
              image_url: null,
              google_place_id: null,
              selectionMode: 'random_fallback',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const ui = await RoulettePage({ searchParams: Promise.resolve({}) });
    render(ui);
    expect(select).toHaveBeenCalledWith('subscription_status');
    expect(eq).toHaveBeenCalledWith('id', 'member-1');
    fireEvent.submit(screen.getByRole('button', { name: 'Find a spot' }).closest('form')!);
    expect(await screen.findByRole('heading', { name: 'Umai Sushi' })).toBeTruthy();
    const link = screen.queryByRole('link', { name: 'Join for $15/month →' });
    if (visible) {
      expect(link?.getAttribute('href')).toBe('/pricing');
    } else {
      expect(link).toBeNull();
    }
  });
});
