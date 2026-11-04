'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

type SessionSnapshot = {
  pathname: string;
  user: User | null;
  ready: boolean;
  optimisticSignedIn: boolean;
};

/**
 * Auth cookie written by @supabase/ssr. Chunked as `.0`, `.1`, …
 * Excludes the PKCE `auth-token-code-verifier` cookie.
 */
export function hasSupabaseAuthCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(/;\s*/).some((part) => {
    const name = part.slice(0, part.indexOf('='));
    const value = part.slice(name.length + 1);
    return /^sb-.+-auth-token(?:\.\d+)?$/.test(name) && value.length > 0;
  });
}

/**
 * The site header stays mounted across a server-action sign-in redirect, so a
 * one-time getUser() on mount keeps showing the signed-out nav. Re-read when
 * the path changes. A session cookie already on the document shows the
 * signed-in nav on that first render, before getUser() returns.
 */
export function useSupabaseUser() {
  const pathname = usePathname();
  const [snapshot, setSnapshot] = useState<SessionSnapshot>({
    pathname,
    user: null,
    ready: false,
    optimisticSignedIn: false,
  });

  if (snapshot.pathname !== pathname) {
    setSnapshot({
      pathname,
      user: null,
      ready: false,
      optimisticSignedIn: hasSupabaseAuthCookie(),
    });
  }

  useEffect(() => {
    let cancelled = false;
    const client = createClient();

    void client.auth.getUser().then(
      ({ data }) => {
        if (cancelled) return;
        setSnapshot({
          pathname,
          user: data.user ?? null,
          ready: true,
          optimisticSignedIn: false,
        });
      },
      () => {
        if (cancelled) return;
        setSnapshot({
          pathname,
          user: null,
          ready: true,
          optimisticSignedIn: false,
        });
      },
    );

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || cancelled) return;
      setSnapshot({
        pathname,
        user: session?.user ?? null,
        ready: true,
        optimisticSignedIn: false,
      });
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [pathname]);

  const known = snapshot.ready && snapshot.pathname === pathname;
  const signedIn = known ? snapshot.user != null : snapshot.optimisticSignedIn;

  return {
    user: known ? snapshot.user : null,
    loading: !known && !signedIn,
    signedIn,
  };
}
