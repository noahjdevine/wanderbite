import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import { LEGAL_CONTENT_ID, LEGAL_DOCUMENT_VERSION } from '@/lib/legal-attestation';

/** True only for the pinned version. A lookup error is treated as missing so the form can still be submitted. */
export async function hasCurrentLegalAttestation(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('legal_attestations')
    .select('user_id')
    .eq('user_id', userId)
    .eq('document_version', LEGAL_DOCUMENT_VERSION)
    .eq('content_id', LEGAL_CONTENT_ID)
    .eq('age_21', true)
    .maybeSingle();
  return !error && data !== null;
}
