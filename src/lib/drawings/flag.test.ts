import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DRAWINGS_ADMIN_ACTIONS_FLAG,
  DRAWINGS_ADMIN_FLAG,
  drawingsAdminActionsEnabled,
  drawingsAdminEnabled,
} from '@/lib/drawings/flag';

describe('drawingsAdminEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is true only when the value is exactly true', () => {
    expect(DRAWINGS_ADMIN_FLAG).toBe('E09_DRAWINGS_ADMIN_ENABLED');
    expect(drawingsAdminEnabled(undefined)).toBe(false);
    expect(drawingsAdminEnabled('')).toBe(false);
    expect(drawingsAdminEnabled('TRUE')).toBe(false);
    expect(drawingsAdminEnabled('True')).toBe(false);
    expect(drawingsAdminEnabled('1')).toBe(false);
    expect(drawingsAdminEnabled(' true')).toBe(false);
    expect(drawingsAdminEnabled('true ')).toBe(false);
    expect(drawingsAdminEnabled('false')).toBe(false);
    expect(drawingsAdminEnabled('true')).toBe(true);
  });

  it('reads E09_DRAWINGS_ADMIN_ENABLED when no argument is passed', () => {
    vi.stubEnv('E09_DRAWINGS_ADMIN_ENABLED', '');
    expect(drawingsAdminEnabled()).toBe(false);
    vi.stubEnv('E09_DRAWINGS_ADMIN_ENABLED', 'TRUE');
    expect(drawingsAdminEnabled()).toBe(false);
    vi.stubEnv('E09_DRAWINGS_ADMIN_ENABLED', 'true');
    expect(drawingsAdminEnabled()).toBe(true);
  });
});

describe('drawingsAdminActionsEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is true only when both flags are exactly true', () => {
    expect(DRAWINGS_ADMIN_ACTIONS_FLAG).toBe('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED');
    const off = [undefined, '', 'TRUE', 'True', '1', ' true', 'true ', 'false'] as const;
    for (const actionsValue of off) {
      expect(drawingsAdminActionsEnabled(actionsValue, 'true')).toBe(false);
    }
    for (const adminValue of off) {
      expect(drawingsAdminActionsEnabled('true', adminValue)).toBe(false);
    }
    expect(drawingsAdminActionsEnabled('true', 'true')).toBe(true);
  });

  it('reads both env vars when no argument is passed', () => {
    vi.stubEnv('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', 'true');
    vi.stubEnv('E09_DRAWINGS_ADMIN_ENABLED', '');
    expect(drawingsAdminActionsEnabled()).toBe(false);
    vi.stubEnv('E09_DRAWINGS_ADMIN_ENABLED', 'true');
    vi.stubEnv('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', 'TRUE');
    expect(drawingsAdminActionsEnabled()).toBe(false);
    vi.stubEnv('E09_DRAWINGS_ADMIN_ACTIONS_ENABLED', 'true');
    expect(drawingsAdminActionsEnabled()).toBe(true);
  });
});
