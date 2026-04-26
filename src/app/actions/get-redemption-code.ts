'use server';

import { createClient } from '@/lib/supabase/server';
import { decryptRedemptionCode } from '@/lib/redemption-crypto';

/**
 * Returns the plaintext WB- code for the user's own redemption while status is `issued`.
 * Does not throw to callers; logs and returns null on failure or disallowed access.
 */
export async function getRedemptionCode(redemptionId: string): Promise<string | null> {
  if (!redemptionId?.trim()) {
    return null;
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return null;
    }

    const { data, error } = await supabase
      .from('redemptions')
      .select('status, encrypted_code, code_iv, user_id')
      .eq('id', redemptionId.trim())
      .maybeSingle();

    if (error) {
      console.error('getRedemptionCode select error', error.message);
      return null;
    }
    if (!data) {
      return null;
    }

    const row = data as {
      status: string;
      encrypted_code: string | null;
      code_iv: string | null;
      user_id: string;
    };

    if (row.user_id !== user.id) {
      return null;
    }
    if (row.status !== 'issued') {
      return null;
    }
    if (!row.encrypted_code?.trim() || !row.code_iv?.trim()) {
      return null;
    }

    try {
      return decryptRedemptionCode(row.encrypted_code, row.code_iv);
    } catch (e) {
      console.error('getRedemptionCode decrypt failed', e);
      return null;
    }
  } catch (e) {
    console.error('getRedemptionCode', e);
    return null;
  }
}
