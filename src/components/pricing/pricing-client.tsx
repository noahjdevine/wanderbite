'use client';

import Link from 'next/link';
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
import { LaunchHoldNotice } from '@/components/launch-hold-notice';
import { CLUB_PLAN_FEATURES } from '@/lib/club-plan-content';

type PricingClientProps = {
  userId?: string | null;
  email?: string | null;
  fullName?: string | null;
  subscriptionStatus?: string | null;
};

function firstNameFromFullName(fullName: string | null | undefined): string | null {
  const t = fullName?.trim();
  if (!t) return null;
  const first = t.split(/\s+/)[0]?.trim();
  return first || null;
}

export function PricingClient({
  userId,
  email: _email,
  fullName,
  subscriptionStatus,
}: PricingClientProps) {
  const isActive = subscriptionStatus === 'active';
  const firstName = firstNameFromFullName(fullName);

  return (
    <div className="mx-auto max-w-2xl">
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {isActive
            ? 'Your plan, your perks.'
            : userId
              ? `Welcome${firstName ? `, ${firstName}` : ''}! Membership checkout is paused.`
              : 'Simple, Transparent Pricing.'}
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">
          {isActive
            ? 'Manage your subscription anytime.'
            : 'Paid checkout is launching soon. You can still create a free account.'}
        </p>
      </header>

      <Card className="mt-10 border-2 shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Wanderbite Club</CardTitle>
          <CardDescription className="text-base">
            One plan. Two adventures every month.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center">
            <p className="text-4xl font-bold tracking-tight text-primary">
              $15<span className="text-lg font-normal text-muted-foreground">/month</span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Includes 2 Curated Adventures per month ($20+ value). Coming soon.
            </p>
          </div>
          <ul className="space-y-3">
            {CLUB_PLAN_FEATURES.map((feature) => (
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
              Plan (when checkout reopens): $15/month (billed monthly). Auto-renews until canceled.
              Includes 2 challenges/month and 1 swap/month. Cancel anytime in Settings → Manage
              Subscription; cancellation takes effect at the end of your current billing period. No
              partial refunds. Discount redemptions are subject to restaurant terms (including $10 off
              $40+ before tax/tip, non-stackable, and in-person confirmation).
            </p>
            <p>
              By creating an account, you agree to our{' '}
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
        <CardFooter className="flex flex-col gap-3">
          {isActive ? (
            <Button size="lg" asChild className="w-full sm:w-auto">
              <Link href="/billing">Manage my plan</Link>
            </Button>
          ) : (
            <>
              <LaunchHoldNotice />
              {!userId ? (
                <Button size="lg" variant="outline" asChild className="w-full sm:w-auto">
                  <Link href="/signup">Create a free account</Link>
                </Button>
              ) : null}
            </>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
