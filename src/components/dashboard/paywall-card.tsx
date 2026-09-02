'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { LaunchHoldNotice } from '@/components/launch-hold-notice';

type PaywallCardProps = {
  email: string | null;
};

export function PaywallCard({ email: _email }: PaywallCardProps) {
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
            Just $15/mo (That&apos;s $20 in value!) when checkout reopens.
          </p>
        </CardContent>
        <CardFooter>
          <LaunchHoldNotice />
        </CardFooter>
      </Card>
    </div>
  );
}

/**
 * Shows a welcome toast when returning from Stripe checkout (?checkout=success or legacy ?success=true).
 */
export function SubscriptionSuccessToast() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toastShown = useRef(false);

  useEffect(() => {
    if (toastShown.current) return;
    const legacySuccess = searchParams.get('success');
    const checkoutSuccess = searchParams.get('checkout');
    if (legacySuccess === 'true' || checkoutSuccess === 'success') {
      toastShown.current = true;
      toast.success('Welcome to the Club!');
      router.replace(pathname || '/', { scroll: false });
      router.refresh();
    }
  }, [searchParams, router, pathname]);

  return null;
}
