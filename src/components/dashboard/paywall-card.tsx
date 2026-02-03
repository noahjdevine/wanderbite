'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { createCheckoutSession } from '@/app/actions/stripe';

type PaywallCardProps = {
  userId: string;
  email: string | null;
};

export function PaywallCard({ userId, email }: PaywallCardProps) {
  const [loading, setLoading] = useState(false);

  async function handleSubscribe() {
    const safeEmail = email?.trim() || undefined;
    if (!safeEmail) {
      toast.error('Please add an email in your profile to subscribe.');
      return;
    }
    setLoading(true);
    try {
      const result = await createCheckoutSession(userId, safeEmail);
      if (result.ok) {
        window.location.href = result.url;
        return;
      }
      toast.error(result.error);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Join the Wanderbite Club</CardTitle>
          <CardDescription>
            Unlock 2 curated dining adventures every month. Get $10 off at each spot.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Just $15/mo (That&apos;s $20 in value!)
          </p>
        </CardContent>
        <CardFooter>
          <Button onClick={handleSubscribe} disabled={loading}>
            {loading ? 'Redirecting…' : 'Subscribe for $15/mo'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

/**
 * Client component that shows a "Welcome!" toast when URL has ?success=true.
 */
export function SubscriptionSuccessToast() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    const success = searchParams.get('success');
    if (success === 'true') {
      toast.success('Welcome!');
      setShown(true);
      router.replace('/', { scroll: false });
      router.refresh();
    }
  }, [searchParams, router, shown]);

  return null;
}
