import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { captureEvent } from '@/lib/posthog-server';
import { sendSubscriptionConfirmationEmail } from '@/lib/resend';
import {
  stripePeriodEndIso,
  stripeSubscriptionStatusToProfileStatus,
} from '@/lib/stripe-subscription';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

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

  let event: Stripe.Event;
  try {
    const { getStripe } = await import('@/lib/stripe');
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Stripe webhook signature verification failed:', message);
    return NextResponse.json(
      { error: `Webhook Error: ${message}` },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const customerId =
          typeof session.customer === 'string'
            ? session.customer
            : session.customer?.id ?? null;

        if (!userId) {
          console.error('checkout.session.completed: missing metadata.userId');
          break;
        }

        let currentPeriodEnd: string | null = null;
        if (session.subscription) {
          const subId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription.id;
          const { getStripe } = await import('@/lib/stripe');
          const raw = await getStripe().subscriptions.retrieve(subId);
          currentPeriodEnd = stripePeriodEndIso(raw);
        }

        const { error: updateError } = await supabase
          .from('user_profiles')
          .update({
            stripe_customer_id: customerId,
            subscription_status: 'active',
            current_period_end: currentPeriodEnd,
          })
          .eq('id', userId);

        if (updateError) {
          console.error('checkout.session.completed: profile update failed:', updateError.message);
        } else {
          await captureEvent(userId, 'subscription_started', {
            stripe_customer_id: customerId,
          });
        }

        const customerEmail =
          session.customer_email ??
          (session.customer_details as { email?: string } | null)?.email;
        if (customerEmail) {
          await sendSubscriptionConfirmationEmail(customerEmail);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === 'string'
            ? subscription.customer
            : subscription.customer?.id ?? null;

        if (!customerId) break;

        const { data: canceledProfile } = await supabase
          .from('user_profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .maybeSingle();

        await supabase
          .from('user_profiles')
          .update({ subscription_status: 'canceled' })
          .eq('stripe_customer_id', customerId);

        const canceledUserId = (canceledProfile as { id: string } | null)?.id;
        if (canceledUserId) {
          await captureEvent(canceledUserId, 'subscription_canceled', {
            stripe_customer_id: customerId,
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === 'string'
            ? invoice.customer
            : invoice.customer?.id ?? null;

        if (!customerId) break;

        await supabase
          .from('user_profiles')
          .update({ subscription_status: 'past_due' })
          .eq('stripe_customer_id', customerId);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === 'string'
            ? invoice.customer
            : invoice.customer?.id ?? null;

        if (!customerId) break;

        const periodEnd = invoice.period_end;
        const currentPeriodEnd = periodEnd
          ? new Date(periodEnd * 1000).toISOString()
          : null;

        await supabase
          .from('user_profiles')
          .update({
            subscription_status: 'active',
            current_period_end: currentPeriodEnd,
          })
          .eq('stripe_customer_id', customerId);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === 'string'
            ? subscription.customer
            : subscription.customer?.id ?? null;

        if (!customerId) break;

        const subscriptionStatus = stripeSubscriptionStatusToProfileStatus(
          subscription.status
        );
        const currentPeriodEnd = stripePeriodEndIso(subscription);

        await supabase
          .from('user_profiles')
          .update({
            subscription_status: subscriptionStatus,
            current_period_end: currentPeriodEnd,
          })
          .eq('stripe_customer_id', customerId);
        break;
      }

      default:
        // Unhandled event type – no-op
        break;
    }
  } catch (err) {
    Sentry.captureException(err);
    console.error('Webhook handler error:', err);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
