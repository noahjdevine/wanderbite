'use server';

import { format } from 'date-fns';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireUser } from '@/lib/auth/require-user';
import { unwrapJoin } from '@/lib/supabase/unwrap-join';
import { levelFromXp, xpFromVerifiedVisits } from '@/lib/progress/rules';

export type UserStatsHistoryItem = {
  restaurantName: string;
  date: string;
};

export type UserStatsBadge = {
  id: string;
  name: string;
  description: string;
  icon: string;
  isEarned: boolean;
  awardedAt: string | null;
};

export type UserStats = {
  xp: number;
  level: number;
  currentLevelName: string;
  nextLevelXp: number | null;
  /** 0-100; 100 when max level to avoid divide-by-zero */
  progressPercent: number;
  redemptionCount: number;
  history: UserStatsHistoryItem[];
  badges: UserStatsBadge[];
};

export type GetUserStatsResult =
  | { ok: true; data: UserStats }
  | { ok: false; error: string };

/**
 * Fetches user stats: XP, level, and redemption history.
 */
export async function getUserStats(): Promise<GetUserStatsResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const supabase = getSupabaseAdmin();

    const { data: redemptions, error } = await supabase
      .from('redemptions')
      .select('restaurant_id, verified_at, restaurants(name)')
      .eq('user_id', auth.userId)
      .eq('status', 'verified')
      .order('verified_at', { ascending: false });

    if (error) {
      return { ok: false, error: error.message };
    }

    const list = redemptions ?? [];
    const redemptionCount = list.length;
    const xp = xpFromVerifiedVisits(redemptionCount);
    const levelInfo = levelFromXp(xp);
    const level = levelInfo.level;
    const currentLevelName = levelInfo.name;
    const nextLevelXp = levelInfo.nextLevel?.xp ?? null;
    const progressPercent = levelInfo.progressPercent;

    const history: UserStatsHistoryItem[] = list.map((row) => {
      const r = row as {
        restaurant_id: string;
        verified_at: string | null;
        restaurants: { name: string } | { name: string }[] | null;
      };
      const restaurantRel = unwrapJoin(r.restaurants);
      const date = r.verified_at
        ? format(new Date(r.verified_at), 'PP')
        : '—';
      const restaurantName =
        restaurantRel?.name ?? 'Unknown restaurant';
      return { restaurantName, date };
    });

    const { data: allBadges, error: badgesErr } = await supabase
      .from('badges')
      .select('id, name, description, icon')
      .order('id');

    const allBadgesList = badgesErr ? [] : (allBadges ?? []);

    const { data: userBadges, error: userBadgesErr } = await supabase
      .from('user_badges')
      .select('badge_id, awarded_at')
      .eq('user_id', auth.userId);

    const userBadgesMap = new Map<string, string>();
    if (!userBadgesErr && userBadges) {
      for (const ub of userBadges as { badge_id: string; awarded_at: string }[]) {
        userBadgesMap.set(ub.badge_id, ub.awarded_at);
      }
    }

    const badgesRaw = allBadgesList as {
      id: string;
      name: string;
      description: string;
      icon: string;
    }[];
    const badges: UserStatsBadge[] = badgesRaw.map((b) => {
      const awardedAt = userBadgesMap.get(b.id) ?? null;
      return {
        id: b.id,
        name: b.name,
        description: b.description,
        icon: b.icon,
        isEarned: awardedAt != null,
        awardedAt,
      };
    });
    badges.sort((a, b) => (a.isEarned === b.isEarned ? 0 : a.isEarned ? -1 : 1));

    return {
      ok: true,
      data: {
        xp,
        level,
        currentLevelName,
        nextLevelXp,
        progressPercent,
        redemptionCount,
        history,
        badges,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false, error: message };
  }
}
