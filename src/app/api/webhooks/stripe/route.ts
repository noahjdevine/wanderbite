import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { handleStripeWebhookEvent } from '@/lib/stripe-webhook';

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('Missing STRIPE_WEBHOOK_SECRET');
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 }
    );
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    );
  }

  const rawBody = await (await request.blob()).text();

  let event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Stripe webhook signature verification failed:', message);
    return NextResponse.json(
      { error: `Webhook Error: ${message}` },
      { status: 400 }
    );
  }

  try {
    const result = await handleStripeWebhookEvent({
      event,
      supabase: getSupabaseAdmin(),
      stripe: getStripe(),
    });
    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (err) {
    Sentry.captureException(err, { tags: { webhook: 'stripe' } });
    console.error('Webhook handler error:', err);
    await Sentry.flush(2000);
    const message = err instanceof Error ? err.message : 'Webhook handler failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
