import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activitiesEnabled,
  activityNotesEnabled,
  logActivityNotesReadFailedOnce,
  logActivityNotesUnavailableOnce,
  resetActivitiesLogs,
} from '@/lib/activities/flag';

describe('activity flags', () => {
  beforeEach(() => {
    resetActivitiesLogs();
    vi.restoreAllMocks();
  });

  it('stays off unless the env value is exactly true', () => {
    expect(activitiesEnabled(undefined)).toBe(false);
    expect(activitiesEnabled('')).toBe(false);
    expect(activitiesEnabled('TRUE')).toBe(false);
    expect(activitiesEnabled('true')).toBe(true);
    expect(activityNotesEnabled(undefined)).toBe(false);
    expect(activityNotesEnabled('')).toBe(false);
    expect(activityNotesEnabled('TRUE')).toBe(false);
    expect(activityNotesEnabled('1')).toBe(false);
    expect(activityNotesEnabled('true')).toBe(true);
    expect(activityNotesEnabled('true') && activitiesEnabled('TRUE')).toBe(false);
  });

  it('logs a static note line once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logActivityNotesUnavailableOnce();
    logActivityNotesUnavailableOnce();
    logActivityNotesReadFailedOnce();
    logActivityNotesReadFailedOnce();
    expect(warn.mock.calls.map((call) => call[0])).toEqual([
      '[activity-notes] unavailable',
      '[activity-notes] read failed',
    ]);
  });
});
