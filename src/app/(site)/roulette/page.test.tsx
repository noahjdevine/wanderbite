import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
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
const getUser = vi.hoisted(() => vi.fn(async () => ({ data: { user: null } })));

vi.mock('@/lib/discover/viewer', () => ({
  loadDiscoverViewer: () => loadDiscoverViewer(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
  }),
}));

import RoulettePage from '@/app/(site)/roulette/page';

describe('roulette page flag switch', () => {
  beforeEach(() => {
    loadDiscoverViewer.mockClear();
    getUser.mockClear();
    getUser.mockResolvedValue({ data: { user: null } });
    vi.stubEnv('DISCOVER_STREAM_ENABLED', '');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
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
});
