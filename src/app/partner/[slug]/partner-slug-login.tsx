'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { loginPartnerFromForm } from '@/app/actions/partner-auth';
import { persistAndStripPartnerRedeemCode } from '@/lib/pending-redeem-storage';
import { PartnerPinField } from '@/components/partner/partner-pin-field';

type PartnerSlugLoginProps = {
  restaurantId: string;
  restaurantName: string;
  mode?: 'dashboard' | 'redeem';
  redirectSlug?: string;
  initialCode?: string | null;
};

const PIN_ERROR_ID = 'partner-slug-pin-error';

function pinErrorCopy(error: string): string {
  return /invalid pin/i.test(error)
    ? 'Invalid PIN. Please contact support@wanderbite.com'
    : error;
}

export function PartnerSlugLogin({
  restaurantId,
  restaurantName,
  mode = 'dashboard',
  redirectSlug,
  initialCode,
}: PartnerSlugLoginProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(loginPartnerFromForm, null);
  const invalid = Boolean(state && !state.ok);
  const nextPath =
    mode === 'redeem' && redirectSlug
      ? `/partner/${redirectSlug}/redeem`
      : redirectSlug
        ? `/partner/${redirectSlug}`
        : '';

  useEffect(() => {
    if (mode !== 'redeem' || !redirectSlug) return;
    const fromQuery = new URLSearchParams(window.location.search).get('code');
    persistAndStripPartnerRedeemCode(redirectSlug, fromQuery || initialCode);
  }, [mode, redirectSlug, initialCode]);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(`Welcome, ${state.restaurantName}`);
      if (mode === 'redeem' && redirectSlug) {
        router.replace(`/partner/${redirectSlug}/redeem`);
      } else {
        router.refresh();
      }
      return;
    }
    toast.error(pinErrorCopy(state.error));
  }, [state, mode, redirectSlug, router]);

  return (
    <div className="wb-partner-card">
      <header className="wb-partner-center">
        <h1 className="wb-partner-title">Welcome, {restaurantName}</h1>
        <p className="wb-partner-section-copy">
          {mode === 'redeem'
            ? 'Sign in to verify guest codes (bookmark this page for your host stand).'
            : 'Enter your PIN to access your Wanderbite partner dashboard'}
        </p>
      </header>
      <form action={formAction} className="wb-partner-form wb-partner-follow">
        <input type="hidden" name="restaurantId" value={restaurantId} />
        {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}
        <div>
          <label htmlFor="partner-slug-pin" className="wb-partner-label">
            PIN
          </label>
          <PartnerPinField
            id="partner-slug-pin"
            name="pin"
            disabled={pending}
            placeholder="Enter your PIN"
            className="wb-partner-field"
            describedBy={invalid ? PIN_ERROR_ID : undefined}
            invalid={invalid}
          />
        </div>
        <label className="wb-partner-check-row">
          <input
            type="checkbox"
            name="rememberDevice"
            value="true"
            defaultChecked={mode === 'redeem'}
            className="wb-partner-check"
            disabled={pending}
          />
          <span>Keep me signed in on this device (recommended for host iPad)</span>
        </label>
        {state && !state.ok ? (
          <p id={PIN_ERROR_ID} className="wb-partner-alert wb-partner-alert-error" role="alert" aria-live="assertive">
            {pinErrorCopy(state.error)}
          </p>
        ) : null}
        <button type="submit" className="wb-cta wb-partner-cta wb-partner-cta-block" disabled={pending}>
          {pending ? 'Logging in…' : 'Log In'}
        </button>
      </form>
    </div>
  );
}
