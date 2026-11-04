import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DIRECTORY_PHOTO_HEIGHT,
  RESTAURANTS_EMPTY_MESSAGE,
  RESTAURANTS_SEARCH_EMPTY,
  RESTAURANTS_UNAVAILABLE_MESSAGE,
  RestaurantsDirectory,
} from '@/components/locations/locations-client';
import { RESTAURANT_IMAGE_PLACEHOLDER } from '@/lib/restaurant-image';
import type { DirectoryRestaurant } from '@/lib/restaurants/directory';

function restaurant(overrides: Partial<DirectoryRestaurant> = {}): DirectoryRestaurant {
  return {
    id: 'rest-1',
    name: 'North Grill',
    cuisine_tags: ['Pizza'],
    neighborhood: '  Downtown ',
    description: 'Wood-fired plates and a long table for the evening.',
    price_range: '$$',
    address: '1 Main St',
    lat: 33.2,
    lon: -96.6,
    image_url: null,
    google_place_id: null,
    ...overrides,
  };
}

describe('restaurant directory cards', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('hides blank fields, trims the neighborhood, and uses the placeholder', () => {
    render(
      <RestaurantsDirectory
        restaurants={[
          restaurant({ id: 'blank', name: 'Blank Grill', neighborhood: '   ', description: '  ', price_range: '', cuisine_tags: [] }),
          restaurant({ id: 'downtown', name: 'South Grill', neighborhood: '  Downtown ', cuisine_tags: ['Sushi'] }),
          restaurant({
            id: 'photo',
            name: 'Photo Grill',
            image_url: '/images/restaurant-placeholder.jpg',
            neighborhood: 'Craig Ranch',
          }),
        ]}
      />,
    );

    const blank = screen.getByRole('article', { name: 'Blank Grill' });
    expect(blank.querySelector('[data-cuisine-row]')).toBeNull();
    expect(blank.querySelector('[data-price]')).toBeNull();
    expect(blank.querySelector('[data-reason]')).toBeNull();
    expect(blank.textContent).not.toContain('Downtown');
    expect(blank.textContent).not.toContain('McKinney');
    expect(blank.textContent).not.toContain('Wanderbite partner');
    expect(blank.textContent).not.toContain('off');
    expect(blank.querySelector('img')?.getAttribute('src')).toBe(RESTAURANT_IMAGE_PLACEHOLDER);

    const south = screen.getByRole('article', { name: 'South Grill' });
    expect(south.textContent).toContain('Downtown');
    expect(south.textContent).not.toContain('  Downtown ');
    expect(south.textContent).not.toContain('McKinney');
    expect(south.querySelector('[data-cuisine-row]')?.textContent).toContain('Sushi');
    expect(south.querySelector('[data-price]')?.textContent).toContain('$$');
    expect(south.querySelector('[data-reason]')?.className).toContain('line-clamp-2');

    const frames = document.querySelectorAll('[data-photo-frame]');
    expect(frames).toHaveLength(3);
    for (const frame of frames) {
      expect(frame.getAttribute('data-photo-height')).toBe(String(DIRECTORY_PHOTO_HEIGHT));
    }
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('partner spots')).toBeTruthy();
  });

  it('requests the place photo proxy and lets a manual image win', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        contentType: 'image/jpeg',
        imageBase64: btoa('photo'),
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:place-photo');
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL,
      revokeObjectURL: vi.fn(),
    }));

    const { unmount } = render(
      <RestaurantsDirectory
        restaurants={[
          restaurant({
            id: 'place-only',
            name: 'Place Grill',
            image_url: null,
            google_place_id: ' ChIJ-place ',
          }),
        ]}
      />,
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/restaurant-image/place-only', { cache: 'no-store' });
    });
    await waitFor(() => {
      expect(screen.getByRole('article', { name: 'Place Grill' }).querySelector('img')?.getAttribute('src')).toBe(
        'blob:place-photo',
      );
    });
    const placeCard = screen.getByRole('article', { name: 'Place Grill' });
    expect(placeCard.querySelector('img')?.getAttribute('src')).not.toBe(RESTAURANT_IMAGE_PLACEHOLDER);
    expect(placeCard.querySelector('[data-photo-frame]')?.getAttribute('data-photo-height')).toBe(
      String(DIRECTORY_PHOTO_HEIGHT),
    );
    unmount();
    fetchMock.mockClear();

    render(
      <RestaurantsDirectory
        restaurants={[
          restaurant({
            id: 'manual-wins',
            name: 'Manual Grill',
            image_url: '/images/yard.jpg',
            google_place_id: 'ChIJ-place',
          }),
        ]}
      />,
    );
    const manual = screen.getByRole('article', { name: 'Manual Grill' });
    expect(manual.querySelector('img')?.getAttribute('src')).toBe('/images/yard.jpg');
    expect(manual.querySelector('img')?.getAttribute('src')).not.toBe(RESTAURANT_IMAGE_PLACEHOLDER);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(manual.querySelector('[data-photo-frame]')?.getAttribute('data-photo-height')).toBe(
      String(DIRECTORY_PHOTO_HEIGHT),
    );
  });

  it('keeps search and shows an empty catalog without sample restaurants', () => {
    render(
      <RestaurantsDirectory
        restaurants={[
          restaurant({ name: 'North Grill', cuisine_tags: ['Pizza'] }),
          restaurant({ id: 'rest-2', name: 'South Grill', cuisine_tags: ['Sushi'], neighborhood: 'Stonebridge' }),
        ]}
      />,
    );
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search restaurants' }), {
      target: { value: 'stonebridge' },
    });
    expect(screen.getByRole('article', { name: 'South Grill' })).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'North Grill' })).toBeNull();
    expect(screen.getByText('2')).toBeTruthy();

    cleanup();
    render(<RestaurantsDirectory restaurants={[]} />);
    expect(screen.getByText(RESTAURANTS_EMPTY_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByText('North Grill')).toBeNull();
  });

  it('shows a retry link and no raw error on the unavailable state', () => {
    render(<RestaurantsDirectory restaurants={[]} unavailable />);
    expect(screen.getByRole('alert').textContent).toBe(RESTAURANTS_UNAVAILABLE_MESSAGE);
    expect(screen.getByRole('link', { name: 'Retry' }).getAttribute('href')).toBe('/restaurants');
    expect(screen.queryByText(RESTAURANTS_SEARCH_EMPTY)).toBeNull();
    expect(document.body.textContent).not.toContain('relation');
  });

  it('stops the directory motion under reduced motion', () => {
    const css = readFileSync(
      path.join(path.resolve(__dirname, '../../..'), 'src/app/styles/wanderbite-theme.css'),
      'utf8',
    );
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    const client = readFileSync(
      path.join(path.resolve(__dirname, '../../..'), 'src/components/locations/locations-client.tsx'),
      'utf8',
    );
    const ticket = readFileSync(
      path.join(path.resolve(__dirname, '../../..'), 'src/components/wb/challenge-ticket.tsx'),
      'utf8',
    );
    for (const name of ['wb-aurora', 'wb-aurora-2', 'wb-drift', 'wb-bokeh']) {
      expect(reduced).toContain(`.${name}`);
    }
    expect(client).toContain('wb-aurora');
    expect(ticket).toContain('wb-drift');
    expect(client).not.toContain('@keyframes');
  });
});
