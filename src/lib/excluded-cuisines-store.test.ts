import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  EMPTY_EXCLUDED_CUISINES,
  EXCLUDED_CUISINES_STORAGE_KEY,
  getExcludedCuisinesServerSnapshot,
  getExcludedCuisinesSnapshot,
  subscribeExcludedCuisines,
} from '@/lib/excluded-cuisines-store';

function setRaw(raw: string | null) {
  if (raw === null) localStorage.removeItem(EXCLUDED_CUISINES_STORAGE_KEY);
  else localStorage.setItem(EXCLUDED_CUISINES_STORAGE_KEY, raw);
}

describe('excluded cuisines snapshot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setRaw(null);
    getExcludedCuisinesSnapshot();
  });

  it('returns the same array while storage is unchanged', () => {
    setRaw(null);
    const missingA = getExcludedCuisinesSnapshot();
    const missingB = getExcludedCuisinesSnapshot();
    expect(Object.is(missingA, missingB)).toBe(true);
    expect(Object.is(missingA, EMPTY_EXCLUDED_CUISINES)).toBe(true);

    setRaw(JSON.stringify(['italian', 'thai']));
    const filledA = getExcludedCuisinesSnapshot();
    const filledB = getExcludedCuisinesSnapshot();
    expect(filledA).toEqual(['italian', 'thai']);
    expect(Object.is(filledA, filledB)).toBe(true);
    expect(Object.is(filledA, missingA)).toBe(false);
  });

  it('returns a new array when the stored value changes', () => {
    setRaw(JSON.stringify(['italian']));
    const italian = getExcludedCuisinesSnapshot();

    setRaw(JSON.stringify(['mexican']));
    const mexican = getExcludedCuisinesSnapshot();

    expect(italian).toEqual(['italian']);
    expect(mexican).toEqual(['mexican']);
    expect(Object.is(italian, mexican)).toBe(false);
    expect(Object.is(mexican, getExcludedCuisinesSnapshot())).toBe(true);
  });

  it('shares one empty array for invalid JSON and non-arrays', () => {
    setRaw('{');
    const invalid = getExcludedCuisinesSnapshot();
    expect(Object.is(invalid, EMPTY_EXCLUDED_CUISINES)).toBe(true);
    expect(Object.is(invalid, getExcludedCuisinesSnapshot())).toBe(true);

    setRaw(JSON.stringify({ cuisine: 'italian' }));
    const objectValue = getExcludedCuisinesSnapshot();
    expect(Object.is(objectValue, EMPTY_EXCLUDED_CUISINES)).toBe(true);

    setRaw(JSON.stringify('italian'));
    expect(Object.is(getExcludedCuisinesSnapshot(), EMPTY_EXCLUDED_CUISINES)).toBe(true);

    setRaw(JSON.stringify(['not-a-cuisine']));
    expect(Object.is(getExcludedCuisinesSnapshot(), EMPTY_EXCLUDED_CUISINES)).toBe(true);
  });

  it('keeps the server snapshot on the shared empty array', () => {
    const first = getExcludedCuisinesServerSnapshot();
    const second = getExcludedCuisinesServerSnapshot();
    expect(Object.is(first, second)).toBe(true);
    expect(Object.is(first, EMPTY_EXCLUDED_CUISINES)).toBe(true);
    expect(Object.isFrozen(EMPTY_EXCLUDED_CUISINES)).toBe(true);

    setRaw(JSON.stringify(['italian']));
    getExcludedCuisinesSnapshot();
    expect(Object.is(getExcludedCuisinesServerSnapshot(), EMPTY_EXCLUDED_CUISINES)).toBe(true);
  });

  it('returns the shared empty array when storage throws', () => {
    setRaw(JSON.stringify(['italian']));
    getExcludedCuisinesSnapshot();
    const spy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const thrownA = getExcludedCuisinesSnapshot();
      const thrownB = getExcludedCuisinesSnapshot();
      expect(Object.is(thrownA, EMPTY_EXCLUDED_CUISINES)).toBe(true);
      expect(Object.is(thrownA, thrownB)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('mounts through useSyncExternalStore without a snapshot loop', async () => {
    setRaw(JSON.stringify(['italian']));
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map((arg) => String(arg)).join(' '));
    };

    function Probe() {
      const excluded = useSyncExternalStore(
        subscribeExcludedCuisines,
        getExcludedCuisinesSnapshot,
        getExcludedCuisinesServerSnapshot,
      );
      return createElement('p', null, excluded.join(',') || 'none');
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root | null = null;
    const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousActEnv = actEnv.IS_REACT_ACT_ENVIRONMENT;
    actEnv.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => {
        root = createRoot(container);
        root.render(createElement(Probe));
      });
      expect(container.textContent).toBe('italian');
      expect(errors.join('\n')).not.toMatch(/getSnapshot should be cached|Maximum update depth/);
    } finally {
      console.error = original;
      act(() => {
        root?.unmount();
      });
      actEnv.IS_REACT_ACT_ENVIRONMENT = previousActEnv;
      container.remove();
    }
  });

  it('notifies subscribers on storage events for this key or a full clear', () => {
    let calls = 0;
    const unsubscribe = subscribeExcludedCuisines(() => {
      calls += 1;
    });

    window.dispatchEvent(new StorageEvent('storage', { key: EXCLUDED_CUISINES_STORAGE_KEY }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(calls).toBe(2);

    unsubscribe();
    window.dispatchEvent(new StorageEvent('storage', { key: EXCLUDED_CUISINES_STORAGE_KEY }));
    expect(calls).toBe(2);
  });
});
