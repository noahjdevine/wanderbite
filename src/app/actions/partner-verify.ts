'use server';

import { format } from 'date-fns';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const BADGE_ID_TO_NAME: Record<string, string> = {
  first_bite: 'First Bite',
  hat_trick: 'Hat Trick',
  high_five: 'High Five',
  wanderer: 'The Wanderer',
};

export type VerifyRedemptionResult =
  | {
      success: true;
      redemptionDetails: {
        email: string | null;
        restaurantName: string;
        verifiedAt: string;
      };
      newBadgesEarned: string[];
    }
  | { success: false; message: string };

/**
 * Partner verification: look up redemption by token, validate, mark verified, return details.
 */
export async function verifyRedemptionToken(
  token: string
): Promise<VerifyRedemptionResult> {
  const trimmed = token?.trim();
  if (!trimmed) {
    return { success: false, message: 'Invalid code' };
  }

  const supabase = getSupabaseAdmin();

  const { data: rows, error: searchErr } = await supabase
    .from('redemptions')
    .select('id, user_id, restaurant_id, status, verified_at')
    .ilike('token_hash', trimmed)
    .limit(2);

  if (searchErr) {
    return { success: false, message: 'Verification failed. Please try again.' };
  }
  if (!rows?.length) {
    return { success: false, message: 'Invalid code' };
  }

  const redemption = rows[0] as {
    id: string;
    user_id: string;
    restaurant_id: string;
    status: string;
    verified_at: string | null;
  };

  if (redemption.status === 'verified') {
    const usedAt = redemption.verified_at
      ? format(new Date(redemption.verified_at), 'PPp')
      : 'a previous time';
    return {
      success: false,
      message: `This code was already used on ${usedAt}.`,
    };
  }

  if (redemption.status === 'expired') {
    return { success: false, message: 'Code expired' };
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('redemptions')
    .update({ status: 'verified', verified_at: now })
    .eq('id', redemption.id);

  if (updateErr) {
    return { success: false, message: 'Verification failed. Please try again.' };
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('id', redemption.user_id)
    .maybeSingle();

  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('name')
    .eq('id', redemption.restaurant_id)
    .maybeSingle();

  const email = (profile as { email: string | null } | null)?.email ?? null;
  const restaurantName =
    (restaurant as { name: string } | null)?.name ?? 'Unknown restaurant';
  const verifiedAt = format(new Date(now), 'PPp');

  const newBadgesEarned = await awardBadgesForVerifiedCount(
    supabase,
    redemption.user_id
  );

  return {
    success: true,
    redemptionDetails: { email, restaurantName, verifiedAt },
    newBadgesEarned,
  };
}

/**
 * Count verified redemptions for user, determine which badges to award,
 * insert new awards (on conflict do nothing), return badge names newly earned.
 */
async function awardBadgesForVerifiedCount(
  supabase: Awaited<ReturnType<typeof getSupabaseAdmin>>,
  userId: string
): Promise<string[]> {
  const { count, error: countErr } = await supabase
    .from('redemptions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'verified');

  if (countErr || count == null) return [];

  const verifiedCount = count;

  const badgeIdsToAward: string[] = [];
  if (verifiedCount >= 1) badgeIdsToAward.push('first_bite');
  if (verifiedCount >= 3) {
    badgeIdsToAward.push('hat_trick');
    badgeIdsToAward.push('wanderer');
  }
  if (verifiedCount >= 5) badgeIdsToAward.push('high_five');

  if (badgeIdsToAward.length === 0) return [];

  const { data: existing } = await supabase
    .from('user_badges')
    .select('badge_id')
    .eq('user_id', userId)
    .in('badge_id', badgeIdsToAward);

  const existingSet = new Set(
    (existing ?? []).map((r: { badge_id: string }) => r.badge_id)
  );
  const newBadgeIds = badgeIdsToAward.filter((id) => !existingSet.has(id));
  if (newBadgeIds.length === 0) return [];

  const rows = newBadgeIds.map((badge_id) => ({ user_id: userId, badge_id }));
  const { error: insertErr } = await supabase
    .from('user_badges')
    .upsert(rows, {
      onConflict: 'user_id,badge_id',
      ignoreDuplicates: true,
    });

  if (insertErr) return [];

  return newBadgeIds.map((id) => BADGE_ID_TO_NAME[id] ?? id);
}
