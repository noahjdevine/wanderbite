'use server';

import { randomInt } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { captureEvent } from '@/lib/posthog-server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { decryptRedemptionCode, encryptRedemptionCode } from '@/lib/redemption-crypto';
import { hashRedemptionToken } from '@/lib/redemption-token-hash';
import { evaluateRedemptionIssueLimit } from '@/lib/ratelimit';
import {
  isRedemptionIssuanceDisabled,
  REDEMPTION_ISSUE_UNAVAILABLE_MESSAGE,
} from '@/lib/redemption-issue';
import { requireUser } from '@/lib/auth/require-user';
import { redemptionExpiresAt } from '@/lib/redemption-expiry';
import { firstRpcRow } from '@/lib/challenges/rpc';
import type { RedeemChallengeResult } from '@/types/redeem-challenge';

const TOKEN_PREFIX = 'WB-';
const TOKEN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I for readability
const TOKEN_LENGTH = 5;
const TOKEN_ATTEMPTS = 3;

function generateRedemptionToken(): string {
  let code = TOKEN_PREFIX;
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    code += TOKEN_CHARS[randomInt(0, TOKEN_CHARS.length)];
  }
  return code;
}

function tokenFromEncrypted(encrypted: string | null, iv: string | null): string | null {
  if (!encrypted || !iv) return null;
  try {
    return decryptRedemptionCode(encrypted, iv);
  } catch {
    return null;
  }
}

function logRedemptionIssue(event: string): void {
  console.warn(`[redemption-issue] ${event}`);
}

function issueUnavailable(): RedeemChallengeResult {
  return { ok: false, error: REDEMPTION_ISSUE_UNAVAILABLE_MESSAGE };
}

async function captureIssueCreated(
  userId: string,
  challengeItemId: string,
  restaurantId: string
): Promise<void> {
  try {
    await captureEvent(userId, 'challenge_redeemed', {
      challenge_item_id: challengeItemId,
      restaurant_id: restaurantId,
    });
  } catch (error) {
    Sentry.captureException(error);
  }
}

/**
 * Issues a redemption for a challenge item: creates redemption record (status issued),
 * updates item to redeemed, returns token and timestamp.
 */
export async function redeemChallengeItem(
  challengeItemId: string
): Promise<RedeemChallengeResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const supabase = getSupabaseAdmin();

    const { data: item, error: itemErr } = await supabase
      .from('challenge_items')
      .select('id, cycle_id, restaurant_id, status')
      .eq('id', challengeItemId)
      .maybeSingle();

    if (itemErr) {
      logRedemptionIssue('item_load_error');
      return issueUnavailable();
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

    const { data: cycle, error: cycleErr } = await supabase
      .from('challenge_cycles')
      .select('id, user_id')
      .eq('id', challengeItem.cycle_id)
      .maybeSingle();

    if (cycleErr) {
      logRedemptionIssue('cycle_load_error');
      return issueUnavailable();
    }
    if (!cycle) {
      return { ok: false, error: 'Challenge cycle not found.' };
    }

    const cycleRow = cycle as { id: string; user_id: string };
    if (cycleRow.user_id !== auth.userId) {
      return { ok: false, error: 'This challenge does not belong to you.' };
    }

    if (challengeItem.status === 'redeemed') {
      const { data: existing, error: existingErr } = await supabase
        .from('redemptions')
        .select('id, created_at, encrypted_code, code_iv')
        .eq('challenge_item_id', challengeItemId)
        .maybeSingle();

      if (existingErr || !existing) {
        return { ok: false, error: 'This challenge has already been redeemed.' };
      }

      const existingRow = existing as {
        id: string;
        created_at: string;
        encrypted_code: string | null;
        code_iv: string | null;
      };
      const token = tokenFromEncrypted(existingRow.encrypted_code, existingRow.code_iv);
      if (!token) {
        return { ok: false, error: 'This challenge has already been redeemed.' };
      }

      return {
        ok: true,
        data: {
          token,
          redeemedAt: existingRow.created_at,
          redemptionId: existingRow.id,
        },
      };
    }

    if (challengeItem.status !== 'assigned') {
      return {
        ok: false,
        error: 'This spot was swapped. Only assigned challenges can be redeemed.',
      };
    }

    if (isRedemptionIssuanceDisabled()) {
      logRedemptionIssue('disabled');
      return issueUnavailable();
    }

    const limit = await evaluateRedemptionIssueLimit(auth.userId);
    if (limit === 'rate_limited') {
      logRedemptionIssue('redemption_issue_rate_limited');
      return issueUnavailable();
    }
    if (limit !== 'allowed') {
      logRedemptionIssue('redemption_issue_limiter_unavailable');
      return issueUnavailable();
    }

    for (let attempt = 0; attempt < TOKEN_ATTEMPTS; attempt++) {
      const token = generateRedemptionToken();
      const tokenHash = hashRedemptionToken(token);
      const { encrypted, iv } = encryptRedemptionCode(token);

      const { data: rpcData, error: rpcError } = await supabase.rpc(
        'issue_challenge_redemption',
        {
          p_user_id: auth.userId,
          p_item_id: challengeItemId,
          p_token_hash: tokenHash,
          p_encrypted_code: encrypted,
          p_code_iv: iv,
          p_expires_at: redemptionExpiresAt().toISOString(),
        }
      );

      if (rpcError) {
        logRedemptionIssue('rpc_error');
        return issueUnavailable();
      }

      const issued = firstRpcRow(rpcData);
      if (!issued) {
        logRedemptionIssue('rpc_empty');
        return issueUnavailable();
      }
      if (issued.outcome === 'token_collision') {
        continue;
      }
      if (issued.outcome === 'forbidden') {
        return { ok: false, error: 'This challenge does not belong to you.' };
      }
      if (issued.outcome === 'not_assigned') {
        return {
          ok: false,
          error: 'This spot was swapped. Only assigned challenges can be redeemed.',
        };
      }
      if (issued.outcome === 'not_found') {
        return { ok: false, error: 'Challenge item not found.' };
      }
      if (issued.outcome !== 'created' && issued.outcome !== 'existing') {
        logRedemptionIssue('rpc_unexpected');
        return issueUnavailable();
      }
      if (
        !issued.redemption_id
        || !issued.encrypted_code
        || !issued.code_iv
        || !issued.created_at
      ) {
        logRedemptionIssue('rpc_incomplete');
        return issueUnavailable();
      }

      const displayToken = tokenFromEncrypted(issued.encrypted_code, issued.code_iv);
      if (!displayToken) {
        logRedemptionIssue('decrypt_failed');
        return issueUnavailable();
      }

      revalidatePath('/dashboard');
      revalidatePath('/challenges');

      if (issued.outcome === 'created') {
        await captureIssueCreated(
          auth.userId,
          challengeItemId,
          challengeItem.restaurant_id
        );
      }

      return {
        ok: true,
        data: {
          token: displayToken,
          redeemedAt: issued.created_at,
          redemptionId: issued.redemption_id,
        },
      };
    }

    return issueUnavailable();
  } catch {
    logRedemptionIssue('throw');
    return issueUnavailable();
  }
}
