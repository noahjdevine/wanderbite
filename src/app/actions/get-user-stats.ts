'use server';

import { format } from 'date-fns';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const XP_PER_REDEMPTION = 100;

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

/** Tier structure aligned with How It Works and Journey (0, 500, 1500, 3000 XP). */
const LEVELS: {
  level: number;
  minXp: number;
  nextLevelXp: number | null;
  name: string;
}[] = [
  { level: 1, minXp: 0, nextLevelXp: 500, name: 'The Explorer' },
  { level: 2, minXp: 500, nextLevelXp: 1500, name: 'The Tastemaker' },
  { level: 3, minXp: 1500, nextLevelXp: 3000, name: 'The Connoisseur' },
  { level: 4, minXp: 3000, nextLevelXp: null, name: 'The Local Legend' },
];

function getLevelInfo(xp: number): {
  level: number;
  currentLevelName: string;
  nextLevelXp: number | null;
  levelStartXp: number;
  progressPercent: number;
} {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    const tier = LEVELS[i];
    if (xp >= tier.minXp) {
      const nextLevelXp = tier.nextLevelXp;
      if (nextLevelXp == null) {
        return {
          level: tier.level,
          currentLevelName: tier.name,
          nextLevelXp: null,
          levelStartXp: tier.minXp,
          progressPercent: 100,
        };
      }
      const range = nextLevelXp - tier.minXp;
      const progressInLevel = Math.min(xp - tier.minXp, range);
      const progressPercent = range > 0
        ? Math.min(100, Math.round((progressInLevel / range) * 100))
        : 100;
      return {
        level: tier.level,
        currentLevelName: tier.name,
        nextLevelXp,
        levelStartXp: tier.minXp,
        progressPercent,
      };
    }
  }
  const tier = LEVELS[0];
  return {
    level: tier.level,
    currentLevelName: tier.name,
    nextLevelXp: tier.nextLevelXp,
    levelStartXp: tier.minXp,
    progressPercent: Math.min(
      100,
      tier.nextLevelXp != null
        ? Math.round((xp / tier.nextLevelXp) * 100)
        : 100
    ),
  };
}

/**
 * Fetches user stats: XP, level, and redemption history.
 */
export async function getUserStats(userId: string): Promise<GetUserStatsResult> {
  try {
    const supabase = getSupabaseAdmin();

    const { data: redemptions, error } = await supabase
      .from('redemptions')
      .select('restaurant_id, verified_at, restaurants(name)')
      .eq('user_id', userId)
      .eq('status', 'verified')
      .order('verified_at', { ascending: false });

    if (error) {
      return { ok: false, error: error.message };
    }

    const list = redemptions ?? [];
    const redemptionCount = list.length;
    const xp = redemptionCount * XP_PER_REDEMPTION;
    const { level, currentLevelName, nextLevelXp, progressPercent } =
      getLevelInfo(xp);

    const history: UserStatsHistoryItem[] = list.map((row) => {
      const r = row as unknown as {
        restaurant_id: string;
        verified_at: string | null;
        restaurants: { name: string } | null;
      };
      const date = r.verified_at
        ? format(new Date(r.verified_at), 'PP')
        : '—';
      const restaurantName =
        r.restaurants?.name ?? 'Unknown restaurant';
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
      .eq('user_id', userId);

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
