import { describe, expect, it } from 'vitest';
import { BRIEFINGS_FLAG, briefingsEnabled } from '@/lib/briefings/flag';

describe('briefingsEnabled', () => {
  it('is on only for the exact string true', () => {
    expect(BRIEFINGS_FLAG).toBe('E06_BRIEFINGS_ENABLED');
    expect(briefingsEnabled(undefined)).toBe(false);
    expect(briefingsEnabled('')).toBe(false);
    expect(briefingsEnabled('TRUE')).toBe(false);
    expect(briefingsEnabled('1')).toBe(false);
    expect(briefingsEnabled(' true')).toBe(false);
    expect(briefingsEnabled('true')).toBe(true);
  });
});
