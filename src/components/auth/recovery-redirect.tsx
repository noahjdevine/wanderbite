'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Catches client-side recovery sessions (hash fragments, implicit flow) and
 * sends the user to /reset-password before smart redirects can run.
 */
export function RecoveryRedirect() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === '/reset-password') return;

    const hash = window.location.hash;
    if (hash.includes('type=recovery')) {
      router.replace(`/reset-password${hash}`);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code && pathname === '/') {
      const recovery = new URL('/auth/recovery', window.location.origin);
      recovery.searchParams.set('code', code);
      if (params.get('type')) recovery.searchParams.set('type', params.get('type')!);
      window.location.replace(recovery.toString());
      return;
    }

    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && pathname !== '/reset-password') {
        router.replace('/reset-password');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [pathname, router]);

  return null;
}
