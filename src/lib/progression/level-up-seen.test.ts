import { describe, expect, it } from 'vitest';
import {
  levelUpSeenKey,
  markLevelUpsSeen,
  pickLevelUpCelebration,
  type LevelUpStorage,
} from '@/lib/progression/level-up-seen';

function memoryStorage(): LevelUpStorage {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const explorer = { id: 'm1', level: 1, name: 'The Explorer' };
const tastemaker = { id: 'm2', level: 2, name: 'The Tastemaker' };

describe('level-up seen tracking', () => {
  it('celebrates the highest unseen milestone and then stays closed for every page', () => {
    const storage = memoryStorage();
    const choice = pickLevelUpCelebration([explorer, tastemaker], storage);
    expect(choice?.milestone).toEqual(tastemaker);
    expect(choice?.markIds).toEqual(['m1', 'm2']);

    expect(markLevelUpsSeen(choice?.markIds ?? [], storage)).toBe(true);
    expect(storage.getItem(levelUpSeenKey('m1'))).toBe('1');
    expect(storage.getItem(levelUpSeenKey('m2'))).toBe('1');
    expect(pickLevelUpCelebration([explorer, tastemaker], storage)).toBeNull();
  });

  it('stays closed when a level was already seen, and when storage throws', () => {
    const storage = memoryStorage();
    storage.setItem(levelUpSeenKey('m1'), '1');
    expect(pickLevelUpCelebration([explorer], storage)).toBeNull();

    const broken: LevelUpStorage = {
      getItem() {
        throw new Error('private');
      },
      setItem() {
        throw new Error('private');
      },
      removeItem() {
        throw new Error('private');
      },
    };
    expect(pickLevelUpCelebration([explorer], broken)).toBeNull();
    expect(markLevelUpsSeen(['m1'], broken)).toBe(false);
    expect(pickLevelUpCelebration([explorer], null)).toBeNull();
  });
});
