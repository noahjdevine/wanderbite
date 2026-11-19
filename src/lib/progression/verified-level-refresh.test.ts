import { describe, expect, it, vi } from 'vitest';
import {
  scheduleVerifiedLevelRefresh,
  VERIFIED_LEVEL_REFRESH_MS,
  type VerifiedLevelRefreshSchedule,
} from '@/lib/progression/verified-level-refresh';

function memorySchedule(): VerifiedLevelRefreshSchedule & { fire(): void; ms: number | null } {
  const stored = new Map<string, string>();
  let pending: (() => void) | null = null;
  let ms: number | null = null;
  return {
    get ms() {
      return ms;
    },
    getItem(key) {
      return stored.get(key) ?? null;
    },
    setItem(key, value) {
      stored.set(key, value);
    },
    setTimeout(callback, delay) {
      pending = callback;
      ms = delay;
      return 1;
    },
    fire() {
      pending?.();
    },
  };
}

describe('scheduleVerifiedLevelRefresh', () => {
  it('refreshes once, two seconds after the verified transition', () => {
    const schedule = memorySchedule();
    const refresh = vi.fn();
    expect(scheduleVerifiedLevelRefresh('red-1', refresh, schedule)).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
    expect(schedule.ms).toBe(VERIFIED_LEVEL_REFRESH_MS);
    schedule.fire();
    expect(refresh).toHaveBeenCalledTimes(1);

    expect(scheduleVerifiedLevelRefresh('red-1', refresh, schedule)).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('schedules a different redemption on its own', () => {
    const schedule = memorySchedule();
    const refresh = vi.fn();
    expect(scheduleVerifiedLevelRefresh('red-1', refresh, schedule)).toBe(true);
    expect(scheduleVerifiedLevelRefresh('red-2', refresh, schedule)).toBe(true);
  });

  it('does nothing without a schedule or an id', () => {
    const refresh = vi.fn();
    expect(scheduleVerifiedLevelRefresh('red-1', refresh, null)).toBe(false);
    expect(scheduleVerifiedLevelRefresh('', refresh, memorySchedule())).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});
