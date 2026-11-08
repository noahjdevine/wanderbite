'use client';

import { useEffect, useRef } from 'react';
import { claimDiscoverRun } from '@/lib/discover/auto-start';

/**
 * Starts a homepage ask once. The timer is cleared on the strict-mode
 * remount, and `claimDiscoverRun` blocks a second fire after refresh or back.
 * An edited ask consumes the token and waits for a manual submit.
 */
export function useDiscoverAutoStart(args: {
  token: string | null;
  initialMessage: string;
  currentMessage: string;
  onStart: () => void;
}): void {
  const onStartRef = useRef(args.onStart);
  const currentRef = useRef(args.currentMessage);
  const { token, initialMessage, currentMessage, onStart } = args;

  useEffect(() => {
    onStartRef.current = onStart;
    currentRef.current = currentMessage;
  }, [onStart, currentMessage]);

  useEffect(() => {
    if (!token || !initialMessage) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const edited = currentRef.current !== initialMessage;
      const first = claimDiscoverRun(token);
      if (!first || edited) return;
      onStartRef.current();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [token, initialMessage]);
}
