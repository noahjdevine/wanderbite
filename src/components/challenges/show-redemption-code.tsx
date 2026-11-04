'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import QRCode from 'react-qr-code';
import { getRedemptionCode } from '@/app/actions/get-redemption-code';
import { redeemChallengeItem } from '@/app/actions/redeem-challenge';
import { Button } from '@/components/ui/button';
import { buildPartnerRedeemScanUrl } from '@/lib/partner-redeem-url';
import {
  formatRedemptionCountdown,
  visitWindowOpen,
} from '@/lib/redemption-expiry';

type ShowRedemptionCodeProps = {
  redemptionId: string;
  challengeItemId: string | null;
  code: string | null;
  expiresAt: string | null;
  redemptionDeadline: string | null;
  canReissue: boolean;
  restaurantName: string;
  restaurantSlug: string;
  discountLabel: string;
  minSpendLabel: string;
  status: 'issued' | 'verified' | 'expired';
  verifiedAt?: string | null;
};

export function ShowRedemptionCode({
  redemptionId,
  challengeItemId,
  code,
  expiresAt,
  redemptionDeadline,
  canReissue,
  restaurantName,
  restaurantSlug,
  discountLabel,
  minSpendLabel,
  status,
  verifiedAt,
}: ShowRedemptionCodeProps) {
  const [phase, setPhase] = useState(status);
  const [liveCode, setLiveCode] = useState(code);
  const [liveExpiresAt, setLiveExpiresAt] = useState(expiresAt);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [reissuing, setReissuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const result = await getRedemptionCode(redemptionId);
      if (result.state === 'issued') {
        setLiveCode(result.code);
        setLiveExpiresAt(result.expiresAt);
        setPhase('issued');
        setError(null);
        return;
      }
      if (result.state === 'expired') {
        setLiveCode(null);
        setLiveExpiresAt(result.expiresAt);
        setPhase('expired');
      }
    } catch {
      return;
    } finally {
      refreshing.current = false;
    }
  }, [redemptionId]);

  useEffect(() => {
    if (phase === 'verified') return;
    const onFocus = () => {
      void refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [phase, refresh]);

  useEffect(() => {
    if (phase !== 'issued' || !liveExpiresAt) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      if (new Date(liveExpiresAt).getTime() <= now) void refresh();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, liveExpiresAt, refresh]);

  const remainingMs = liveExpiresAt ? new Date(liveExpiresAt).getTime() - nowMs : 0;
  const windowOpen = canReissue && visitWindowOpen(redemptionDeadline, new Date(nowMs));
  const scanUrl = liveCode ? buildPartnerRedeemScanUrl(restaurantSlug, liveCode) : null;
  const statusText =
    phase === 'expired'
      ? 'This code expired. Get a new one'
      : phase === 'issued'
        ? `Code expires in ${formatRedemptionCountdown(remainingMs)}`
        : null;

  async function reissue() {
    if (!challengeItemId || reissuing) return;
    setReissuing(true);
    setError(null);
    try {
      const result = await redeemChallengeItem(challengeItemId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLiveCode(result.data.token);
      setLiveExpiresAt(result.data.expiresAt);
      setNowMs(Date.now());
      setPhase('issued');
    } catch {
      setError('Unable to issue a redemption code right now. Please try again later.');
    } finally {
      setReissuing(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-4 py-10">
      <div className="text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Show your server
        </p>
        <h1 className="mt-1 text-xl font-semibold">{restaurantName}</h1>
        <p className="mt-1 text-sm text-primary">{discountLabel}</p>
        <p className="text-xs text-muted-foreground">{minSpendLabel}</p>
      </div>

      {phase === 'verified' ? (
        <div className="mt-8 rounded-xl border-2 border-green-600 bg-green-50 p-6 text-center dark:border-green-500 dark:bg-green-950/40">
          <p className="font-semibold text-green-900 dark:text-green-100">Already verified</p>
          {verifiedAt && (
            <p className="mt-1 text-sm text-green-800 dark:text-green-200">{verifiedAt}</p>
          )}
        </div>
      ) : phase === 'expired' || !liveCode || !scanUrl ? (
        <div className="mt-8 rounded-xl border bg-card p-6 text-center">
          <p aria-live="polite" className="font-medium">
            This code expired. Get a new one
          </p>
          {windowOpen && challengeItemId ? (
            <Button className="mt-4" disabled={reissuing} onClick={() => void reissue()} type="button">
              {reissuing ? 'Getting a new code…' : 'Get a new one'}
            </Button>
          ) : null}
          {error ? (
            <p aria-live="polite" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="mt-8 flex justify-center rounded-xl border bg-white p-6 shadow-sm dark:bg-card">
            <QRCode value={scanUrl} size={220} level="M" />
          </div>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Server can scan this QR, or use the code below if scanning isn&apos;t available.
          </p>

          <div className="mt-6 rounded-xl border-2 border-primary/30 bg-primary/5 p-5 text-center">
            <p className="font-mono text-3xl font-bold tracking-widest text-foreground">{liveCode}</p>
          </div>

          <p aria-live="polite" className="mt-4 text-center text-sm tabular-nums text-foreground">
            {statusText}
          </p>

          <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
            Your server will verify this in Wanderbite, then apply the discount on your check. POS
            integration is coming later — for now the discount is applied manually on the bill.
          </p>
        </>
      )}

      <div className="mt-10 text-center">
        <Link href="/challenges" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Back to challenges
        </Link>
      </div>
    </div>
  );
}
