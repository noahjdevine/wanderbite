'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  hashLooksLikeRecoverySession,
  stripConsumedRecoveryHash,
} from '@/lib/sensitive-url';

/**
 * Implicit recovery links put the session in the URL fragment, which the
 * server never receives. Query links are handled by /auth/recovery instead.
 */
export function ResetPasswordHashFallback() {
  const router = useRouter();

  useEffect(() => {
    if (!hashLooksLikeRecoverySession(window.location.hash)) return;
    const supabase = createClient();
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      stripConsumedRecoveryHash();
      if (session) router.refresh();
    })();
  }, [router]);

  return null;
}
