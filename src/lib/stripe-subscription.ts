import type Stripe from 'stripe';

export function stripeSubscriptionStatusToProfileStatus(
  status: Stripe.Subscription.Status
): string {
  switch (status) {
    case 'active':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'unpaid':
      return 'past_due';
    default:
      return 'active';
  }
}

export function stripePeriodEndIso(subscription: Stripe.Subscription): string | null {
  const raw = subscription as Stripe.Subscription & { current_period_end?: number | null };
  const periodEnd =
    raw.current_period_end ?? subscription.items?.data?.[0]?.current_period_end ?? null;
  return periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
}
