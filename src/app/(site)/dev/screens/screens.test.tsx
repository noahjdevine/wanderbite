import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isComponentGalleryEnabled } from '@/lib/dev/component-gallery';
import { RestaurantsPreview } from './restaurants-preview';
import { StampUnlockPreview } from './stamp-unlock-preview';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));
vi.mock('maplibre-gl', () => ({ default: {} }));
vi.mock('react-map-gl/maplibre', () => ({
  default: () => null,
  Marker: () => null,
  NavigationControl: () => null,
  Popup: () => null,
  Source: () => null,
  Layer: () => null,
}));

const ROOT = path.resolve(__dirname, '../../../../..');

describe('/dev/screens restaurants', () => {
  afterEach(() => {
    cleanup();
  });

  it('404s the restaurants sample when the gallery is disabled', async () => {
    expect(isComponentGalleryEnabled('production')).toBe(false);
    expect(isComponentGalleryEnabled('test')).toBe(true);
    const source = readFileSync(path.join(ROOT, 'src/app/(site)/dev/screens/page.tsx'), 'utf8');
    const gate = source.indexOf('if (!isComponentGalleryEnabled()) notFound();');
    const restaurants = source.indexOf("params.screen === 'restaurants'");
    expect(gate).toBeGreaterThan(-1);
    expect(restaurants).toBeGreaterThan(gate);

    vi.resetModules();
    vi.doMock('@/lib/dev/component-gallery', () => ({
      isComponentGalleryEnabled: () => false,
    }));
    const { default: DevScreensPage } = await import('./page');
    await expect(
      DevScreensPage({ searchParams: Promise.resolve({ screen: 'restaurants' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders the sample directory, and the empty and error states, with no live query', () => {
    render(<RestaurantsPreview state="ready" />);
    expect(screen.getAllByRole('article')).toHaveLength(3);
    const south = screen.getByRole('article', { name: 'South Grill' });
    expect(south.textContent).toContain('Downtown');
    expect(south.querySelector('[data-reason]')).toBeNull();
    const north = screen.getByRole('article', { name: 'North Grill' });
    expect(north.textContent).not.toContain('Downtown');
    expect(screen.getByRole('article', { name: 'Hidden Grill' }).querySelector('img')?.getAttribute('src')).toBe(
      '/images/restaurant-placeholder.jpg',
    );

    cleanup();
    render(<RestaurantsPreview state="empty" />);
    expect(screen.getByText('No partner restaurants are listed right now.')).toBeTruthy();
    expect(screen.queryByRole('article')).toBeNull();

    cleanup();
    render(<RestaurantsPreview state="error" />);
    expect(screen.getByRole('alert').textContent).toBe('Restaurants temporarily unavailable');
    expect(screen.getByRole('link', { name: 'Retry' }).getAttribute('href')).toBe('/restaurants');
  });
});

describe('/dev/screens stamp unlock', () => {
  afterEach(() => {
    cleanup();
  });

  it('404s the stamp unlock sample when the gallery is disabled', async () => {
    const source = readFileSync(path.join(ROOT, 'src/app/(site)/dev/screens/page.tsx'), 'utf8');
    const gate = source.indexOf('if (!isComponentGalleryEnabled()) notFound();');
    const screenRoute = source.indexOf("params.screen === 'stamp-unlock'");
    expect(gate).toBeGreaterThan(-1);
    expect(screenRoute).toBeGreaterThan(gate);

    vi.resetModules();
    vi.doMock('@/lib/dev/component-gallery', () => ({
      isComponentGalleryEnabled: () => false,
    }));
    const { default: DevScreensPage } = await import('./page');
    await expect(
      DevScreensPage({ searchParams: Promise.resolve({ screen: 'stamp-unlock' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders a replay control for the slam', () => {
    render(<StampUnlockPreview />);
    expect(screen.getByRole('button', { name: 'Replay stamp' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /The Yard/ }).className).toContain('wb-stamp-slam');
    expect(document.querySelector('[data-stamp-burst]')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('New stamp: The Yard')).toBeTruthy();
  });
});
