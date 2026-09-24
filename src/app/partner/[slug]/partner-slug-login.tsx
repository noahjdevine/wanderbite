'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
    <Card>
      <CardHeader className="space-y-1 pb-2 text-center">
        <p className="text-lg font-semibold tracking-tight text-foreground">
          Welcome, {restaurantName}
        </p>
        <p className="text-sm text-muted-foreground">
          {mode === 'redeem'
            ? 'Sign in to verify guest codes (bookmark this page for your host stand).'
            : 'Enter your PIN to access your Wanderbite partner dashboard'}
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="restaurantId" value={restaurantId} />
          {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}
          <div>
            <label htmlFor="partner-slug-pin" className="mb-1 block text-sm font-medium">
              PIN
            </label>
            <PartnerPinField
              id="partner-slug-pin"
              name="pin"
              disabled={pending}
              placeholder="Enter your PIN"
            />
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              name="rememberDevice"
              value="true"
              defaultChecked={mode === 'redeem'}
              className="mt-0.5"
              disabled={pending}
            />
            <span>Keep me signed in on this device (recommended for host iPad)</span>
          </label>
          {state && !state.ok ? (
            <p className="text-sm text-destructive" role="alert">
              {pinErrorCopy(state.error)}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Logging in…' : 'Log In'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
