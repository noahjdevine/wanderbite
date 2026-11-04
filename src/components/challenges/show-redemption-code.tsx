'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import QRCode from 'react-qr-code';
import { getRedemptionCode } from '@/app/actions/get-redemption-code';
import { redeemChallengeItem } from '@/app/actions/redeem-challenge';
import { Button } from '@/components/ui/button';
import { Stamp } from '@/components/wb';
import { buildPartnerRedeemScanUrl } from '@/lib/partner-redeem-url';
import { chicagoVisitDate, cuisineInk, stampRotationDegrees } from '@/lib/passport/passport-board';
import { useStampUnlock } from '@/lib/passport/stamp-unlock';
import {
  formatRedemptionCountdown,
  REDEMPTION_CODE_LIFETIME_LABEL,
  visitWindowOpen,
} from '@/lib/redemption-expiry';
import { deriveVisitStatus, visitStatusLabel, type VisitStatus } from '@/lib/visits/visit-status';

const ONE_MINUTE_LEFT = '1 minute left';
const CODE_REISSUED = 'Code reissued';
const ONE_MINUTE_MS = 60_000;

function liveVisitStatus(args: {
  phase: ShowRedemptionCodeProps['status'];
  expiresAt: string | null;
  redemptionDeadline: string | null;
  itemStatus: string | null;
  hasNote: boolean;
  verifiedAt: string | null | undefined;
  nowMs: number;
}): VisitStatus {
  return deriveVisitStatus({
    item: {
      status: args.itemStatus ?? 'assigned',
      redemptionDeadline: args.redemptionDeadline,
    },
    redemption: {
      status: args.phase,
      verifiedAt: args.phase === 'verified' ? (args.verifiedAt ?? 'verified') : null,
      expiresAt: args.expiresAt,
    },
    note: args.hasNote ? { note: null } : null,
    now: new Date(args.nowMs),
  });
}

function openingAnnouncement(
  status: ShowRedemptionCodeProps['status'],
  expiresAt: string | null,
  redemptionDeadline: string | null,
  itemStatus: string | null,
  hasNote: boolean,
  nowMs: number,
): string {
  const derived = liveVisitStatus({
    phase: status,
    expiresAt,
    redemptionDeadline,
    itemStatus,
    hasNote,
    verifiedAt: null,
    nowMs,
  });
  if (derived === 'code_issued') {
    if (!expiresAt) return visitStatusLabel('code_issued');
    const remaining = new Date(expiresAt).getTime() - nowMs;
    return remaining <= ONE_MINUTE_MS ? ONE_MINUTE_LEFT : visitStatusLabel('code_issued');
  }
  if (derived === 'code_expired' || derived === 'expired') return visitStatusLabel(derived);
  if (derived === 'verified' || derived === 'note_added') return 'Already verified';
  return '';
}

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
  /** ISO `verified_at`. The display string above is not used for the slam. */
  verifiedAtIso?: string | null;
  cuisineTags?: string[] | null;
  neighborhood?: string | null;
  /** Stored challenge_items.status. Null when the redemption has no item. */
  itemStatus?: string | null;
  /** True when a bite_notes row exists for this redemption. */
  hasNote?: boolean;
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
  verifiedAtIso = null,
  cuisineTags = null,
  neighborhood = null,
  itemStatus = null,
  hasNote = false,
}: ShowRedemptionCodeProps) {
  const [phase, setPhase] = useState(status);
  const [liveCode, setLiveCode] = useState(code);
  const [liveExpiresAt, setLiveExpiresAt] = useState(expiresAt);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [reissuing, setReissuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState(() =>
    openingAnnouncement(status, expiresAt, redemptionDeadline, itemStatus, hasNote, Date.now()),
  );
  const verifiedCandidate = useMemo(
    () =>
      phase === 'verified' && verifiedAtIso
        ? [
            {
              id: redemptionId,
              status: hasNote ? ('note_added' as const) : ('verified' as const),
              verifiedAt: verifiedAtIso,
            },
          ]
        : [],
    [hasNote, phase, redemptionId, verifiedAtIso],
  );
  const unlock = useStampUnlock(verifiedCandidate, false);
  const refreshing = useRef(false);
  const announcedMinute = useRef(announcement === ONE_MINUTE_LEFT);
  const codeRef = useRef(liveCode);
  const expiresRef = useRef(liveExpiresAt);

  useEffect(() => {
    codeRef.current = liveCode;
    expiresRef.current = liveExpiresAt;
  }, [liveCode, liveExpiresAt]);

  const noteReissue = useCallback((nextExpiresAt: string) => {
    setAnnouncement(CODE_REISSUED);
    announcedMinute.current = new Date(nextExpiresAt).getTime() - Date.now() <= ONE_MINUTE_MS;
  }, []);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const result = await getRedemptionCode(redemptionId);
      if (result.state === 'issued') {
        const changed =
          result.code !== codeRef.current || result.expiresAt !== expiresRef.current;
        setLiveCode(result.code);
        setLiveExpiresAt(result.expiresAt);
        setPhase('issued');
        setError(null);
        if (changed) noteReissue(result.expiresAt);
        return;
      }
      if (result.state === 'expired') {
        setLiveCode(null);
        setLiveExpiresAt(result.expiresAt);
        setPhase('expired');
        setAnnouncement(
          visitStatusLabel(
            liveVisitStatus({
              phase: 'expired',
              expiresAt: result.expiresAt,
              redemptionDeadline,
              itemStatus,
              hasNote,
              verifiedAt,
              nowMs: Date.now(),
            }),
          ),
        );
      }
    } catch {
      return;
    } finally {
      refreshing.current = false;
    }
  }, [hasNote, itemStatus, noteReissue, redemptionDeadline, redemptionId, verifiedAt]);

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
      const remaining = new Date(liveExpiresAt).getTime() - now;
      if (remaining > 0 && remaining <= ONE_MINUTE_MS && !announcedMinute.current) {
        announcedMinute.current = true;
        setAnnouncement(ONE_MINUTE_LEFT);
      }
      if (remaining <= 0) void refresh();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, liveExpiresAt, refresh]);

  const remainingMs = liveExpiresAt ? new Date(liveExpiresAt).getTime() - nowMs : 0;
  const windowOpen = canReissue && visitWindowOpen(redemptionDeadline, new Date(nowMs));
  const liveStatus = liveVisitStatus({
    phase,
    expiresAt: liveExpiresAt,
    redemptionDeadline,
    itemStatus,
    hasNote,
    verifiedAt,
    nowMs,
  });
  const statusLabel = visitStatusLabel(liveStatus);
  const scanUrl = liveCode ? buildPartnerRedeemScanUrl(restaurantSlug, liveCode) : null;
  const statusText =
    phase === 'issued' ? `Code expires in ${formatRedemptionCountdown(remainingMs)}` : null;

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
      noteReissue(result.data.expiresAt);
    } catch {
      setError('Unable to issue a redemption code right now. Please try again later.');
    } finally {
      setReissuing(false);
    }
  }

  const lifetimeCopy = `Codes expire after ${REDEMPTION_CODE_LIFETIME_LABEL}.`;

  return (
    <div className="wb-sheet mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-lg flex-col items-center justify-center px-5 py-8">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <div className="text-center">
        <p className="text-sm font-semibold tracking-wide text-wb-muted uppercase">Show your server</p>
        <h1 className="font-display mt-2 text-[40px] leading-none text-wb-ink">{restaurantName}</h1>
        <p className="mt-3 text-sm font-medium text-wb-ink" data-visit-status={liveStatus}>
          {statusLabel}
        </p>
      </div>

      <div className="mt-4 w-full rounded-2xl border-[1.5px] border-dashed border-[#e3d9c6] bg-[#f4efe6] px-4 py-3 text-center">
        <p className="font-display text-[28px] leading-none text-wb-plum">{discountLabel}</p>
        {minSpendLabel ? <p className="mt-1 text-sm text-wb-muted">{minSpendLabel}</p> : null}
      </div>

      {phase === 'verified' ? (
        <div className="mt-8 w-full rounded-[28px] border border-[#86efac] bg-[#f0fdf4] p-6 text-center">
          <p className="font-display text-[32px] leading-none text-[#14532d]">Already verified</p>
          {verifiedAt ? <p className="mt-2 text-sm text-[#14532d]">{verifiedAt}</p> : null}
          <div className="mt-4 flex justify-center">
            <Stamp
              name={restaurantName}
              date={chicagoVisitDate(verifiedAtIso)?.short || verifiedAt || 'Verified'}
              accessibleDate={chicagoVisitDate(verifiedAtIso)?.long || verifiedAt || undefined}
              neighborhood={neighborhood?.trim() ?? ''}
              inkColor={cuisineInk(cuisineTags).color}
              rotation={stampRotationDegrees(redemptionId)}
              playSlam={unlock.slamId === redemptionId}
              href="/journey?view=passport"
            />
          </div>
          <p className="sr-only" aria-live="polite" data-stamp-announcement="">
            {unlock.announceId === redemptionId ? `New stamp: ${restaurantName}` : ''}
          </p>
        </div>
      ) : phase === 'expired' || !liveCode || !scanUrl ? (
        <div className="mt-8 w-full rounded-[28px] bg-white p-6 text-center shadow-[var(--wb-shadow-card)]">
          <p className="font-medium text-wb-ink">{statusLabel}</p>
          <p className="mt-2 text-sm text-wb-muted">{lifetimeCopy}</p>
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
          <div className="mt-6 rounded-[28px] bg-white p-5 shadow-[var(--wb-shadow-card)]">
            <QRCode value={scanUrl} size={280} level="M" />
          </div>

          <p className="mt-4 max-w-sm text-center text-sm text-wb-muted">
            Server can scan this QR, or use the code below if scanning isn&apos;t available.
          </p>

          <p className="font-mono mt-5 text-center text-4xl font-bold tracking-[0.28em] text-wb-ink sm:text-5xl">
            {liveCode}
          </p>

          <p className="mt-4 text-center text-sm text-wb-ink tabular-nums">{statusText}</p>
          <p className="mt-2 text-center text-sm text-wb-muted">{lifetimeCopy}</p>

          <p className="mt-6 max-w-sm text-center text-xs leading-relaxed text-wb-muted">
            Your server will verify this in Wanderbite, then apply the discount on your check. POS
            integration is coming later — for now the discount is applied manually on the bill.
          </p>
        </>
      )}

      <div className="mt-10 text-center">
        <Link href="/challenges" className="text-sm font-medium text-wb-plum underline-offset-4 hover:underline">
          Back to challenges
        </Link>
      </div>
    </div>
  );
}
