'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { loginPartnerFromForm } from '@/app/actions/partner-auth';
import { PartnerPinField } from '@/components/partner/partner-pin-field';

type Restaurant = { id: string; name: string };

type PartnerLoginFormProps = {
  restaurants: Restaurant[];
};

export function PartnerLoginForm({ restaurants }: PartnerLoginFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(loginPartnerFromForm, null);

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
      <header className="mb-10 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Partner Portal</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Log in with your restaurant and PIN to redeem customer codes.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <p className="text-sm text-muted-foreground">
            Select your restaurant and enter the PIN provided to you.
          </p>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <div>
              <label htmlFor="partner-restaurant" className="mb-1 block text-sm font-medium">
                Restaurant
              </label>
              <select
                id="partner-restaurant"
                name="restaurantId"
                defaultValue=""
                className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                disabled={pending}
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
              <label htmlFor="partner-pin" className="mb-1 block text-sm font-medium">
                Restaurant PIN
              </label>
              <PartnerPinField
                id="partner-pin"
                name="pin"
                disabled={pending}
                placeholder="Enter your PIN"
              />
            </div>
            {state && !state.ok ? (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}
            {state?.ok ? (
              <p className="text-sm" role="status">
                Welcome, {state.restaurantName}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Logging in…' : 'Log in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
