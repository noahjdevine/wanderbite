import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PartnerPhotoGrid } from '@/components/landing/partner-photo-grid';
import { PARTNER_PHOTO_CAP } from '@/lib/home/partner-grid';
import type { DirectoryRestaurant } from '@/lib/restaurants/directory';

function restaurant(overrides: Partial<DirectoryRestaurant> & Pick<DirectoryRestaurant, 'id' | 'name'>): DirectoryRestaurant {
  return {
    cuisine_tags: [],
    neighborhood: null,
    description: null,
    price_range: null,
    address: null,
    lat: null,
    lon: null,
    image_url: null,
    google_place_id: null,
    ...overrides,
  };
}

describe('PartnerPhotoGrid', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ ok: false }),
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('caps photos, skips rows without a real photo, and links tiles to /restaurants', () => {
    const photos = Array.from({ length: 10 }, (_, index) =>
      restaurant({
        id: `photo-${index + 1}`,
        name: `Photo ${index + 1}`,
        image_url: `/images/partner-${index + 1}.jpg`,
      }),
    );
    render(
      <PartnerPhotoGrid
        restaurants={[
          restaurant({ id: 'bare', name: 'No Photo' }),
          restaurant({
            id: 'placeholder',
            name: 'Placeholder Only',
            image_url: '/images/restaurant-placeholder.jpg',
          }),
          restaurant({
            id: 'placeholder-place',
            name: 'Placeholder Plus Place',
            image_url: '/images/restaurant-placeholder.jpg',
            google_place_id: 'ChIJ-still-placeholder',
          }),
          photos[0],
          restaurant({
            id: 'place-only',
            name: 'Place Photo',
            google_place_id: 'ChIJ-place',
          }),
          ...photos.slice(1),
        ]}
      />,
    );

    const tiles = screen.getAllByRole('link', { name: /Partner restaurants/ });
    expect(PARTNER_PHOTO_CAP).toBe(8);
    expect(tiles).toHaveLength(8);
    expect(tiles.map((tile) => tile.getAttribute('aria-label'))).toEqual([
      'Photo 1. Partner restaurants',
      'Place Photo. Partner restaurants',
      'Photo 2. Partner restaurants',
      'Photo 3. Partner restaurants',
      'Photo 4. Partner restaurants',
      'Photo 5. Partner restaurants',
      'Photo 6. Partner restaurants',
      'Photo 7. Partner restaurants',
    ]);
    for (const tile of tiles) {
      expect(tile.getAttribute('href')).toBe('/restaurants');
      expect(tile.closest('[class*="aspect-"]')?.className).toContain('aspect-[4/3]');
    }
    expect(screen.getByRole('link', { name: 'See all restaurants' }).getAttribute('href')).toBe(
      '/restaurants',
    );
    expect(screen.queryByText('No Photo')).toBeNull();
    expect(screen.queryByText('Placeholder Only')).toBeNull();
    expect(screen.queryByText('Placeholder Plus Place')).toBeNull();
    expect(screen.queryByText('Photo 8')).toBeNull();
    expect(screen.queryByText('Photo 9')).toBeNull();
    expect(screen.queryByText('Photo 10')).toBeNull();
  });

  it('renders nothing when no restaurant has a photo', () => {
    const { container } = render(
      <PartnerPhotoGrid
        restaurants={[
          restaurant({ id: 'bare', name: 'No Photo' }),
          restaurant({
            id: 'placeholder',
            name: 'Placeholder Only',
            image_url: '/images/restaurant-placeholder.jpg',
          }),
        ]}
      />,
    );
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('heading', { name: 'Partner spots' })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
