import 'server-only';

import { arrivalSessionsEnabled, visitProblemsEnabled } from '@/lib/boost/flag';
import {
  recordedBoostSettlementFromRow,
  SETTLEMENT_COLUMNS,
  type StoredRedemptionSettlement,
} from '@/lib/boost/settlement-store';
import { lowestSealedBase } from '@/lib/offers/sealed-base';
import { countDistinctNeighborhoods } from '@/lib/progress/neighborhoods';
import {
  assembleBadges,
  formatEarnedOn,
  levelFromXp,
  xpFromVerifiedVisits,
  type CatalogBadge,
} from '@/lib/progress/rules';
import {
  savingsCentsForVisits,
  storedCentsFromParsedSettlement,
} from '@/lib/progress/savings-cents';
import { monthlyStreakFromVerifiedAt } from '@/lib/streaks';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  deriveVisitStatus,
  visitStatusCountsAsVisit,
  type VisitStatus,
} from '@/lib/visits/visit-status';
import type { Json } from '@/types/database.types';

export type MemberBadge = {
  id: string;
  name: string;
  earnedAt: string | null;
  progress: { current: number; target: number };
  description: string;
  icon: string;
};

export type MemberLevel = {
  level: number;
  name: string;
  xp: number;
};

/**
 * Read model for Journey, Passport, and Challenges.
 * `neighborhoods` is a count because `restaurants.neighborhood` exists.
 * `xp` / `level` use the existing 100 XP rule. `savings.amount` is dollars.
 * With the arrival flag off it is the sealed lowest tier, or 1000 cents when
 * a visit has no sealed tier, and `isEstimate` is true. With the flag on, a
 * stored settlement snapshot replaces that figure per visit.
 * `totalMonthsActive` is the distinct Chicago months already shown on Challenges.
 */
export type MemberProgress =
  | { error: 'progress_unavailable' }
  | {
      verifiedVisits: number;
      pendingVisits: number;
      uniqueRestaurants: number;
      neighborhoods: number | null;
      currentMonthlyStreak: number;
      longestStreak: number;
      totalMonthsActive: number;
      xp: number;
      level: number;
      nextLevel: MemberLevel | null;
      badges: MemberBadge[];
      savings: { amount: number | null; isEstimate: boolean; corrected: boolean };
    };

export type PresentedProgress = {
  progressUnavailable: boolean;
  streak: {
    currentStreak: number;
    longestStreak: number;
    totalMonthsActive: number;
  };
  earnedBadges: { id: string; name: string; earnedOn: string | null }[];
  showFirstBiteLocked: boolean;
  nextBadge: { name: string; current: number; target: number } | null;
  uniqueRestaurants: number;
  neighborhoods: number | null;
  verifiedVisits: number;
};

type RedemptionRow = {
  id: string;
  status: string | null;
  verified_at: string | null;
  expires_at: string;
  restaurant_id: string | null;
  challenge_item_id: string | null;
};

const UNAVAILABLE: MemberProgress = { error: 'progress_unavailable' };

function fail(message: string): MemberProgress {
  console.error('[progress] getMemberProgress:', message);
  return UNAVAILABLE;
}

function uniqueIds(ids: readonly (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

type ItemClock = {
  id: string;
  offer_version_id: string | null;
  status: string | null;
  redemption_deadline: string | null;
};

/**
 * A bite note does not add a second visit, so this read does not load
 * `bite_notes`. A verified redemption is `verified` here and still counts;
 * `note_added` counts through the same helper when a caller passes the row.
 */
function statusForRow(
  row: RedemptionRow,
  item: ItemClock | undefined,
  now: Date,
): VisitStatus {
  return deriveVisitStatus({
    item: {
      status: item?.status ?? 'assigned',
      redemptionDeadline: item?.redemption_deadline ?? null,
    },
    redemption: {
      status: row.status ?? '',
      verifiedAt: row.verified_at,
      expiresAt: row.expires_at,
    },
    note: null,
    now,
  });
}

type Admin = ReturnType<typeof getSupabaseAdmin>;

/**
 * Settlement columns exist only after 20261108050005.
 * Call this only when the arrival flag is exactly true. A missing column or
 * any other read error returns null so Progress keeps today's sealed math.
 * This uses the same admin client as the rest of the loader.
 */
async function loadStoredSavingsCents(
  admin: Admin,
  userId: string,
  redemptionIds: readonly string[],
): Promise<Map<string, number | null> | null> {
  try {
    const { data, error } = await admin
      .from('redemptions')
      .select(`id, ${SETTLEMENT_COLUMNS}`)
      .eq('user_id', userId)
      .in('id', [...redemptionIds]);
    if (error) {
      console.error('[progress] settlement read:', error.message);
      return null;
    }
    const byId = new Map<string, number | null>();
    for (const row of (data ?? []) as Array<StoredRedemptionSettlement & { id: string }>) {
      byId.set(row.id, storedCentsFromParsedSettlement(recordedBoostSettlementFromRow(row)));
    }
    return byId;
  } catch (error) {
    console.error(
      '[progress] settlement read:',
      error instanceof Error ? error.message : 'unknown',
    );
    return null;
  }
}

/**
 * Admin savings corrections exist only after 20261110004140. Call this only
 * when E07_VISIT_PROBLEMS_ENABLED is exactly true. A missing table or any
 * other read error returns null so Progress keeps the uncorrected total.
 */
async function loadSavingsCorrections(
  admin: Admin,
  userId: string,
  redemptionIds: readonly string[],
): Promise<Map<string, number> | null> {
  try {
    const { data, error } = await admin
      .from('visit_problem_savings_adjustments')
      .select('redemption_id, corrected_cents')
      .eq('user_id', userId)
      .in('redemption_id', [...redemptionIds]);
    if (error) {
      console.error('[progress] savings correction read:', error.message);
      return null;
    }
    const byId = new Map<string, number>();
    for (const row of (data ?? []) as Array<{ redemption_id: string; corrected_cents: number }>) {
      if (byId.has(row.redemption_id)) continue;
      if (
        typeof row.corrected_cents !== 'number' ||
        !Number.isInteger(row.corrected_cents) ||
        row.corrected_cents < 0
      ) {
        continue;
      }
      byId.set(row.redemption_id, row.corrected_cents);
    }
    return byId;
  } catch (error) {
    console.error(
      '[progress] savings correction read:',
      error instanceof Error ? error.message : 'unknown',
    );
    return null;
  }
}

/**
 * Pure read of one member's progress. Callers pass the signed-in user id
 * from the server. This function never inserts or updates.
 */
export async function getMemberProgress(
  userId: string,
  now = new Date(),
): Promise<MemberProgress> {
  try {
    const admin = getSupabaseAdmin();
    const { data: redemptionData, error: redemptionError } = await admin
      .from('redemptions')
      .select('id, status, verified_at, expires_at, restaurant_id, challenge_item_id')
      .eq('user_id', userId);

    if (redemptionError) return fail(redemptionError.message);
    const redemptions = (redemptionData ?? []) as RedemptionRow[];
    const itemIds = uniqueIds(redemptions.map((row) => row.challenge_item_id));
    const itemById = new Map<string, ItemClock>();
    if (itemIds.length > 0) {
      const { data: itemData, error: itemError } = await admin
        .from('challenge_items')
        .select('id, offer_version_id, status, redemption_deadline')
        .in('id', itemIds);
      if (itemError) return fail(itemError.message);
      for (const item of (itemData ?? []) as ItemClock[]) itemById.set(item.id, item);
    }

    const classified = redemptions.map((row) => ({
      row,
      status: statusForRow(
        row,
        row.challenge_item_id ? itemById.get(row.challenge_item_id) : undefined,
        now,
      ),
    }));
    const verified = classified
      .filter((entry) => visitStatusCountsAsVisit(entry.status))
      .map((entry) => entry.row);
    const pendingVisits = classified.filter((entry) => entry.status === 'code_issued').length;
    const verifiedVisits = verified.length;
    const restaurantIds = uniqueIds(verified.map((row) => row.restaurant_id));

    const verifiedAtAsc = verified
      .flatMap((row) => (row.verified_at ? [row.verified_at] : []))
      .filter((at) => !Number.isNaN(new Date(at).getTime()))
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    let neighborhoods = 0;
    if (restaurantIds.length > 0) {
      const { data: restaurantData, error: restaurantError } = await admin
        .from('restaurants')
        .select('id, neighborhood')
        .in('id', restaurantIds);
      if (restaurantError) return fail(restaurantError.message);
      neighborhoods = countDistinctNeighborhoods(
        (restaurantData ?? []).map((row) => row.neighborhood),
      );
    }

    const sealedCentsByItem = new Map<string, number>();
    const savingsItemIds = uniqueIds(verified.map((row) => row.challenge_item_id));
    if (savingsItemIds.length > 0) {
      const items = savingsItemIds.flatMap((id) => {
        const item = itemById.get(id);
        return item ? [item] : [];
      });
      const versionIds = uniqueIds(items.map((item) => item.offer_version_id));
      const centsByVersion = new Map<string, number>();
      if (versionIds.length > 0) {
        const { data: versionData, error: versionError } = await admin
          .from('offer_versions')
          .select('id, tiers')
          .in('id', versionIds);
        if (versionError) return fail(versionError.message);
        for (const version of versionData ?? []) {
          const base = lowestSealedBase((version as { tiers: Json }).tiers);
          if (base) centsByVersion.set(version.id, base.discount_amount_cents);
        }
      }
      for (const item of items) {
        if (!item.offer_version_id) continue;
        const cents = centsByVersion.get(item.offer_version_id);
        if (cents != null) sealedCentsByItem.set(item.id, cents);
      }
    }

    const storedById =
      arrivalSessionsEnabled() && verified.length > 0
        ? await loadStoredSavingsCents(
            admin,
            userId,
            verified.map((row) => row.id),
          )
        : null;
    const correctedById =
      visitProblemsEnabled() && verified.length > 0
        ? await loadSavingsCorrections(
            admin,
            userId,
            verified.map((row) => row.id),
          )
        : new Map<string, number>();
    const savingsVisits = verified.map((row) => ({
      sealedCents: row.challenge_item_id ? sealedCentsByItem.get(row.challenge_item_id) : undefined,
      storedCents: storedById ? (storedById.get(row.id) ?? null) : null,
      correctedCents: correctedById ? (correctedById.get(row.id) ?? null) : null,
    }));
    const savings = savingsCentsForVisits(savingsVisits, {
      useStoredSettlements: storedById != null,
    });
    const savingsCorrected = savingsVisits.some(
      (visit) => typeof visit.correctedCents === 'number',
    );

    const { data: badgeData, error: badgeError } = await admin
      .from('badges')
      .select('id, name, description, icon')
      .order('id');
    if (badgeError) return fail(badgeError.message);

    const { data: userBadgeData, error: userBadgeError } = await admin
      .from('user_badges')
      .select('badge_id, awarded_at')
      .eq('user_id', userId);
    if (userBadgeError) return fail(userBadgeError.message);

    const awardedAtById = new Map<string, string | null>();
    for (const row of userBadgeData ?? []) {
      awardedAtById.set(row.badge_id, row.awarded_at);
    }

    const streak = monthlyStreakFromVerifiedAt(verifiedAtAsc, now);
    const xp = xpFromVerifiedVisits(verifiedVisits);
    const level = levelFromXp(xp);
    const badges = assembleBadges({
      catalog: (badgeData ?? []) as CatalogBadge[],
      awardedAtById,
      verifiedVisits,
      verifiedAtAsc,
    });

    return {
      verifiedVisits,
      pendingVisits,
      uniqueRestaurants: restaurantIds.length,
      neighborhoods,
      currentMonthlyStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      totalMonthsActive: streak.totalMonthsActive,
      xp,
      level: level.level,
      nextLevel: level.nextLevel,
      badges,
      savings: {
        amount: savings.amount,
        isEstimate: savings.isEstimate,
        corrected: savingsCorrected,
      },
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'unknown');
  }
}

/** Shared display values so Journey, Passport, and Challenges cannot diverge. */
export function presentMemberProgress(progress: MemberProgress): PresentedProgress {
  if ('error' in progress) {
    return {
      progressUnavailable: true,
      streak: { currentStreak: 0, longestStreak: 0, totalMonthsActive: 0 },
      earnedBadges: [],
      showFirstBiteLocked: false,
      nextBadge: null,
      uniqueRestaurants: 0,
      neighborhoods: null,
      verifiedVisits: 0,
    };
  }

  const earnedBadges = progress.badges.flatMap((badge) => {
    if (!badge.earnedAt) return [];
    return [
      {
        id: badge.id,
        name: badge.name,
        earnedOn: formatEarnedOn(badge.earnedAt),
      },
    ];
  });
  const firstBite = progress.badges.find((badge) => badge.id === 'first_bite');
  const next = progress.badges.find((badge) => badge.earnedAt == null);

  return {
    progressUnavailable: false,
    streak: {
      currentStreak: progress.currentMonthlyStreak,
      longestStreak: progress.longestStreak,
      totalMonthsActive: progress.totalMonthsActive,
    },
    earnedBadges,
    showFirstBiteLocked: firstBite != null && firstBite.earnedAt == null,
    nextBadge: next
      ? { name: next.name, current: next.progress.current, target: next.progress.target }
      : null,
    uniqueRestaurants: progress.uniqueRestaurants,
    neighborhoods: progress.neighborhoods,
    verifiedVisits: progress.verifiedVisits,
  };
}
