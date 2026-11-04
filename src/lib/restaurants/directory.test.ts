import { describe, expect, it } from 'vitest';
import { RESTAURANT_IMAGE_PLACEHOLDER } from '@/lib/restaurant-image';
import { mapDirectoryRestaurant, type DirectoryRestaurantRow } from '@/lib/restaurants/directory';

function row(overrides: Partial<DirectoryRestaurantRow> = {}): DirectoryRestaurantRow {
  return {
    id: 'rest-1',
    name: 'North Grill',
    cuisine_tags: [' Pizza '],
    neighborhood: '  Downtown ',
    description: '  Wood-fired plates. ',
    price_range: ' $$ ',
    address: ' 1 Main ',
    lat: 33.2,
    lon: -96.6,
    image_url: '/images/restaurant-placeholder.jpg',
    ...overrides,
  };
}

describe('mapDirectoryRestaurant', () => {
  it('trims neighborhood, price, description, and cuisine, and keeps a safe image', () => {
    const mapped = mapDirectoryRestaurant(row());
    expect(mapped.neighborhood).toBe('Downtown');
    expect(mapped.price_range).toBe('$$');
    expect(mapped.description).toBe('Wood-fired plates.');
    expect(mapped.cuisine_tags).toEqual(['Pizza']);
    expect(mapped.address).toBe('1 Main');
    expect(mapped.image_url).toBe('/images/restaurant-placeholder.jpg');
  });

  it('drops blank neighborhood, description, price, and cuisine without using a market name', () => {
    const mapped = mapDirectoryRestaurant(
      row({
        neighborhood: '   ',
        description: '',
        price_range: '  ',
        cuisine_tags: ['  ', ''],
        image_url: 'https://example.com/photo.jpg',
      }),
    );
    expect(mapped.neighborhood).toBeNull();
    expect(mapped.description).toBeNull();
    expect(mapped.price_range).toBeNull();
    expect(mapped.cuisine_tags).toEqual([]);
    expect(mapped.image_url).toBeNull();
    expect(JSON.stringify(mapped)).not.toContain('McKinney');
    expect(RESTAURANT_IMAGE_PLACEHOLDER).toBe('/images/restaurant-placeholder.jpg');
  });
});
