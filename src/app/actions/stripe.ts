'use server';

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getStripe } from '@/lib/stripe';

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? '';
const priceId = process.env.STRIPE_PRICE_ID ?? '';

export type CreateCheckoutSessionResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Creates a Stripe Checkout Session for subscription and returns the session URL.
 */
export async function createCheckoutSession(
  userId: string,
  email: string
): Promise<CreateCheckoutSessionResult> {
  if (!priceId) {
    return { ok: false, error: 'Stripe price is not configured.' };
  }
  if (!baseUrl) {
    return { ok: false, error: 'NEXT_PUBLIC_BASE_URL is not set.' };
  }

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/?success=true`,
      cancel_url: `${baseUrl}/?canceled=true`,
      customer_email: email,
      metadata: { userId },
    });

    const url = session.url;
    if (!url) {
      return { ok: false, error: 'Failed to create checkout URL.' };
    }
    return { ok: true, url };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Checkout failed.';
    return { ok: false, error: message };
  }
}

export type CreateBillingPortalSessionResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Creates a Stripe Customer Portal session so the user can manage subscription and payment methods.
 */
export async function createBillingPortalSession(
  userId: string
): Promise<CreateBillingPortalSessionResult> {
  if (!baseUrl) {
    return { ok: false, error: 'NEXT_PUBLIC_BASE_URL is not set.' };
  }

  const admin = getSupabaseAdmin();
  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();

  if (profileError || !profile) {
    return { ok: false, error: 'Could not load your billing profile.' };
  }

  const customerId = (profile as { stripe_customer_id: string | null }).stripe_customer_id;
  if (!customerId) {
    return { ok: false, error: 'No billing account found. Subscribe first to manage your plan.' };
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/billing`,
    });

    const url = session.url;
    if (!url) {
      return { ok: false, error: 'Failed to create billing portal URL.' };
    }
    return { ok: true, url };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Billing portal failed.';
    return { ok: false, error: message };
  }
}
