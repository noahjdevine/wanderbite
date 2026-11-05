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
import { AreaHoldNotice } from '@/components/area-hold-notice';
import { CLUB_PLAN_FEATURES } from '@/lib/club-plan-content';
import { LAUNCH_MARKET, type LaunchAreaState } from '@/lib/launch-market';

type PricingClientProps = {
  userId?: string | null;
  email?: string | null;
  fullName?: string | null;
  subscriptionStatus?: string | null;
  areaState?: LaunchAreaState | null;
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
  areaState = null,
}: PricingClientProps) {
  const isActive = subscriptionStatus === 'active';
  const firstName = firstNameFromFullName(fullName);
  const ineligible = Boolean(userId) && areaState === 'ineligible';
  const missingAddress = Boolean(userId) && areaState === 'missing_address';

  return (
    <div>
      <header className="wb-pricing-band">
        <div className="wb-pricing-wrap">
          <p className="wb-pricing-eyebrow">Now launching in {LAUNCH_MARKET.displayName}</p>
          <h1>
            {isActive ? (
              <>
                Your Wanderbite Club <em className="wb-accent">plan</em>
              </>
            ) : userId ? (
              <>
                {`Welcome${firstName ? `, ${firstName}` : ''}! Membership checkout is `}
                <em className="wb-accent">paused.</em>
              </>
            ) : (
              <>
                Simple, Transparent <em className="wb-accent">Pricing.</em>
              </>
            )}
          </h1>
          <p className="wb-pricing-lede">
            {isActive
              ? 'Manage your subscription anytime.'
              : 'Paid checkout is launching soon. You can still create a free account.'}
          </p>
        </div>
      </header>

      <div className="wb-pricing-sheet wb-on-cream">
        <div className="wb-pricing-wrap">
          <Card className="wb-pricing-card">
            <CardHeader className="text-center">
              <CardTitle>
                Wanderbite <em className="wb-accent">Club</em>
              </CardTitle>
              <CardDescription>
                One plan. Two adventures every month in {LAUNCH_MARKET.displayName}.
              </CardDescription>
            </CardHeader>
            <CardContent className="wb-pricing-body">
              <div className="text-center">
                <p className="wb-pricing-price">
                  $15<span>/month</span>
                </p>
                <p className="wb-pricing-note">
                  Includes 2 curated adventures per month. Coming soon.
                </p>
              </div>
              <ul className="wb-pricing-features">
                {CLUB_PLAN_FEATURES.map((feature) => (
                  <li key={feature}>
                    <span className="wb-pricing-check">
                      <Check aria-hidden />
                    </span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="wb-pricing-fine">
                <p>
                  Plan (when checkout reopens): $15/month (billed monthly). Auto-renews until canceled.
                  Includes 2 challenges/month and 1 swap/month. Cancel anytime in Settings → Manage
                  Subscription; cancellation takes effect at the end of your current billing period. No
                  partial refunds. Each challenge shows its discount and minimum spend. Offers are
                  non-stackable and require in-person confirmation.
                </p>
                {userId ? (
                  <p>
                    See our <Link href="/terms">Terms</Link>, <Link href="/privacy">Privacy</Link>, and{' '}
                    <Link href="/rules">Rules</Link>.
                  </p>
                ) : (
                  <p>
                    By creating an account, you agree to our{' '}
                    <Link href="/terms">Terms of Service</Link>
                    ,{' '}
                    <Link href="/privacy">Privacy Policy</Link>
                    , and{' '}
                    <Link href="/rules">Discount & Challenge Rules</Link>
                    .
                  </p>
                )}
              </div>
            </CardContent>
            <CardFooter className="wb-pricing-actions">
              {isActive ? (
                <Button size="lg" asChild>
                  <Link href="/billing">Manage my plan</Link>
                </Button>
              ) : ineligible ? (
                <AreaHoldNotice />
              ) : missingAddress ? (
                <Button size="lg" asChild>
                  <Link href="/onboarding">Finish your profile</Link>
                </Button>
              ) : (
                <>
                  <LaunchHoldNotice />
                  {!userId ? (
                    <Button size="lg" variant="outline" asChild>
                      <Link href="/signup">Create a free account</Link>
                    </Button>
                  ) : null}
                </>
              )}
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
