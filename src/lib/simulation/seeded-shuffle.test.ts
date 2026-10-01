import { describe, expect, it } from 'vitest';
import { createSeededShuffle, mulberry32 } from '@/lib/simulation/seeded-shuffle';

describe('seeded shuffle', () => {
  it('repeats a seed and does not call Math.random', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const first = createSeededShuffle(1)(items);
    const again = createSeededShuffle(1)(items);
    expect(again).toEqual(first);
    expect(createSeededShuffle(2)(items)).not.toEqual(first);
    expect(first.slice().sort((a, b) => a - b)).toEqual(items);
    const source = mulberry32.toString() + createSeededShuffle.toString();
    expect(source).not.toContain('Math.random');
  });
});
