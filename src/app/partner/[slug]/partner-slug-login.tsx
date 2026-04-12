'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { loginPartner } from '@/app/actions/partner-auth';

type PartnerSlugLoginProps = {
  restaurantId: string;
  restaurantName: string;
};

export function PartnerSlugLogin({
  restaurantId,
  restaurantName,
}: PartnerSlugLoginProps) {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = pin.trim();
    if (!trimmed) {
      toast.error('Enter your PIN.');
      return;
    }
    setLoading(true);
    try {
      const result = await loginPartner(restaurantId, trimmed);
      if (result.ok) {
        toast.success(`Welcome, ${result.restaurantName}`);
        router.refresh();
      } else {
        const err = result.error ?? '';
        toast.error(
          /invalid pin/i.test(err)
            ? 'Invalid PIN. Please contact support@wanderbite.com'
            : err
        );
      }
    } catch {
      toast.error(
        'Invalid PIN. Please contact support@wanderbite.com'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-1 pb-2 text-center">
        <p className="text-lg font-semibold tracking-tight text-foreground">
          Welcome, {restaurantName}
        </p>
        <p className="text-sm text-muted-foreground">
          Enter your PIN to access your Wanderbite partner dashboard
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="partner-slug-pin" className="mb-1 block text-sm font-medium">
              PIN
            </label>
            <input
              id="partner-slug-pin"
              type="number"
              inputMode="numeric"
              value={pin}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                setPin(v);
              }}
              placeholder="Enter your PIN"
              autoComplete="off"
              className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              disabled={loading}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Logging in…' : 'Log In'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
