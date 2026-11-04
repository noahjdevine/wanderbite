'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { loginPartnerFromForm } from '@/app/actions/partner-auth';
import { PartnerPinField } from '@/components/partner/partner-pin-field';

type Restaurant = { id: string; name: string };

type PartnerLoginFormProps = {
  restaurants: Restaurant[];
};

const PIN_ERROR_ID = 'partner-pin-error';

export function PartnerLoginForm({ restaurants }: PartnerLoginFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(loginPartnerFromForm, null);
  const invalid = Boolean(state && !state.ok);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(`Welcome, ${state.restaurantName}`);
      router.refresh();
      return;
    }
    toast.error(state.error);
  }, [state, router]);

  return (
    <>
      <header className="wb-partner-center">
        <h1 className="wb-partner-title">Partner Portal</h1>
        <p className="wb-partner-lede">
          Log in with your restaurant and PIN to redeem customer codes.
        </p>
      </header>

      <div className="wb-partner-card wb-partner-follow-lg">
        <p className="wb-partner-section-copy">
          Select your restaurant and enter the PIN provided to you.
        </p>
        <form action={formAction} className="wb-partner-form wb-partner-follow">
          <div>
            <label htmlFor="partner-restaurant" className="wb-partner-label">
              Restaurant
            </label>
            <select
              id="partner-restaurant"
              name="restaurantId"
              defaultValue=""
              className="wb-partner-field"
              disabled={pending}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? PIN_ERROR_ID : undefined}
            >
              <option value="">— Select restaurant —</option>
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="partner-pin" className="wb-partner-label">
              Restaurant PIN
            </label>
            <PartnerPinField
              id="partner-pin"
              name="pin"
              disabled={pending}
              placeholder="Enter your PIN"
              className="wb-partner-field"
              describedBy={invalid ? PIN_ERROR_ID : undefined}
              invalid={invalid}
            />
          </div>
          {state && !state.ok ? (
            <p id={PIN_ERROR_ID} className="wb-partner-alert wb-partner-alert-error" role="alert" aria-live="assertive">
              {state.error}
            </p>
          ) : null}
          {state?.ok ? (
            <p className="wb-partner-section-copy" role="status" aria-live="polite">
              Welcome, {state.restaurantName}
            </p>
          ) : null}
          <button type="submit" className="wb-cta wb-partner-cta wb-partner-cta-block" disabled={pending}>
            {pending ? 'Logging in…' : 'Log in'}
          </button>
        </form>
      </div>
    </>
  );
}
