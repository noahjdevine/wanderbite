const STORAGE_PREFIX = 'wb:discover-ran:';

/** Survives a strict-mode remount. A full reload clears it; sessionStorage does not. */
const claimed = new Set<string>();

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function storageKey(token: string): string {
  return `${STORAGE_PREFIX}${token}`;
}

/**
 * Returns true only the first time this homepage submit id is seen.
 * A later mount with the same id (refresh, back, strict mode) returns false.
 */
export function claimDiscoverRun(token: string): boolean {
  if (!token || claimed.has(token)) return false;
  claimed.add(token);
  try {
    const store = sessionStore();
    if (!store) return true;
    if (store.getItem(storageKey(token)) === '1') return false;
    store.setItem(storageKey(token), '1');
  } catch {
    return true;
  }
  return true;
}

/** Simulates a document reload. Leaves sessionStorage in place. */
export function forgetDiscoverAutoStartMemory(): void {
  claimed.clear();
}

export function resetDiscoverAutoStartClaims(): void {
  claimed.clear();
  try {
    const store = sessionStore();
    if (!store) return;
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // A blocked store still starts the next test from an empty memory set.
  }
}
