'use server';

import { format } from 'date-fns';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireUser } from '@/lib/auth/require-user';
import { unwrapJoin } from '@/lib/supabase/unwrap-join';
import { levelFromXp, xpFromVerifiedVisits } from '@/lib/progress/rules';
import { deriveVisitStatus, type VisitStatus } from '@/lib/visits/visit-status';

export type UserStatsHistoryNote = {
  id: string;
  note: string | null;
  is_public: boolean;
};

export type UserStatsHistoryItem = {
  redemptionId: string;
  restaurantName: string;
  date: string;
  visitStatus: VisitStatus;
  note: UserStatsHistoryNote | null;
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
      .select('id, restaurant_id, verified_at, expires_at, status, restaurants(name)')
      .eq('user_id', auth.userId)
      .eq('status', 'verified')
      .order('verified_at', { ascending: false });

    if (error) {
      return { ok: false, error: error.message };
    }

    const list = redemptions ?? [];
    const noteByRedemptionId = new Map<string, UserStatsHistoryNote & { note: string | null }>();
    if (list.length > 0) {
      const { data: noteRows, error: noteError } = await supabase
        .from('bite_notes')
        .select('id, redemption_id, note, is_public')
        .in(
          'redemption_id',
          list.map((row) => row.id),
        );
      if (noteError) return { ok: false, error: noteError.message };
      for (const row of noteRows ?? []) {
        noteByRedemptionId.set(row.redemption_id, {
          id: row.id,
          note: row.note,
          is_public: Boolean(row.is_public),
        });
      }
    }
    const now = new Date();
    const redemptionCount = list.length;
    const xp = xpFromVerifiedVisits(redemptionCount);
    const levelInfo = levelFromXp(xp);
    const level = levelInfo.level;
    const currentLevelName = levelInfo.name;
    const nextLevelXp = levelInfo.nextLevel?.xp ?? null;
    const progressPercent = levelInfo.progressPercent;

    const history: UserStatsHistoryItem[] = list.map((row) => {
      const r = row as {
        id: string;
        restaurant_id: string;
        verified_at: string | null;
        expires_at: string | null;
        status: string | null;
        restaurants: { name: string } | { name: string }[] | null;
      };
      const restaurantRel = unwrapJoin(r.restaurants);
      const date = r.verified_at
        ? format(new Date(r.verified_at), 'PP')
        : '—';
      const restaurantName =
        restaurantRel?.name ?? 'Unknown restaurant';
      const memory = noteByRedemptionId.get(r.id) ?? null;
      return {
        redemptionId: r.id,
        restaurantName,
        date,
        note: memory,
        visitStatus: deriveVisitStatus({
          item: { status: 'redeemed', redemptionDeadline: null },
          redemption: {
            status: r.status ?? 'verified',
            verifiedAt: r.verified_at,
            expiresAt: r.expires_at,
          },
          note: memory ? { note: memory.note } : null,
          now,
        }),
      };
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
