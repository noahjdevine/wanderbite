import { normalizeCuisineIds, type CuisineId } from '@/lib/cuisines';

export const EXCLUDED_CUISINES_STORAGE_KEY = 'wb_excluded_cuisines';

/** Shared snapshot for missing, invalid, and server reads. Identity must stay stable. */
const emptyExcludedCuisines: CuisineId[] = [];
Object.freeze(emptyExcludedCuisines);
export const EMPTY_EXCLUDED_CUISINES = emptyExcludedCuisines;

const UNREADABLE: unique symbol = Symbol('unreadable-excluded-cuisines');

let lastRaw: string | null | typeof UNREADABLE = null;
let lastValue: CuisineId[] = EMPTY_EXCLUDED_CUISINES;

function snapshotFromRaw(raw: string | null): CuisineId[] {
  if (!raw) return EMPTY_EXCLUDED_CUISINES;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_EXCLUDED_CUISINES;
    const normalized = normalizeCuisineIds(parsed);
    if (normalized.length === 0) return EMPTY_EXCLUDED_CUISINES;
    Object.freeze(normalized);
    return normalized;
  } catch {
    return EMPTY_EXCLUDED_CUISINES;
  }
}

/**
 * Client snapshot for `useSyncExternalStore`.
 * Returns the previous array while `localStorage` raw text is unchanged.
 */
export function getExcludedCuisinesSnapshot(): CuisineId[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(EXCLUDED_CUISINES_STORAGE_KEY);
  } catch {
    if (lastRaw === UNREADABLE) return lastValue;
    lastRaw = UNREADABLE;
    lastValue = EMPTY_EXCLUDED_CUISINES;
    return lastValue;
  }
  if (raw === lastRaw) return lastValue;
  lastRaw = raw;
  lastValue = snapshotFromRaw(raw);
  return lastValue;
}

export function getExcludedCuisinesServerSnapshot(): CuisineId[] {
  return EMPTY_EXCLUDED_CUISINES;
}

export function subscribeExcludedCuisines(onStoreChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === EXCLUDED_CUISINES_STORAGE_KEY || event.key === null) {
      onStoreChange();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
