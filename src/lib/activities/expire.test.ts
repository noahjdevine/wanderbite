import { describe, expect, it } from 'vitest';
import { activitiesToExpire, type ExpirableActivity } from '@/lib/activities/expire';
import { chicagoCalendarDate } from '@/lib/activities/match';

const EVENING = new Date('2026-11-05T05:30:00.000Z');
const AFTER_MIDNIGHT = new Date('2026-11-05T06:30:00.000Z');

function row(overrides: Partial<ExpirableActivity> = {}): ExpirableActivity {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Sample Dated Fair',
    status: 'active',
    valid_until: '2026-11-03',
    ...overrides,
  };
}

describe('dated activity expiry', () => {
  it('uses the America/Chicago date, including 11:30 PM and 12:30 AM', () => {
    expect(chicagoCalendarDate(EVENING)).toBe('2026-11-04');
    expect(chicagoCalendarDate(AFTER_MIDNIGHT)).toBe('2026-11-05');
    const yesterday = row({ id: 'ended', name: 'Ended', valid_until: '2026-11-03' });
    const throughEvening = row({ id: 'evening', name: 'Through evening', valid_until: '2026-11-04' });
    const undated = row({ id: 'open', name: 'Open', valid_until: null });
    const paused = row({ id: 'paused', name: 'Paused', status: 'paused', valid_until: '2026-11-01' });
    expect(activitiesToExpire([yesterday, throughEvening, undated, paused], EVENING).map((item) => item.name)).toEqual([
      'Ended',
    ]);
    expect(activitiesToExpire([yesterday, throughEvening, undated, paused], AFTER_MIDNIGHT).map((item) => item.id)).toEqual([
      'ended',
      'evening',
    ]);
  });

  it('does not select a row whose valid_until is today or later', () => {
    expect(activitiesToExpire([row({ valid_until: '2026-11-04' })], EVENING)).toEqual([]);
    expect(activitiesToExpire([row({ valid_until: '2026-11-18' })], EVENING)).toEqual([]);
    expect(activitiesToExpire([row({ status: 'expired', valid_until: '2026-11-01' })], EVENING)).toEqual([]);
  });
});
