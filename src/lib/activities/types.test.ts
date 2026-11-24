import { describe, expect, it } from 'vitest';
import { ACTIVITY_CATEGORIES, categoryLabel, isActivityCategory } from '@/lib/activities/types';

describe('activity categories', () => {
  it('keeps the original five values and the six new ones', () => {
    expect(ACTIVITY_CATEGORIES).toEqual([
      'museum',
      'walk',
      'class',
      'sports',
      'arts',
      'comedy',
      'theater',
      'live_music',
      'games',
      'landmark',
      'dessert',
    ]);
    expect(isActivityCategory('museum')).toBe(true);
    expect(isActivityCategory('comedy')).toBe(true);
    expect(isActivityCategory('dessert')).toBe(true);
    expect(isActivityCategory('karaoke')).toBe(false);
    expect(categoryLabel('live_music')).toBe('Live music');
    expect(categoryLabel('theater')).toBe('Theater');
  });
});
