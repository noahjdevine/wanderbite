import { format, startOfMonth, subMonths } from 'date-fns';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type StreakBadge = {
  /** Display name including emoji when applicable */
  label: string;
  /** Months of longest streak required to earn this badge */
  thresholdMonths: number;
};

const BADGE_MILESTONES: StreakBadge[] = [
  { label: 'First Bite 🔥', thresholdMonths: 1 },
  { label: 'Getting Hooked', thresholdMonths: 3 },
  { label: 'Wanderbite Regular', thresholdMonths: 6 },
  { label: 'Explorer', thresholdMonths: 12 },
  { label: 'Legend', thresholdMonths: 24 },
];

/** Highest badge earned from longest-ever consecutive-month streak (null if none yet). */
export function getStreakBadgeForLongest(
  longestStreak: number
): StreakBadge | null {
  if (longestStreak < 1) return null;
  let earned = BADGE_MILESTONES[0];
  for (const b of BADGE_MILESTONES) {
    if (longestStreak >= b.thresholdMonths) earned = b;
  }
  return earned;
}

/** Next milestone month count after `longestStreak`, or null if Legend already reached. */
export function getNextBadgeMilestoneMonths(longestStreak: number): number | null {
  for (const b of BADGE_MILESTONES) {
    if (longestStreak < b.thresholdMonths) return b.thresholdMonths;
  }
  return null;
}

function isImmediatePreviousMonth(prevKey: string, curKey: string): boolean {
  return prevMonthKey(curKey) === prevKey;
}

/** Progress 0–1 from current badge floor toward next milestone (by longest streak). */
export function getBadgeProgress(longestStreak: number): number {
  if (longestStreak < 1) return 0;
  const next = getNextBadgeMilestoneMonths(longestStreak);
  if (next == null) return 1;
  const earned = getStreakBadgeForLongest(longestStreak);
  if (!earned) return 0;
  const prev = earned.thresholdMonths;
  if (next <= prev) return 1;
  return Math.min(1, Math.max(0, (longestStreak - prev) / (next - prev)));
}

function monthKeyFromDate(d: Date): string {
  return format(startOfMonth(d), 'yyyy-MM');
}

function prevMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return format(startOfMonth(subMonths(d, 1)), 'yyyy-MM');
}

/**
 * Counts consecutive calendar months with at least one verified redemption.
 */
export async function calculateStreak(userId: string): Promise<{
  currentStreak: number;
  longestStreak: number;
  totalMonthsActive: number;
}> {
  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin
    .from('redemptions')
    .select('verified_at')
    .eq('user_id', userId)
    .eq('status', 'verified')
    .not('verified_at', 'is', null)
    .order('verified_at', { ascending: true });

  if (error) {
    console.error('[streaks] calculateStreak:', error.message);
    return { currentStreak: 0, longestStreak: 0, totalMonthsActive: 0 };
  }

  const monthSet = new Set<string>();
  for (const row of rows ?? []) {
    const at = (row as { verified_at: string }).verified_at;
    if (!at) continue;
    monthSet.add(monthKeyFromDate(new Date(at)));
  }

  const months = [...monthSet].sort();
  const totalMonthsActive = months.length;

  if (months.length === 0) {
    return { currentStreak: 0, longestStreak: 0, totalMonthsActive: 0 };
  }

  let longestStreak = 1;
  let run = 1;
  for (let i = 1; i < months.length; i++) {
    if (isImmediatePreviousMonth(months[i - 1], months[i])) {
      run++;
    } else {
      run = 1;
    }
    longestStreak = Math.max(longestStreak, run);
  }

  const now = new Date();
  const currentMonthKey = monthKeyFromDate(now);
  const prevMonthKeyStr = monthKeyFromDate(subMonths(startOfMonth(now), 1));

  const hasCurrent = monthSet.has(currentMonthKey);
  const anchorKey = hasCurrent ? currentMonthKey : prevMonthKeyStr;

  let currentStreak = 0;
  if (monthSet.has(anchorKey)) {
    let key: string | null = anchorKey;
    while (key && monthSet.has(key)) {
      currentStreak++;
      key = prevMonthKey(key);
    }
  }

  return { currentStreak, longestStreak, totalMonthsActive };
}
