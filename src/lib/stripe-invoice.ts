import type Stripe from 'stripe';

/** Stripe API v20+ stores the parent subscription here, not on invoice.subscription. */
export function stripeInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const parentSub = invoice.parent?.subscription_details?.subscription;
  if (!parentSub) return null;
  if (typeof parentSub === 'string') return parentSub;
  if (typeof parentSub === 'object' && 'id' in parentSub && typeof parentSub.id === 'string') {
    return parentSub.id;
  }
  return null;
}
