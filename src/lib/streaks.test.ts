import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chicagoMonthStart } from '@/lib/cron-period';

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { calculateStreak, monthlyStreakFromVerifiedAt, type MonthlyStreak } from './streaks';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

function requireStreak(result: MonthlyStreak | null): MonthlyStreak {
  if (!result) throw new Error('expected a streak');
  return result;
}

type MockRow = { verified_at: string };

function mockSupabaseWithRows(rows: MockRow[]) {
  const fromMock = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  (getSupabaseAdmin as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn().mockReturnValue(fromMock),
  });
}

function mockSupabaseWithError(message: string) {
  const fromMock = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: null, error: { message } }),
  };
  (getSupabaseAdmin as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn().mockReturnValue(fromMock),
  });
}

describe('calculateStreak', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Pin "now" to the 20th of June 2026 so tests are deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns zeros when the user has no verified redemptions', async () => {
    mockSupabaseWithRows([]);
    const result = requireStreak(await calculateStreak('user-1'));
    expect(result).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      totalMonthsActive: 0,
    });
  });

  it('returns null when the supabase query errors', async () => {
    mockSupabaseWithError('boom');
    const result = await calculateStreak('user-1');
    expect(result).toBeNull();
  });

  it('counts one month active when there is a single redemption in the current month', async () => {
    mockSupabaseWithRows([{ verified_at: '2026-06-05T10:00:00Z' }]);
    const result = requireStreak(await calculateStreak('user-1'));
    expect(result.totalMonthsActive).toBe(1);
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(1);
  });

  it('handles consecutive months → currentStreak grows', async () => {
    mockSupabaseWithRows([
      { verified_at: '2026-04-10T10:00:00Z' },
      { verified_at: '2026-05-15T10:00:00Z' },
      { verified_at: '2026-06-02T10:00:00Z' },
    ]);
    const result = requireStreak(await calculateStreak('user-1'));
    expect(result.totalMonthsActive).toBe(3);
    expect(result.longestStreak).toBe(3);
    expect(result.currentStreak).toBe(3);
  });

  it('counts longest streak across a gap', async () => {
    mockSupabaseWithRows([
      { verified_at: '2025-12-10T10:00:00Z' },
      { verified_at: '2026-01-05T10:00:00Z' },
      { verified_at: '2026-02-15T10:00:00Z' },
      // gap: nothing in March
      { verified_at: '2026-05-10T10:00:00Z' },
      { verified_at: '2026-06-02T10:00:00Z' },
    ]);
    const result = requireStreak(await calculateStreak('user-1'));
    expect(result.totalMonthsActive).toBe(5);
    expect(result.longestStreak).toBe(3); // Dec → Jan → Feb
    expect(result.currentStreak).toBe(2); // May → Jun (current)
  });

  it('current streak counts the prior month if they have not redeemed yet this month', async () => {
    mockSupabaseWithRows([
      { verified_at: '2026-04-10T10:00:00Z' },
      { verified_at: '2026-05-15T10:00:00Z' },
      // no June yet (current month is June)
    ]);
    const result = requireStreak(await calculateStreak('user-1'));
    expect(result.totalMonthsActive).toBe(2);
    expect(result.longestStreak).toBe(2);
    // Streak anchors to May since June has nothing yet.
    expect(result.currentStreak).toBe(2);
  });

  it('current streak is 0 if last verified month is older than the prior month', async () => {
    mockSupabaseWithRows([
      { verified_at: '2026-03-15T10:00:00Z' },
      // nothing in April or May or June
    ]);
    const result = requireStreak(await calculateStreak('user-1'));
    expect(result.totalMonthsActive).toBe(1);
    expect(result.longestStreak).toBe(1);
    expect(result.currentStreak).toBe(0); // gap broke the chain
  });

  it('treats two redemptions in the same month as one month active', async () => {
    mockSupabaseWithRows([
      { verified_at: '2026-06-05T10:00:00Z' },
      { verified_at: '2026-06-20T10:00:00Z' },
    ]);
    const result = requireStreak(await calculateStreak('user-1'));
    expect(result.totalMonthsActive).toBe(1);
    expect(result.currentStreak).toBe(1);
  });
});

describe('monthlyStreakFromVerifiedAt', () => {
  const nov3 = new Date('2026-11-03T18:00:00.000Z');

  it('counts Sept and Oct as a streak of 2 on Nov 3 when November is still empty', () => {
    const result = monthlyStreakFromVerifiedAt(
      ['2026-09-15T18:00:00.000Z', '2026-11-01T04:30:00.000Z'],
      nov3,
    );
    expect(chicagoMonthStart(new Date('2026-11-01T04:30:00.000Z'))).toBe('2026-10-01');
    expect(result.currentStreak).toBe(2);
    expect(result.longestStreak).toBe(2);
    expect(result.totalMonthsActive).toBe(2);
  });

  it('keeps a 23:30 America/Chicago month-end visit in October', () => {
    const octoberEve = '2026-11-01T04:30:00.000Z';
    const novemberMidnight = '2026-11-01T05:00:00.000Z';
    expect(chicagoMonthStart(new Date(octoberEve))).toBe('2026-10-01');
    expect(chicagoMonthStart(new Date('2026-11-01T04:59:59.000Z'))).toBe('2026-10-01');
    expect(chicagoMonthStart(new Date(novemberMidnight))).toBe('2026-11-01');
    const result = monthlyStreakFromVerifiedAt([octoberEve], nov3);
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(1);
  });

  it('chains December into January across the year boundary', () => {
    const dec31Chicago = '2027-01-01T05:30:00.000Z';
    const jan1Chicago = '2027-01-01T06:30:00.000Z';
    expect(chicagoMonthStart(new Date(dec31Chicago))).toBe('2026-12-01');
    expect(chicagoMonthStart(new Date(jan1Chicago))).toBe('2027-01-01');
    const duringJanuary = monthlyStreakFromVerifiedAt(
      [dec31Chicago, jan1Chicago],
      new Date('2027-01-15T18:00:00.000Z'),
    );
    expect(duringJanuary.currentStreak).toBe(2);
    expect(duringJanuary.longestStreak).toBe(2);
    const duringFebruary = monthlyStreakFromVerifiedAt(
      [dec31Chicago, jan1Chicago],
      new Date('2027-02-03T18:00:00.000Z'),
    );
    expect(duringFebruary.currentStreak).toBe(2);
    expect(duringFebruary.longestStreak).toBe(2);
    expect(duringFebruary.totalMonthsActive).toBe(2);
  });

  it('returns zeros for an empty history', () => {
    expect(monthlyStreakFromVerifiedAt([], nov3)).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      totalMonthsActive: 0,
    });
  });

  it('breaks the current streak across a gap and keeps the longer run', () => {
    const result = monthlyStreakFromVerifiedAt(
      [
        '2025-12-15T18:00:00.000Z',
        '2026-01-15T18:00:00.000Z',
        '2026-02-15T18:00:00.000Z',
        '2026-10-15T18:00:00.000Z',
      ],
      nov3,
    );
    expect(result.totalMonthsActive).toBe(4);
    expect(result.longestStreak).toBe(3);
    expect(result.currentStreak).toBe(1);
  });

  it('counts two timestamps in one Chicago month as one month', () => {
    const result = monthlyStreakFromVerifiedAt(
      ['2026-10-02T15:00:00.000Z', '2026-11-01T04:30:00.000Z'],
      nov3,
    );
    expect(result.totalMonthsActive).toBe(1);
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(1);
  });
});
