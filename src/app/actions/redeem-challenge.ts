'use server';

import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const TOKEN_PREFIX = 'WB-';
const TOKEN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I for readability
const TOKEN_LENGTH = 5;

function generateRedemptionToken(): string {
  let code = TOKEN_PREFIX;
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    code += TOKEN_CHARS[Math.floor(Math.random() * TOKEN_CHARS.length)];
  }
  return code;
}

export type RedeemChallengeResult =
  | { ok: true; data: { token: string; redeemedAt: string } }
  | { ok: false; error: string };

/**
 * Issues a redemption for a challenge item: creates redemption record (status issued),
 * updates item to redeemed, returns token and timestamp.
 */
export async function redeemChallengeItem(
  challengeItemId: string,
  userId: string
): Promise<RedeemChallengeResult> {
  try {
    const supabase = getSupabaseAdmin();

    // 1. Fetch the challenge_item
    const { data: item, error: itemErr } = await supabase
      .from('challenge_items')
      .select('id, cycle_id, restaurant_id, status')
      .eq('id', challengeItemId)
      .maybeSingle();

    if (itemErr) {
      return { ok: false, error: `Failed to load challenge item: ${itemErr.message}` };
    }
    if (!item) {
      return { ok: false, error: 'Challenge item not found.' };
    }

    const challengeItem = item as {
      id: string;
      cycle_id: string;
      restaurant_id: string;
      status: string;
    };

    if (challengeItem.status !== 'assigned') {
      return {
        ok: false,
        error:
          challengeItem.status === 'redeemed'
            ? 'This challenge has already been redeemed.'
            : 'This spot was swapped. Only assigned challenges can be redeemed.',
      };
    }

    // 2. Ensure item belongs to user (via cycle)
    const { data: cycle, error: cycleErr } = await supabase
      .from('challenge_cycles')
      .select('id, user_id')
      .eq('id', challengeItem.cycle_id)
      .maybeSingle();

    if (cycleErr) {
      return { ok: false, error: `Failed to load challenge cycle: ${cycleErr.message}` };
    }
    if (!cycle) {
      return { ok: false, error: 'Challenge cycle not found.' };
    }

    const cycleRow = cycle as { id: string; user_id: string };
    if (cycleRow.user_id !== userId) {
      return { ok: false, error: 'This challenge does not belong to you.' };
    }

    // 3. Generate token and insert redemption
    const token = generateRedemptionToken();

    const { data: redemption, error: insertErr } = await supabase
      .from('redemptions')
      .insert({
        user_id: userId,
        restaurant_id: challengeItem.restaurant_id,
        challenge_item_id: challengeItemId,
        token_hash: token,
        status: 'issued',
      })
      .select('created_at')
      .single();

    if (insertErr) {
      return { ok: false, error: `Failed to create redemption: ${insertErr.message}` };
    }

    // 4. Update challenge_item to redeemed
    const { error: updateErr } = await supabase
      .from('challenge_items')
      .update({ status: 'redeemed' })
      .eq('id', challengeItemId);

    if (updateErr) {
      return { ok: false, error: `Failed to mark item as redeemed: ${updateErr.message}` };
    }

    revalidatePath('/');

    const redeemedAt =
      (redemption as { created_at: string } | null)?.created_at ?? new Date().toISOString();

    return {
      ok: true,
      data: { token, redeemedAt },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false, error: `Redemption failed: ${message}` };
  }
}
