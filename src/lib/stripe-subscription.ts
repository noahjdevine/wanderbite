export type ProfileSubscriptionStatus =
  | 'inactive'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'trialing'
  | 'paused'
  | 'incomplete';

export class UnknownStripeSubscriptionStatusError extends Error {
  constructor(readonly stripeStatus: string) {
    super(`Unknown Stripe subscription status: ${stripeStatus}`);
    this.name = 'UnknownStripeSubscriptionStatusError';
  }
}

export function stripeSubscriptionStatusToProfileStatus(
  status: string
): ProfileSubscriptionStatus {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
      return 'past_due';
    case 'unpaid':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'incomplete_expired':
      return 'canceled';
    case 'paused':
      return 'paused';
    case 'incomplete':
      return 'incomplete';
    default:
      throw new UnknownStripeSubscriptionStatusError(status);
  }
}

export function stripePeriodEndIso(subscription: {
  current_period_end?: number | null;
  items?: { data?: Array<{ current_period_end?: number | null }> };
}): string | null {
  const periodEnd =
    subscription.current_period_end ??
    subscription.items?.data?.[0]?.current_period_end ??
    null;
  return periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
}
