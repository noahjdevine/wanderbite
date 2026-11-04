import 'server-only';

import { getCurrentChallengeForUser } from '@/lib/challenges/generate';
import {
  assembleProgressAdventures,
  type ActivityItem,
  type ActivityRedemption,
  type ActivityRestaurant,
  type ProgressAdventure,
} from '@/lib/progress/progress-board';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type ProgressActivity =
  | { ok: true; hasPair: boolean; adventures: ProgressAdventure[] }
  | { ok: false };

type RedemptionRow = {
  id: string;
  status: string | null;
  verified_at: string | null;
  expires_at: string;
  created_at: string | null;
  restaurant_id: string | null;
  challenge_item_id: string | null;
};

type ItemRow = {
  id: string;
  status: string | null;
  redemption_deadline: string | null;
  slot_number: number | null;
  restaurant_id: string | null;
};

type RestaurantRow = {
  id: string;
  name: string | null;
  neighborhood: string | null;
  image_url: string | null;
  google_place_id: string | null;
};

type NoteRow = {
  redemption_id: string;
};

/**
 * Visits and the current pair for the Progress page.
 * Counts and XP stay in `getMemberProgress`. A failed read is `ok: false`,
 * not an empty list.
 */
export async function loadProgressActivity(userId: string, now: Date): Promise<ProgressActivity> {
  try {
    const admin = getSupabaseAdmin();
    const challenge = await getCurrentChallengeForUser(userId);
    const { data: redemptionData, error: redemptionError } = await admin
      .from('redemptions')
      .select('id, status, verified_at, expires_at, created_at, restaurant_id, challenge_item_id')
      .eq('user_id', userId);
    if (redemptionError) return fail(redemptionError.message);

    const redemptions = (redemptionData ?? []) as RedemptionRow[];
    const itemIds = unique([
      ...redemptions.map((row) => row.challenge_item_id),
      ...(challenge?.items ?? []).map((item) => item.challengeItem.id),
    ]);

    const itemById = new Map<string, ActivityItem>();
    if (itemIds.length > 0) {
      const { data: itemData, error: itemError } = await admin
        .from('challenge_items')
        .select('id, status, redemption_deadline, slot_number, restaurant_id')
        .in('id', itemIds);
      if (itemError) return fail(itemError.message);
      for (const row of (itemData ?? []) as ItemRow[]) {
        itemById.set(row.id, {
          id: row.id,
          status: row.status,
          redemptionDeadline: row.redemption_deadline,
          slotNumber: row.slot_number,
          restaurantId: row.restaurant_id,
        });
      }
    }

    for (const item of challenge?.items ?? []) {
      if (itemById.has(item.challengeItem.id)) continue;
      itemById.set(item.challengeItem.id, {
        id: item.challengeItem.id,
        status: item.challengeItem.status,
        redemptionDeadline: item.challengeItem.redemption_deadline ?? null,
        slotNumber: item.challengeItem.slot_number,
        restaurantId: item.challengeItem.restaurant_id,
      });
    }

    const restaurantIds = unique([
      ...redemptions.map((row) => row.restaurant_id),
      ...[...itemById.values()].map((item) => item.restaurantId),
    ]);
    const restaurants: ActivityRestaurant[] = [];
    if (restaurantIds.length > 0) {
      const { data: restaurantData, error: restaurantError } = await admin
        .from('restaurants')
        .select('id, name, neighborhood, image_url, google_place_id')
        .in('id', restaurantIds);
      if (restaurantError) return fail(restaurantError.message);
      for (const row of (restaurantData ?? []) as RestaurantRow[]) {
        restaurants.push({
          id: row.id,
          name: row.name ?? 'Restaurant',
          neighborhood: row.neighborhood,
          imageUrl: row.image_url,
          googlePlaceId: row.google_place_id,
        });
      }
    }

    const noteIds = new Set<string>();
    const redemptionIds = redemptions.map((row) => row.id);
    if (redemptionIds.length > 0) {
      const { data: noteData, error: noteError } = await admin
        .from('bite_notes')
        .select('redemption_id')
        .in('redemption_id', redemptionIds);
      if (noteError) return fail(noteError.message);
      for (const row of (noteData ?? []) as NoteRow[]) noteIds.add(row.redemption_id);
    }

    const activityRedemptions: ActivityRedemption[] = redemptions.map((row) => ({
      id: row.id,
      status: row.status,
      verifiedAt: row.verified_at,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      restaurantId: row.restaurant_id,
      challengeItemId: row.challenge_item_id,
    }));

    return {
      ok: true,
      hasPair: (challenge?.items.length ?? 0) > 0,
      adventures: assembleProgressAdventures({
        redemptions: activityRedemptions,
        items: [...itemById.values()],
        restaurants,
        noteRedemptionIds: noteIds,
        now,
      }),
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'unknown');
  }
}

function fail(message: string): ProgressActivity {
  console.error('[progress] loadProgressActivity:', message);
  return { ok: false };
}

function unique(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}
