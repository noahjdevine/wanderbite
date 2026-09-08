import { describe, expect, it } from 'vitest';
import {
  stripeSubscriptionStatusToProfileStatus,
  UnknownStripeSubscriptionStatusError,
} from '@/lib/stripe-subscription';

describe('stripeSubscriptionStatusToProfileStatus', () => {
  it.each([
    ['active', 'active'],
    ['trialing', 'trialing'],
    ['past_due', 'past_due'],
    ['unpaid', 'past_due'],
    ['canceled', 'canceled'],
    ['incomplete_expired', 'canceled'],
    ['paused', 'paused'],
    ['incomplete', 'incomplete'],
  ] as const)('maps %s to %s', (stripeStatus, profileStatus) => {
    expect(stripeSubscriptionStatusToProfileStatus(stripeStatus)).toBe(profileStatus);
  });

  it('throws on an unknown Stripe status and does not map it to active', () => {
    expect(() => stripeSubscriptionStatusToProfileStatus('not_a_real_status')).toThrow(
      UnknownStripeSubscriptionStatusError
    );
    expect(() => stripeSubscriptionStatusToProfileStatus('not_a_real_status')).toThrow(
      /not_a_real_status/
    );
  });
});
