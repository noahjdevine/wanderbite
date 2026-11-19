/**
 * The show-code poll refreshes as soon as a verify is visible. The progression
 * ledger write can commit a moment after that. One later refresh lets the
 * level-up dialog read the new milestone. A second call for the same
 * redemption in this tab does nothing.
 */

export const VERIFIED_LEVEL_REFRESH_MS = 2_000;

const VERIFIED_LEVEL_REFRESH_PREFIX = 'wb:show-code-level-refresh:';

export type VerifiedLevelRefreshSchedule = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  setTimeout(callback: () => void, ms: number): number;
};

export function scheduleVerifiedLevelRefresh(
  redemptionId: string,
  refresh: () => void,
  schedule: VerifiedLevelRefreshSchedule | null = browserVerifiedLevelRefreshSchedule(),
): boolean {
  if (!schedule || !redemptionId) return false;
  const key = `${VERIFIED_LEVEL_REFRESH_PREFIX}${redemptionId}`;
  let already = false;
  try {
    already = schedule.getItem(key) === '1';
    if (!already) schedule.setItem(key, '1');
  } catch {
    already = false;
  }
  if (already) return false;
  schedule.setTimeout(refresh, VERIFIED_LEVEL_REFRESH_MS);
  return true;
}

function browserVerifiedLevelRefreshSchedule(): VerifiedLevelRefreshSchedule | null {
  if (typeof window === 'undefined') return null;
  return {
    getItem(key) {
      return window.sessionStorage.getItem(key);
    },
    setItem(key, value) {
      window.sessionStorage.setItem(key, value);
    },
    setTimeout(callback, ms) {
      return window.setTimeout(callback, ms);
    },
  };
}
