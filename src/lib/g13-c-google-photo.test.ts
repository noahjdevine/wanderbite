import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { legacyPhotoCredit } from '@/lib/google-photo-credit';
import { readBoundedBytes } from '@/lib/google-places';
import {
  isGooglePlacesOutboundDisabled,
  restaurantDisplayImageUrl,
  safeManualImagePath,
} from '@/lib/restaurant-image';

const ROOT = path.resolve(__dirname, '../..');

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('G13-C manual image paths', () => {
  it('allows a static /images path and rejects open-redirect shapes', () => {
    expect(safeManualImagePath('/images/restaurant-placeholder.jpg')).toBe(
      '/images/restaurant-placeholder.jpg',
    );
    expect(safeManualImagePath('/images/partners/a.jpg')).toBe('/images/partners/a.jpg');
    expect(safeManualImagePath('/' + '\\evil.example/x')).toBeNull();
    expect(safeManualImagePath('//evil.example/x')).toBeNull();
    expect(safeManualImagePath('/images/../secret')).toBeNull();
    expect(safeManualImagePath('/images/%2e%2e/secret')).toBeNull();
    expect(safeManualImagePath('/images/a\\b')).toBeNull();
    expect(safeManualImagePath('/images/a\nb')).toBeNull();
    expect(safeManualImagePath('/Images/a.jpg')).toBeNull();
    expect(safeManualImagePath('https://maps.googleapis.com/maps/api/place/photo?key=abc')).toBeNull();
    expect(safeManualImagePath(' /images/a.jpg')).toBeNull();
  });

  it('uses a safe path, otherwise the proxy, otherwise the placeholder', () => {
    expect(
      restaurantDisplayImageUrl({
        id: '11111111-1111-4111-8111-111111111111',
        image_url: '/images/a.jpg',
        google_place_id: 'place',
      }),
    ).toBe('/images/a.jpg');
    expect(
      restaurantDisplayImageUrl({
        id: '11111111-1111-4111-8111-111111111111',
        image_url: 'https://cdn.example/photo.jpg',
        google_place_id: 'place',
      }),
    ).toBe('/api/restaurant-image/11111111-1111-4111-8111-111111111111');
    expect(
      restaurantDisplayImageUrl({
        id: '11111111-1111-4111-8111-111111111111',
        image_url: null,
        google_place_id: null,
      }),
    ).toBe('/images/restaurant-placeholder.jpg');
  });
});

describe('G13-C legacy photo credit', () => {
  it('requires a safe Google link when attributions are present', () => {
    expect(legacyPhotoCredit([])).toBeNull();
    expect(legacyPhotoCredit(undefined)).toBeNull();
    expect(
      legacyPhotoCredit(['<a href="https://maps.google.com/maps/contrib/1">Ada</a>']),
    ).toEqual([{ name: 'Ada', href: 'https://maps.google.com/maps/contrib/1' }]);
    expect(legacyPhotoCredit(['<a href="https://evil.example/a">Ada</a>'])).toBe('unsafe');
    expect(legacyPhotoCredit(['Ada'])).toBe('unsafe');
  });
});

describe('G13-C bounded photo bytes', () => {
  it('cancels once the stream passes the cap', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    });
    await expect(readBoundedBytes(stream, 5)).resolves.toBe('oversize');
  });
});

describe('G13-C photo key boundaries', () => {
  it('keeps the kill switch exact and stops rehost plus key-bearing returns', () => {
    const previous = process.env.WANDERBITE_GOOGLE_PLACES_OUTBOUND_DISABLED;
    process.env.WANDERBITE_GOOGLE_PLACES_OUTBOUND_DISABLED = 'true';
    expect(isGooglePlacesOutboundDisabled()).toBe(true);
    process.env.WANDERBITE_GOOGLE_PLACES_OUTBOUND_DISABLED = 'TRUE';
    expect(isGooglePlacesOutboundDisabled()).toBe(false);
    delete process.env.WANDERBITE_GOOGLE_PLACES_OUTBOUND_DISABLED;
    expect(isGooglePlacesOutboundDisabled()).toBe(false);
    if (previous === undefined) delete process.env.WANDERBITE_GOOGLE_PLACES_OUTBOUND_DISABLED;
    else process.env.WANDERBITE_GOOGLE_PLACES_OUTBOUND_DISABLED = previous;

    const places = source('src/lib/google-places.ts');
    const imported = source('src/lib/google-places-import.ts');
    const route = source('src/app/api/restaurant-image/[id]/route.ts');
    const cron = source('src/app/api/cron/refresh-restaurant-photos/route.ts');
    const vercel = source('vercel.json');
    expect(imported).not.toMatch(/place\/photo/);
    expect(places).not.toMatch(/photoUrl/);
    expect(route).not.toMatch(/image_url/);
    expect(route).toMatch(/private, no-store/);
    expect(cron).not.toMatch(/fetchLegacyPlacePhoto/);
    expect(cron).not.toMatch(/supabase/);
    expect(vercel).not.toMatch(/refresh-restaurant-photos/);
    expect(source('src/lib/ratelimit.ts')).toMatch(/slidingWindow\(60, '10 m'\)/);
    expect(source('src/lib/ratelimit.ts')).toMatch(/slidingWindow\(300, '10 m'\)/);
  });
});
