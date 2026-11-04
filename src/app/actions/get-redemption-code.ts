'use server';

import { createClient } from '@/lib/supabase/server';
import { decryptRedemptionCode } from '@/lib/redemption-crypto';
import {
  redemptionCodeStillValid,
  type RedemptionCodeResult,
} from '@/lib/redemption-expiry';

/**
 * Returns the plaintext WB- code while status is `issued` and `expires_at` is still
 * in the future (server time). An issued code past `expires_at`, or a row already
 * marked `expired`, returns `{ state: 'expired' }` and does not throw.
 * The signed-in member's own `verified` row returns `{ state: 'verified', verifiedAt }`
 * from `redemptions.verified_at` and does not include the code. Any other member's
 * id is `unavailable`.
 */
export async function getRedemptionCode(redemptionId: string): Promise<RedemptionCodeResult> {
  if (!redemptionId?.trim()) {
    return { state: 'unavailable' };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { state: 'unavailable' };
    }

    const { data, error } = await supabase
      .from('redemptions')
      .select('status, encrypted_code, code_iv, user_id, expires_at, verified_at')
      .eq('id', redemptionId.trim())
      .maybeSingle();

    if (error) {
      console.error('getRedemptionCode select error', error.message);
      return { state: 'unavailable' };
    }
    if (!data) {
      return { state: 'unavailable' };
    }

    const row = data as {
      status: string;
      encrypted_code: string | null;
      code_iv: string | null;
      user_id: string;
      expires_at: string | null;
      verified_at: string | null;
    };

    if (row.user_id !== user.id) {
      return { state: 'unavailable' };
    }

    if (row.status === 'verified') {
      return {
        state: 'verified',
        verifiedAt: typeof row.verified_at === 'string' ? row.verified_at : null,
      };
    }

    const expiresAt = typeof row.expires_at === 'string' ? row.expires_at : null;
    if (
      expiresAt
      && redemptionCodeStillValid({ status: row.status, expiresAt }, new Date())
    ) {
      if (!row.encrypted_code?.trim() || !row.code_iv?.trim()) {
        return { state: 'unavailable' };
      }
      try {
        return {
          state: 'issued',
          code: decryptRedemptionCode(row.encrypted_code, row.code_iv),
          expiresAt,
        };
      } catch (e) {
        console.error('getRedemptionCode decrypt failed', e);
        return { state: 'unavailable' };
      }
    }

    if (row.status === 'issued' || row.status === 'expired') {
      return { state: 'expired', expiresAt };
    }

    return { state: 'unavailable' };
  } catch (e) {
    console.error('getRedemptionCode', e);
    return { state: 'unavailable' };
  }
}
