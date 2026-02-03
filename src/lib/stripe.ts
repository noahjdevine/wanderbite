import Stripe from 'stripe';

let _stripe: Stripe | null = null;

/**
 * Lazily creates and returns the Stripe client. Only reads STRIPE_SECRET_KEY at runtime,
 * so the build can succeed without the key (e.g. on Vercel); the key must be set in
 * the deployment environment for webhooks and checkout to work.
 */
export function getStripe(): Stripe {
  if (!_stripe) {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      throw new Error('Missing STRIPE_SECRET_KEY');
    }
    _stripe = new Stripe(secret);
  }
  return _stripe;
}
