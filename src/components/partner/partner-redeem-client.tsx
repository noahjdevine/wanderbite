'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { verifyRedemptionTokenForPartner } from '@/app/actions/partner-verify';
import { logoutPartner } from '@/app/actions/partner-auth';

type VerifyState =
  | { status: 'idle' }
  | { status: 'verifying' }
  | { status: 'success'; email: string | null; verifiedAt: string }
  | { status: 'error'; message: string };

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

type PartnerRedeemClientProps = {
  restaurantName: string;
  slug: string;
  initialCode?: string | null;
  autoVerify?: boolean;
};

export function PartnerRedeemClient({
  restaurantName,
  slug,
  initialCode,
  autoVerify = false,
}: PartnerRedeemClientProps) {
  const router = useRouter();
  const [code, setCode] = useState(() => (initialCode ? normalizeCode(initialCode) : ''));
  const [state, setState] = useState<VerifyState>({ status: 'idle' });
  const autoRan = useRef(false);

  const runVerify = useCallback(async (rawCode: string) => {
    const trimmed = normalizeCode(rawCode);
    if (!trimmed) return;

    setState({ status: 'verifying' });
    try {
      const res = await verifyRedemptionTokenForPartner(trimmed);
      if (res.success) {
        setState({
          status: 'success',
          email: res.redemptionDetails.email,
          verifiedAt: res.redemptionDetails.verifiedAt,
        });
        setCode('');
        router.refresh();
      } else {
        setState({ status: 'error', message: res.message });
      }
    } catch {
      setState({
        status: 'error',
        message: 'Verification failed. Please try again.',
      });
    }
  }, [router]);

  useEffect(() => {
    if (!autoVerify || !initialCode || autoRan.current) return;
    autoRan.current = true;
    const timerId = window.setTimeout(() => {
      void runVerify(initialCode);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [autoVerify, initialCode, runVerify]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await runVerify(code);
  }

  async function handleLogout() {
    await logoutPartner();
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Redeem mode
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{restaurantName}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Scan the guest&apos;s QR code or type their Wanderbite code. Then apply the discount on
          the check in your POS.
        </p>
      </div>

      {state.status === 'success' && (
        <div
          className="mb-6 flex flex-col items-center gap-2 rounded-xl border-2 border-green-600 bg-green-50 p-6 text-center dark:border-green-500 dark:bg-green-950/40"
          role="status"
        >
          <CheckCircle2 className="size-10 text-green-600 dark:text-green-400" aria-hidden />
          <p className="text-lg font-semibold text-green-900 dark:text-green-100">Verified</p>
          <p className="text-sm text-green-800 dark:text-green-200">
            Apply the Wanderbite discount on the guest&apos;s check.
          </p>
          {state.email && (
            <p className="text-xs text-green-700 dark:text-green-300">Guest: {state.email}</p>
          )}
          <p className="text-xs text-green-700 dark:text-green-300">{state.verifiedAt}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            onClick={() => setState({ status: 'idle' })}
          >
            Redeem another code
          </Button>
        </div>
      )}

      {state.status === 'error' && (
        <div
          className="mb-6 flex flex-col items-center gap-2 rounded-xl border-2 border-destructive/50 bg-destructive/10 p-6 text-center"
          role="alert"
        >
          <XCircle className="size-10 text-destructive" aria-hidden />
          <p className="font-medium text-destructive">{state.message}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setState({ status: 'idle' })}>
            Try again
          </Button>
        </div>
      )}

      {(state.status === 'idle' || state.status === 'verifying' || state.status === 'error') && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="partner-redeem-code" className="mb-2 block text-sm font-medium">
              Customer code
            </label>
            <input
              id="partner-redeem-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="WB-XXXXX"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              className="w-full rounded-xl border-2 border-input bg-background px-4 py-4 text-center font-mono text-2xl font-bold tracking-widest focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              disabled={state.status === 'verifying'}
            />
          </div>
          <Button type="submit" className="h-12 w-full text-base" disabled={state.status === 'verifying' || !code.trim()}>
            {state.status === 'verifying' ? (
              <>
                <Loader2 className="mr-2 size-5 animate-spin" aria-hidden />
                Verifying…
              </>
            ) : (
              'Verify code'
            )}
          </Button>
        </form>
      )}

      <div className="mt-10 flex flex-wrap items-center justify-center gap-4 text-sm text-muted-foreground">
        <Link href={`/partner/${slug}`} className="font-medium text-primary underline-offset-4 hover:underline">
          Full dashboard
        </Link>
        <button type="button" onClick={handleLogout} className="hover:text-foreground">
          Log out
        </button>
      </div>
    </div>
  );
}
