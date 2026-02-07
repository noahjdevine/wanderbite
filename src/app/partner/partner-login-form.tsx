'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { loginPartner } from '@/app/actions/partner-auth';

type Restaurant = { id: string; name: string };

type PartnerLoginFormProps = {
  restaurants: Restaurant[];
};

export function PartnerLoginForm({ restaurants }: PartnerLoginFormProps) {
  const router = useRouter();
  const [restaurantId, setRestaurantId] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!restaurantId.trim() || !pin.trim()) {
      toast.error('Select your restaurant and enter your PIN.');
      return;
    }
    setLoading(true);
    try {
      const result = await loginPartner(restaurantId, pin);
      if (result.ok) {
        toast.success(`Welcome, ${result.restaurantName}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error('Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header className="mb-10 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Partner Portal
        </h1>
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
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="partner-restaurant" className="mb-1 block text-sm font-medium">
                Restaurant
              </label>
              <select
                id="partner-restaurant"
                value={restaurantId}
                onChange={(e) => setRestaurantId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                disabled={loading}
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
              <input
                id="partner-pin"
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter your PIN"
                autoComplete="off"
                className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                disabled={loading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Logging in…' : 'Log in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
