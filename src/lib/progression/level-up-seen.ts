/**
 * Which reached milestone this browser should celebrate.
 * Read-only. Nothing here awards XP, a badge, or a drawing entry.
 * A storage failure returns null so the dialog stays closed.
 */

export const LEVEL_UP_SEEN_PREFIX = 'wb:levelup-seen:';

export type LevelUpStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type LevelUpCandidate = {
  id: string;
  level: number;
  name: string;
};

export type LevelUpChoice<T extends LevelUpCandidate> = {
  milestone: T;
  markIds: string[];
};

export function levelUpSeenKey(id: string): string {
  return `${LEVEL_UP_SEEN_PREFIX}${id}`;
}

const storageWritable = new WeakMap<object, boolean>();

export function pickLevelUpCelebration<T extends LevelUpCandidate>(
  milestones: readonly T[],
  storage: LevelUpStorage | null,
): LevelUpChoice<T> | null {
  if (!storage) return null;
  const known = storageWritable.get(storage);
  if (known === false) return null;
  try {
    if (known !== true) {
      const probe = `${LEVEL_UP_SEEN_PREFIX}probe`;
      storage.setItem(probe, '1');
      storage.removeItem(probe);
      storageWritable.set(storage, true);
    }
    const unseen: T[] = [];
    for (const milestone of milestones) {
      if (!milestone.id) continue;
      if (storage.getItem(levelUpSeenKey(milestone.id)) === '1') continue;
      unseen.push(milestone);
    }
    if (unseen.length === 0) return null;
    let highest = unseen[0];
    if (!highest) return null;
    for (const milestone of unseen) {
      if (milestone.level > highest.level) highest = milestone;
    }
    return { milestone: highest, markIds: unseen.map((milestone) => milestone.id) };
  } catch {
    storageWritable.set(storage, false);
    return null;
  }
}

export function markLevelUpsSeen(ids: readonly string[], storage: LevelUpStorage | null): boolean {
  if (!storage) return false;
  try {
    for (const id of ids) {
      if (!id) continue;
      storage.setItem(levelUpSeenKey(id), '1');
    }
    return true;
  } catch {
    return false;
  }
}

export function browserLevelUpStorage(): LevelUpStorage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}
