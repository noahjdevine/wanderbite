import { chicagoMonthStart } from '@/lib/cron-period';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type MonthlyStreak = {
  currentStreak: number;
  longestStreak: number;
  totalMonthsActive: number;
};

/** Previous America/Chicago month key. `chicagoMonthStart` returns `YYYY-MM-01`. */
export function previousChicagoMonth(monthStart: string): string {
  const year = Number(monthStart.slice(0, 4));
  const month = Number(monthStart.slice(5, 7));
  if (month === 1) return `${year - 1}-12-01`;
  return `${year}-${String(month - 1).padStart(2, '0')}-01`;
}

/**
 * Consecutive America/Chicago months with at least one verified timestamp.
 * Month keys come from `chicagoMonthStart`, so the result does not follow
 * the server's local timezone.
 */
export function monthlyStreakFromVerifiedAt(
  verifiedAt: readonly (string | null | undefined)[],
  now: Date,
): MonthlyStreak {
  const monthSet = new Set<string>();
  for (const at of verifiedAt) {
    if (!at) continue;
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) continue;
    monthSet.add(chicagoMonthStart(date));
  }

  const months = [...monthSet].sort();
  const totalMonthsActive = months.length;
  if (months.length === 0) {
    return { currentStreak: 0, longestStreak: 0, totalMonthsActive: 0 };
  }

  let longestStreak = 1;
  let run = 1;
  for (let i = 1; i < months.length; i++) {
    if (previousChicagoMonth(months[i]) === months[i - 1]) {
      run += 1;
    } else {
      run = 1;
    }
    longestStreak = Math.max(longestStreak, run);
  }

  const currentMonth = chicagoMonthStart(now);
  const anchor = monthSet.has(currentMonth) ? currentMonth : previousChicagoMonth(currentMonth);
  let currentStreak = 0;
  if (monthSet.has(anchor)) {
    let key: string | null = anchor;
    while (key && monthSet.has(key)) {
      currentStreak += 1;
      key = previousChicagoMonth(key);
    }
  }

  return { currentStreak, longestStreak, totalMonthsActive };
}

/**
 * Thin read wrapper around `monthlyStreakFromVerifiedAt`.
 * A query failure returns null. It does not report a streak of zero.
 */
export async function calculateStreak(userId: string): Promise<MonthlyStreak | null> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('redemptions')
      .select('verified_at')
      .eq('user_id', userId)
      .eq('status', 'verified')
      .not('verified_at', 'is', null)
      .order('verified_at', { ascending: true });

    if (error) {
      console.error('[streaks] calculateStreak:', error.message);
      return null;
    }

    const verifiedAt = (data ?? []).map((row) => row.verified_at);
    return monthlyStreakFromVerifiedAt(verifiedAt, new Date());
  } catch (error) {
    console.error(
      '[streaks] calculateStreak:',
      error instanceof Error ? error.message : 'unknown',
    );
    return null;
  }
}
