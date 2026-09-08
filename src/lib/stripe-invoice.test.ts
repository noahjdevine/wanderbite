import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { stripeInvoiceSubscriptionId } from '@/lib/stripe-invoice';

describe('stripeInvoiceSubscriptionId', () => {
  it('reads a string from parent.subscription_details.subscription', () => {
    const invoice = {
      parent: {
        subscription_details: { subscription: 'sub_123', metadata: null },
        quote_details: null,
        type: 'subscription_details',
      },
    } as Stripe.Invoice;
    expect(stripeInvoiceSubscriptionId(invoice)).toBe('sub_123');
  });

  it('reads an expanded subscription object', () => {
    const invoice = {
      parent: {
        subscription_details: {
          subscription: { id: 'sub_expanded' },
          metadata: { userId: 'user-1' },
        },
        quote_details: null,
        type: 'subscription_details',
      },
    } as unknown as Stripe.Invoice;
    expect(stripeInvoiceSubscriptionId(invoice)).toBe('sub_expanded');
  });

  it('returns null when the invoice has no subscription parent', () => {
    expect(stripeInvoiceSubscriptionId({ parent: null } as Stripe.Invoice)).toBeNull();
  });
});
