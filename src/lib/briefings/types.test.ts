import { describe, expect, it } from 'vitest';
import { formatBriefingChecked } from '@/lib/briefings/types';

describe('formatBriefingChecked', () => {
  it('uses the America/Chicago calendar date across the UTC midnight boundary', () => {
    expect(formatBriefingChecked('2026-11-05T05:30:00.000Z')).toBe('Nov 4, 2026');
    expect(formatBriefingChecked('2026-11-05T06:00:00.000Z')).toBe('Nov 5, 2026');
    expect(formatBriefingChecked('2026-07-15T04:30:00.000Z')).toBe('Jul 14, 2026');
    expect(formatBriefingChecked('not-a-date')).toBeNull();
  });
});
