'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { verifyRedemptionTokenForPartner } from '@/app/actions/partner-verify';
import { redeemSavingsCopy } from '@/lib/boost/savings-copy';
import { toast } from 'sonner';
import { logoutPartner } from '@/app/actions/partner-auth';
import {
  consumePendingRedeemCode,
  persistAndStripPartnerRedeemCode,
  takePartnerRedeemCodeForVerify,
} from '@/lib/pending-redeem-storage';
import {
  PARTNER_CODE_HINT,
  partnerCodeInputValue,
  partnerCodeSubmitValue,
} from '@/lib/partner-redemption-code';

type VerifyState =
  | { status: 'idle' }
  | { status: 'verifying' }
  | { status: 'success'; email: string | null; verifiedAt: string; savingsCopy: string | null }
  | { status: 'error'; message: string };

type PartnerRedeemClientProps = {
  restaurantName: string;
  slug: string;
  initialCode?: string | null;
};

export function PartnerRedeemClient({
  restaurantName,
  slug,
  initialCode,
}: PartnerRedeemClientProps) {
  const router = useRouter();
  const [code, setCode] = useState(() => (initialCode ? partnerCodeInputValue(initialCode) : ''));
  const [state, setState] = useState<VerifyState>({ status: 'idle' });
  const autoRan = useRef(false);

  const runVerify = useCallback(async (rawCode: string) => {
    const submitted = partnerCodeSubmitValue(rawCode);
    if (!submitted) return;
    setCode(submitted);

    consumePendingRedeemCode(slug);
    setState({ status: 'verifying' });
    try {
      const res = await verifyRedemptionTokenForPartner(submitted);
      if (res.success) {
        setState({
          status: 'success',
          email: res.redemptionDetails.email,
          verifiedAt: res.redemptionDetails.verifiedAt,
          savingsCopy: redeemSavingsCopy(res),
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
  }, [router, slug]);

  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get('code');
    persistAndStripPartnerRedeemCode(slug, initialCode || fromQuery);
    if (autoRan.current) return;
    const pending = takePartnerRedeemCodeForVerify(slug, initialCode || fromQuery);
    if (!pending) return;
    autoRan.current = true;
    const timerId = window.setTimeout(() => {
      void runVerify(pending);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [slug, initialCode, runVerify]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await runVerify(code);
  }

  async function handleLogout() {
    const result = await logoutPartner();
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="wb-partner-redeem">
      <div className="wb-partner-redeem-head">
        <p className="wb-partner-eyebrow">Redeem mode</p>
        <h1 className="wb-partner-title wb-partner-follow">{restaurantName}</h1>
        <p className="wb-partner-redeem-copy">
          Scan the guest&apos;s QR code or type their Wanderbite code. Then apply the discount on
          the check in your POS.
        </p>
      </div>

      {state.status === 'success' && (
        <div className="wb-partner-alert wb-partner-alert-ok wb-partner-result" role="status" aria-live="polite">
          <CheckCircle2 className="size-10" aria-hidden />
          <p className="wb-partner-alert-title">Verified</p>
          {state.savingsCopy ? <p data-confirmed-discount="">{state.savingsCopy}</p> : null}
          <p>Apply the Wanderbite discount on the guest&apos;s check.</p>
          {state.email && <p>Guest: {state.email}</p>}
          <p>{state.verifiedAt}</p>
          <button type="button" className="wb-cta-secondary wb-cta-secondary-cream wb-partner-secondary" onClick={() => setState({ status: 'idle' })}>
            Redeem another code
          </button>
        </div>
      )}

      {state.status === 'error' && (
        <div
          id="partner-redeem-error"
          className="wb-partner-alert wb-partner-alert-error wb-partner-result"
          role="alert"
          aria-live="assertive"
        >
          <XCircle className="size-10" aria-hidden />
          <p className="wb-partner-alert-title">{state.message}</p>
          <button type="button" className="wb-cta-secondary wb-cta-secondary-cream wb-partner-secondary" onClick={() => setState({ status: 'idle' })}>
            Try again
          </button>
        </div>
      )}

      {(state.status === 'idle' || state.status === 'verifying' || state.status === 'error') && (
        <form onSubmit={handleSubmit} className="wb-partner-form">
          <div>
            <label htmlFor="partner-redeem-code" className="wb-partner-label">
              Customer code
            </label>
            <input
              id="partner-redeem-code"
              type="text"
              value={code}
              onChange={(e) => setCode(partnerCodeInputValue(e.target.value))}
              placeholder="WB-XXXXX"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              className="wb-partner-code"
              disabled={state.status === 'verifying'}
              aria-invalid={state.status === 'error' || undefined}
              aria-describedby={
                state.status === 'error'
                  ? 'partner-redeem-hint partner-redeem-error'
                  : 'partner-redeem-hint'
              }
            />
            <p id="partner-redeem-hint" className="wb-partner-section-copy">
              {PARTNER_CODE_HINT}
            </p>
          </div>
          <button
            type="submit"
            className="wb-cta wb-partner-cta wb-partner-cta-block"
            disabled={state.status === 'verifying' || !code.trim()}
          >
            {state.status === 'verifying' ? (
              <>
                <Loader2 className="mr-2 size-5 animate-spin motion-reduce:animate-none" aria-hidden />
                Verifying…
              </>
            ) : (
              'Verify code'
            )}
          </button>
        </form>
      )}

      <div className="wb-partner-redeem-links">
        <Link href={`/partner/${slug}`}>Full dashboard</Link>
        <button type="button" onClick={handleLogout} className="wb-partner-text-button">
          Log out
        </button>
      </div>
    </div>
  );
}
