import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRAWINGS_ADMIN_FLAG, drawingsAdminEnabled } from '@/lib/drawings/flag';

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
