import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalFilterString } from '@/lib/discovery-turn';
import {
  applyRestaurantExclusion,
  canonicalFilterWithExcludedRestaurants,
  exclusionEmptiesPool,
} from '@/lib/discover/exclude-restaurants';

const ROOT = path.resolve(__dirname, '../../..');

const pool = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Bravo' },
  { id: 'c', name: 'Charlie' },
];

describe('restaurant exclusion before the pick', () => {
  it('leaves the pool unchanged when the list is empty or matches nothing', () => {
    expect(applyRestaurantExclusion(pool, [])).toBe(pool);
    expect(applyRestaurantExclusion(pool, ['missing'])).toBe(pool);
  });

  it('drops the shown restaurant and keeps the remaining order', () => {
    expect(applyRestaurantExclusion(pool, ['b']).map((row) => row.id)).toEqual(['a', 'c']);
    expect(applyRestaurantExclusion(pool, ['a', 'a', 'c']).map((row) => row.id)).toEqual(['b']);
  });

  it('notices when the exclusion list covers every remaining partner', () => {
    expect(exclusionEmptiesPool(pool, [])).toBe(false);
    expect(exclusionEmptiesPool(pool, ['a'])).toBe(false);
    expect(exclusionEmptiesPool(pool, ['a', 'b', 'c'])).toBe(true);
    expect(exclusionEmptiesPool(pool, ['c', 'missing', 'b', 'a'])).toBe(true);
    expect(exclusionEmptiesPool([], ['a'])).toBe(false);
  });

  it('re-allows the oldest excluded id when the list would leave nothing', () => {
    expect(applyRestaurantExclusion(pool, ['a', 'b', 'c']).map((row) => row.id)).toEqual(['a']);
    expect(applyRestaurantExclusion(pool, ['c', 'b', 'a']).map((row) => row.id)).toEqual(['c']);
    expect(applyRestaurantExclusion(pool, ['missing', 'b', 'a', 'c']).map((row) => row.id)).toEqual(['b']);
    expect(applyRestaurantExclusion([{ id: 'only' }], ['only'])).toEqual([{ id: 'only' }]);
    expect(applyRestaurantExclusion([], ['a'])).toEqual([]);
  });

  it('appends a stable id list to the replay filter and leaves an empty list untouched', () => {
    const base = canonicalFilterString({
      dietary: ['vegan'],
      excluded: ['thai'],
      vibe: 'Date Night',
      timeOfDay: 'Dinner',
      priceRange: '$$',
      preferredCuisine: 'japanese',
    });
    expect(canonicalFilterWithExcludedRestaurants(base, [])).toBe(base);
    expect(canonicalFilterWithExcludedRestaurants(base, ['b', 'a', 'b'])).toBe(
      `${base}|excludeRestaurants=a,b`,
    );
  });

  it('is applied in the shared turn before the pick pool is frozen', () => {
    const turn = readFileSync(path.join(ROOT, 'src/lib/discover/turn.ts'), 'utf8');
    const applied = turn.indexOf('applyRestaurantExclusion(restaurants, excludeRestaurantIds)');
    const frozen = turn.indexOf('const byId = new Map(restaurants.map((r) => [r.id, r]));');
    expect(applied).toBeGreaterThan(0);
    expect(frozen).toBeGreaterThan(applied);
    expect(turn).toMatch(
      /boundStringArray\(\s*body\.excludeRestaurantIds,\s*ROULETTE_MAX_EXCLUDED,\s*\)/,
    );
    expect(turn).toMatch(
      /canonicalFilterWithExcludedRestaurants\(\s*canonicalFilterString\(/,
    );
    expect(turn).not.toMatch(/directions:/);
  });
});
