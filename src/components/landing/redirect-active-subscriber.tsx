'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useSupabaseUser } from '@/hooks/use-supabase-user';

/**
 * Mounted on the public landing page. If the visitor is an active subscriber,
 * redirect them to /challenges. Inactive / unauthenticated visitors stay on /.
 * Runs client-side so the page itself can be statically cached.
 */
export function RedirectActiveSubscriber() {
  const { user, loading } = useSupabaseUser();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user) return;

    let cancelled = false;

    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('user_profiles')
        .select('subscription_status')
        .eq('id', user.id)
        .maybeSingle();

      if (cancelled) return;

      const sub =
        (data as { subscription_status: string | null } | null)?.subscription_status ??
        null;
      if (sub === 'active') router.replace('/challenges');
    })();

    return () => {
      cancelled = true;
    };
  }, [user, loading, router]);

  return null;
}
