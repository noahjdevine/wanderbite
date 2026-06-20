import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { calculateStreak } from './streaks';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

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
    const result = await calculateStreak('user-1');
    expect(result).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      totalMonthsActive: 0,
    });
  });

  it('returns zeros when the supabase query errors', async () => {
    mockSupabaseWithError('boom');
    const result = await calculateStreak('user-1');
    expect(result).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      totalMonthsActive: 0,
    });
  });

  it('counts one month active when there is a single redemption in the current month', async () => {
    mockSupabaseWithRows([{ verified_at: '2026-06-05T10:00:00Z' }]);
    const result = await calculateStreak('user-1');
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
    const result = await calculateStreak('user-1');
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
    const result = await calculateStreak('user-1');
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
    const result = await calculateStreak('user-1');
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
    const result = await calculateStreak('user-1');
    expect(result.totalMonthsActive).toBe(1);
    expect(result.longestStreak).toBe(1);
    expect(result.currentStreak).toBe(0); // gap broke the chain
  });

  it('treats two redemptions in the same month as one month active', async () => {
    mockSupabaseWithRows([
      { verified_at: '2026-06-05T10:00:00Z' },
      { verified_at: '2026-06-20T10:00:00Z' },
    ]);
    const result = await calculateStreak('user-1');
    expect(result.totalMonthsActive).toBe(1);
    expect(result.currentStreak).toBe(1);
  });
});
