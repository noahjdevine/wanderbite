'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { createCheckoutSession } from '@/app/actions/stripe';

const FEATURES = [
  '$10 off at every spot',
  'Curated selection',
  'Cancel anytime',
  'No expiration on unlocked rewards',
  '1 Free Swap per month',
];

type BillingInterval = 'monthly' | 'annual';

type PricingClientProps = {
  userId?: string | null;
  email?: string | null;
};

export function PricingClient({ userId, email }: PricingClientProps) {
  const [loading, setLoading] = useState(false);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('monthly');
  const canSubscribe = userId && email?.trim();

  async function handleJoinClub() {
    if (!canSubscribe) return;
    const safeEmail = email?.trim() ?? '';
    setLoading(true);
    try {
      const result = await createCheckoutSession(userId!, safeEmail);
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
    <div className="mx-auto max-w-2xl">
      {/* Header */}
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Simple, Transparent Pricing.
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Join the club and start saving immediately.
        </p>
      </header>

      {/* Billing interval toggle */}
      <div className="mt-10 flex justify-center">
        <div
          role="group"
          aria-label="Billing interval"
          className="inline-flex rounded-lg border border-input bg-muted/50 p-1"
        >
          <button
            type="button"
            onClick={() => setBillingInterval('monthly')}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              billingInterval === 'monthly'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setBillingInterval('annual')}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              billingInterval === 'annual'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Annual
          </button>
        </div>
      </div>

      {/* Main Card */}
      <Card className="mt-6 border-2 shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Wanderbite Club</CardTitle>
          <CardDescription className="text-base">
            One plan. Two adventures every month.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center">
            {billingInterval === 'monthly' ? (
              <p className="text-4xl font-bold tracking-tight text-primary">
                $15<span className="text-lg font-normal text-muted-foreground">/month</span>
              </p>
            ) : (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <p className="text-4xl font-bold tracking-tight text-primary">
                  $120<span className="text-lg font-normal text-muted-foreground">/year</span>
                </p>
                <Badge variant="secondary" className="text-xs">
                  Save $60 a year!
                </Badge>
              </div>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              Includes 2 Curated Adventures per month ($20+ value).
            </p>
          </div>
          <ul className="space-y-3">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-center gap-3 text-sm">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Check className="size-3" aria-hidden />
                </span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>

          <div className="space-y-2 rounded-lg border border-border/50 bg-muted/30 p-3 text-xs text-muted-foreground">
            <p>
              Plan: $15/month (billed monthly). Auto-renews until canceled. Includes 2 challenges/month
              and 1 swap/month. Cancel anytime in Settings → Manage Subscription; cancellation takes
              effect at the end of your current billing period. No partial refunds. Discount redemptions
              are subject to restaurant terms (including $10 off $40+ before tax/tip, non-stackable,
              and in-person confirmation).
            </p>
            <p>
              By subscribing, you agree to our{' '}
              <Link href="/terms" className="underline hover:text-foreground">
                Terms of Service
              </Link>
              ,{' '}
              <Link href="/privacy" className="underline hover:text-foreground">
                Privacy Policy
              </Link>
              , and{' '}
              <Link href="/rules" className="underline hover:text-foreground">
                Discount & Challenge Rules
              </Link>
              .
            </p>
          </div>
        </CardContent>
        <CardFooter className="justify-center">
          {canSubscribe ? (
            <Button
              size="lg"
              onClick={handleJoinClub}
              disabled={loading}
              className="w-full sm:w-auto"
            >
              {loading ? 'Redirecting…' : 'Join the Club'}
            </Button>
          ) : (
            <Button size="lg" asChild className="w-full sm:w-auto">
              <Link href="/signup">Join the Club</Link>
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
