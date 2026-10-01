import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  floorPairExists,
  pickFloorPair,
  selectDistancePool,
} from '@/lib/challenges/distance-pool';
import { haversineMiles, originFromZip, type GeoPoint } from '@/lib/launch-market';

const ROOT = path.resolve(__dirname, '../../..');
const ZIPS = ['75069', '75070', '75071', '75072'] as const;

function offer(id: string, baseCents: number, cuisine: string[] = ['salad']) {
  return { id, baseCents, cuisine_tags: cuisine };
}

describe('floor pair picker', () => {
  const identity = <T>(items: T[]) => items;

  it('rejects two $9 offers, accepts a $9 with an $11, and ignores a duplicate id', () => {
    const nine = offer('a', 900);
    const otherNine = offer('b', 900);
    expect(pickFloorPair([nine, otherNine], { shuffle: identity })).toBeNull();
    expect(floorPairExists([nine, otherNine])).toBe(false);

    const eleven = offer('c', 1100);
    const picked = pickFloorPair([nine, otherNine, eleven], { shuffle: identity });
    expect(picked?.map((row) => row.id)).toEqual(['a', 'c']);
    expect(floorPairExists([nine, otherNine, eleven])).toBe(true);

    const duplicate = [offer('same', 1100), offer('same', 1100)];
    expect(pickFloorPair(duplicate, { shuffle: identity })).toBeNull();
    expect(floorPairExists(duplicate)).toBe(false);
  });

  it('prefers a cocktail pair and falls back when that pair misses the floor', () => {
    const saladA = offer('salad-a', 1000);
    const saladB = offer('salad-b', 1000);
    const cocktail = offer('bar', 1000, ['cocktail']);
    const preferred = pickFloorPair([saladA, saladB, cocktail], {
      shuffle: identity,
      reserveCocktail: true,
    });
    expect(preferred?.map((row) => row.id)).toEqual(['salad-a', 'bar']);

    const cheapBar = offer('bar', 100, ['cocktail']);
    const fallback = pickFloorPair([saladA, saladB, cheapBar], {
      shuffle: identity,
      reserveCocktail: true,
    });
    expect(fallback?.map((row) => row.id)).toEqual(['salad-a', 'salad-b']);
  });
});

describe('floor-aware distance expansion', () => {
  const origins = ZIPS.map((zip) => {
    const origin = originFromZip(zip);
    if (!origin) throw new Error(`missing ${zip}`);
    return origin;
  });

  function farPoint(n: number): GeoPoint {
    return { lat: 33.2 + n * 0.0001, lon: -96.5 };
  }

  const nearPoints: GeoPoint[] = [
    { lat: 33.188, lon: -96.65 },
    { lat: 33.1882, lon: -96.65 },
  ];

  function place(
    point: GeoPoint,
    extra: { id: string; baseCents: number; cuisine_tags: string[] | null },
  ) {
    return { ...extra, lat: point.lat, lon: point.lon };
  }

  it('places FAR rows between 5 and 15 miles and NEAR rows inside 5 for every launch ZIP', () => {
    for (let n = 1; n <= 30; n += 1) {
      const point = farPoint(n);
      for (const origin of origins) {
        const miles = haversineMiles(origin, point);
        expect(miles).toBeGreaterThan(5);
        expect(miles).toBeLessThanOrEqual(15);
      }
    }
    for (const point of nearPoints) {
      for (const origin of origins) {
        expect(haversineMiles(origin, point)).toBeLessThanOrEqual(5);
      }
    }
  });

  it('expands when the callback needs a pair and stays put when only the count is checked', () => {
    const origin = origins[0];
    if (!origin) throw new Error('missing origin');
    const restaurants = [
      ...nearPoints.map((point, index) =>
        place(point, { id: `near-${index}`, baseCents: 900, cuisine_tags: ['salad'] as string[] | null }),
      ),
      ...Array.from({ length: 30 }, (_, index) =>
        place(farPoint(index + 1), {
          id: `far-${index + 1}`,
          baseCents: 1000,
          cuisine_tags: ['salad'] as string[] | null,
        }),
      ),
    ];
    const passes = {
      passesHard: () => true,
      passesVariety: () => true,
      passesRelaxedVariety: () => true,
    };
    const counted = selectDistancePool({
      restaurants,
      origin,
      requestedMiles: 5,
      requiredCount: 2,
      ...passes,
    });
    expect(counted.match).toEqual({ requestedMiles: 5, usedMiles: 5, expanded: false });
    expect(counted.candidates.map((row) => row.id).sort()).toEqual(['near-0', 'near-1']);

    const aware = selectDistancePool({
      restaurants,
      origin,
      requestedMiles: 5,
      requiredCount: 2,
      ...passes,
      poolSatisfies: (candidates) => floorPairExists(candidates),
    });
    expect(aware.match).toEqual({ requestedMiles: 5, usedMiles: 15, expanded: true });
    expect(aware.candidates.some((row) => row.id === 'far-1')).toBe(true);
    expect(aware.candidates.filter((row) => row.id.startsWith('far-'))).toHaveLength(30);
  });

  it('relaxes inside the requested band when only that pool has a qualifying pair', () => {
    const origin = origins[0];
    if (!origin) throw new Error('missing origin');
    const near = nearPoints.map((point, index) =>
      place(point, { id: `cheap-${index}`, baseCents: 900, cuisine_tags: ['salad'] as string[] | null }),
    );
    const relaxed = [
      place(nearPoints[0]!, { id: 'high-a', baseCents: 1500, cuisine_tags: ['thai'] as string[] | null }),
      place(
        { lat: nearPoints[0]!.lat + 0.0002, lon: nearPoints[0]!.lon },
        { id: 'high-b', baseCents: 1500, cuisine_tags: ['thai'] as string[] | null },
      ),
    ];
    const beyond = place(farPoint(1), {
      id: 'beyond',
      baseCents: 2000,
      cuisine_tags: ['salad'] as string[] | null,
    });
    const pool = selectDistancePool({
      restaurants: [...near, ...relaxed, beyond],
      origin,
      requestedMiles: 5,
      requiredCount: 2,
      passesHard: () => true,
      passesVariety: (restaurant) => restaurant.id.startsWith('cheap-'),
      passesRelaxedVariety: (restaurant) => restaurant.id !== 'beyond',
      poolSatisfies: (candidates) => floorPairExists(candidates),
    });
    expect(pool.match).toEqual({ requestedMiles: 5, usedMiles: 5, expanded: false });
    expect(pool.candidates.map((row) => row.id).sort()).toEqual(['cheap-0', 'cheap-1', 'high-a', 'high-b']);
  });

  it('stops after one band when no radius has a qualifying pair', () => {
    const origin = origins[0];
    if (!origin) throw new Error('missing origin');
    const cheapNear = nearPoints.map((point, index) =>
      place(point, { id: `near-${index}`, baseCents: 900, cuisine_tags: null }),
    );
    const cheapFar = [1, 2].map((n) =>
      place(farPoint(n), { id: `far-${n}`, baseCents: 900, cuisine_tags: null }),
    );
    const wayOut = place(
      { lat: 33.6, lon: -96.5 },
      { id: 'way-out', baseCents: 2000, cuisine_tags: null },
    );
    for (const originPoint of origins) {
      expect(haversineMiles(originPoint, wayOut)).toBeGreaterThan(15);
    }
    const pool = selectDistancePool({
      restaurants: [...cheapNear, ...cheapFar, wayOut],
      origin,
      requestedMiles: 5,
      requiredCount: 2,
      passesHard: () => true,
      passesVariety: () => true,
      passesRelaxedVariety: () => true,
      poolSatisfies: (candidates) => floorPairExists(candidates),
    });
    expect(pool.match).toEqual({ requestedMiles: 5, usedMiles: 15, expanded: true });
    expect(pool.candidates.map((row) => row.id)).not.toContain('way-out');
    expect(floorPairExists(pool.candidates)).toBe(false);
  });

  it('leaves the legacy generator on pickDistinctRestaurants', () => {
    const generate = readFileSync(path.join(ROOT, 'src/lib/challenges/generate.ts'), 'utf8');
    expect(generate).toContain('pickDistinctRestaurants');
    expect(generate).not.toContain('pickFloorPair');
    expect(generate).not.toContain('poolSatisfies');
  });
});
