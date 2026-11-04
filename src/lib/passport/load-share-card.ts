import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { countDistinctNeighborhoods } from '@/lib/progress/neighborhoods';
import {
  badgeIdsEarnedByVerifiedVisits,
  levelFromXp,
  memberHeaderLabel,
  NEUTRAL_MEMBER_HEADER,
  xpFromVerifiedVisits,
} from '@/lib/progress/rules';
import { PASSPORT_UNNAMED_DISPLAY } from '@/lib/passport/passport-board';
import {
  buildPassportShareCard,
  type PassportShareCardModel,
  type PassportShareCardSource,
} from '@/lib/passport/share-card';
import { monthlyStreakFromVerifiedAt } from '@/lib/streaks';
import type { Database } from '@/types/database.types';
import { unwrapJoin } from '@/lib/supabase/unwrap-join';

export const PASSPORT_SHARE_PROFILE_COLUMNS = 'full_name' as const;

export const PASSPORT_SHARE_REDEMPTION_COLUMNS =
  'status, verified_at, restaurant_id, restaurants(name, cuisine_tags, neighborhood)' as const;

type ShareRestaurant = {
  name: string;
  cuisine_tags: string[] | null;
  neighborhood: string | null;
};

export type ShareRedemptionRow = {
  status: string | null;
  verified_at: string | null;
  restaurant_id: string | null;
  restaurants: ShareRestaurant | ShareRestaurant[] | null;
  id?: string;
  user_id?: string | null;
  token_hash?: string | null;
  encrypted_code?: string | null;
  code_iv?: string | null;
  note?: string | null;
};

export function passportShareSourceFromRows(input: {
  fullName: string | null;
  rows: readonly ShareRedemptionRow[];
  now?: Date;
}): PassportShareCardSource {
  const label = memberHeaderLabel(input.fullName);
  const displayName = label === NEUTRAL_MEMBER_HEADER ? PASSPORT_UNNAMED_DISPLAY : label;
  const verified = input.rows.filter((row) => row.status === 'verified');
  const restaurantIds = [
    ...new Set(verified.flatMap((row) => (row.restaurant_id ? [row.restaurant_id] : []))),
  ];
  const verifiedAt = verified.flatMap((row) => (row.verified_at ? [row.verified_at] : []));
  const streak = monthlyStreakFromVerifiedAt(verifiedAt, input.now ?? new Date());
  const verifiedVisits = verified.length;
  const level = levelFromXp(xpFromVerifiedVisits(verifiedVisits));
  const stamps = verified.flatMap((row) => {
    const restaurant = unwrapJoin(row.restaurants);
    const name = restaurant?.name?.trim() ?? '';
    if (!name || !row.verified_at) return [];
    return [
      {
        restaurantName: name,
        neighborhood: restaurant?.neighborhood ?? null,
        cuisineTags: restaurant?.cuisine_tags ?? [],
        verifiedAt: row.verified_at,
      },
    ];
  });

  return {
    displayName,
    progressUnavailable: false,
    verifiedVisits,
    uniqueRestaurants: restaurantIds.length,
    neighborhoods: countDistinctNeighborhoods(
      verified.map((row) => unwrapJoin(row.restaurants)?.neighborhood),
    ),
    currentStreak: streak.currentStreak,
    level: { level: level.level, name: level.name },
    earnedBadgeCount: badgeIdsEarnedByVerifiedVisits(verifiedVisits).length,
    stamps,
  };
}

export async function loadPassportShareModel(
  supabase: SupabaseClient<Database>,
  userId: string,
  now = new Date(),
): Promise<{ ok: true; model: PassportShareCardModel } | { ok: false }> {
  const [profileResult, redemptionResult] = await Promise.all([
    supabase
      .from('user_profiles')
      .select(PASSPORT_SHARE_PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('redemptions')
      .select(PASSPORT_SHARE_REDEMPTION_COLUMNS)
      .eq('user_id', userId),
  ]);

  if (profileResult.error) {
    console.error('[passport share] profile:', profileResult.error.message);
  }
  if (redemptionResult.error) {
    console.error('[passport share] redemptions:', redemptionResult.error.message);
    return { ok: false };
  }

  const rows = (redemptionResult.data ?? []) as ShareRedemptionRow[];
  const source = passportShareSourceFromRows({
    fullName: profileResult.error ? null : (profileResult.data?.full_name ?? null),
    rows,
    now,
  });
  return { ok: true, model: buildPassportShareCard(source) };
}
