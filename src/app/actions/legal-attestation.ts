'use server';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/require-user';
import { ACCOUNT_CHANGED_MESSAGE } from '@/lib/auth/account-changed';
import { ATTESTATION_CONFIRM_MESSAGE } from '@/lib/legal-attestation';

const SAVE_UNAVAILABLE = 'Unable to save your confirmation right now. Please try again.';

export async function recordLegalAttestation(
  input: {
    presentedVersion: string;
    age21: boolean;
    agreeToTerms: boolean;
  },
  renderedForUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (renderedForUserId !== auth.userId) {
    return { ok: false, error: ACCOUNT_CHANGED_MESSAGE };
  }
  if (input.age21 !== true || input.agreeToTerms !== true) {
    return { ok: false, error: ATTESTATION_CONFIRM_MESSAGE };
  }
  if (typeof input.presentedVersion !== 'string' || input.presentedVersion.length === 0) {
    return { ok: false, error: SAVE_UNAVAILABLE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('record_legal_attestation', {
    p_presented_version: input.presentedVersion,
    p_age_21: true,
    p_agree_to_terms: true,
  });
  if (error) return { ok: false, error: SAVE_UNAVAILABLE };
  return { ok: true };
}
