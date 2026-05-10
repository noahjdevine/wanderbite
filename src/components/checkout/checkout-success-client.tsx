'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

const POLL_MS = 2000;
const TIMEOUT_MS = 30_000;

export function CheckoutSuccessClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<'polling' | 'timeout'>('polling');
  const startRef = useRef<number>(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const checkStatus = useCallback(async (): Promise<boolean> => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      clearPoll();
      router.replace('/signin?redirectTo=/checkout/success');
      return true;
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .select('subscription_status')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.error('checkout success poll:', error.message);
      return false;
    }

    const status = (data as { subscription_status: string | null } | null)?.subscription_status ?? null;
    if (status === 'active') {
      clearPoll();
      router.replace('/challenges?checkout=success');
      return true;
    }
    return false;
  }, [router, clearPoll]);

  useEffect(() => {
    startRef.current = Date.now();
    setPhase('polling');

    const tick = async () => {
      const elapsed = Date.now() - startRef.current;
      if (elapsed >= TIMEOUT_MS) {
        clearPoll();
        setPhase('timeout');
        return;
      }
      await checkStatus();
    };

    void tick();
    intervalRef.current = setInterval(() => void tick(), POLL_MS);

    return () => clearPoll();
  }, [checkStatus, clearPoll]);

  async function handleTryAgain() {
    startRef.current = Date.now();
    setPhase('polling');
    clearPoll();

    const tick = async () => {
      const elapsed = Date.now() - startRef.current;
      if (elapsed >= TIMEOUT_MS) {
        clearPoll();
        setPhase('timeout');
        return;
      }
      await checkStatus();
    };

    await tick();
    intervalRef.current = setInterval(() => void tick(), POLL_MS);
  }

  if (phase === 'timeout') {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 pb-16 pt-10 text-center">
        <p className="text-lg font-semibold tracking-tight text-foreground">Taking longer than we hoped</p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Your payment went through — we&apos;re still syncing your Club access. If this keeps happening, reach out at{' '}
          <a href="mailto:support@wanderbite.co" className="font-medium text-primary underline-offset-2 hover:underline">
            support@wanderbite.co
          </a>
          .
        </p>
        <Button type="button" className="mt-8" onClick={() => void handleTryAgain()}>
          Try again
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 pb-16 pt-10 text-center">
      <Loader2 className="size-10 animate-spin text-primary" aria-hidden />
      <h1 className="mt-8 text-2xl font-bold tracking-tight text-foreground">Setting up your first challenge…</h1>
      <p className="mt-3 text-muted-foreground">
        Hang tight — we&apos;re flipping the switch on your membership. This usually takes a few seconds.
      </p>
      <p className="mt-6 text-xs text-muted-foreground">Still working… thanks for your patience.</p>
    </main>
  );
}
