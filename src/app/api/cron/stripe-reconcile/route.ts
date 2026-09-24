import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { verifyCronAuth } from '@/lib/cron-auth';
import { dailyRunKey } from '@/lib/cron-period';
import { runLeasedCron, type CronLeaseContext } from '@/lib/cron-runs';
import {
  stripePeriodEndIso,
  stripeSubscriptionStatusToProfileStatus,
} from '@/lib/stripe-subscription';
import { getStripe } from '@/lib/stripe';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { Json } from '@/types/database.types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const JOB = 'stripe-reconcile';
const LEASE_SECONDS = 10 * 60;
const BATCH = 100;

type ItemStatus = 'succeeded' | 'skipped' | 'failed';

async function reconcileSubscription(
  subscription: Stripe.Subscription,
): Promise<{ status: ItemStatus; error: string | null; detail: Json }> {
  const admin = getSupabaseAdmin();
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  if (!customerId) {
    return { status: 'skipped', error: 'missing customer', detail: { subscriptionId: subscription.id } };
  }

  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('id, subscription_status, current_period_end, stripe_subscription_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (profileError) {
    return { status: 'failed', error: profileError.message, detail: { customerId, subscriptionId: subscription.id } };
  }
  if (!profile) {
    return { status: 'skipped', error: null, detail: { customerId, subscriptionId: subscription.id } };
  }
  if (profile.stripe_subscription_id && profile.stripe_subscription_id !== subscription.id) {
    return {
      status: 'skipped',
      error: null,
      detail: { customerId, subscriptionId: subscription.id, reason: 'different subscription' },
    };
  }

  let expectedStatus: string;
  try {
    expectedStatus = stripeSubscriptionStatusToProfileStatus(subscription.status);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Stripe subscription status';
    Sentry.captureException(err, {
      tags: { cron: JOB, userId: profile.id },
      extra: { stripeStatus: subscription.status, stripeCustomerId: customerId },
    });
    return { status: 'failed', error: message, detail: { customerId, subscriptionId: subscription.id } };
  }

  const expectedPeriodEnd = stripePeriodEndIso(subscription);
  if (
    profile.subscription_status === expectedStatus &&
    profile.current_period_end === expectedPeriodEnd
  ) {
    return { status: 'succeeded', error: null, detail: { customerId, subscriptionId: subscription.id, unchanged: true } };
  }

  const { error: updateError } = await admin
    .from('user_profiles')
    .update({
      subscription_status: expectedStatus,
      current_period_end: expectedPeriodEnd,
    })
    .eq('id', profile.id);
  if (updateError) {
    return { status: 'failed', error: updateError.message, detail: { customerId, subscriptionId: subscription.id } };
  }
  return {
    status: 'succeeded',
    error: null,
    detail: {
      customerId,
      subscriptionId: subscription.id,
      before: {
        subscription_status: profile.subscription_status,
        current_period_end: profile.current_period_end,
      },
      after: { subscription_status: expectedStatus, current_period_end: expectedPeriodEnd },
    },
  };
}

async function reconcilePages(ctx: CronLeaseContext): Promise<void> {
  const stripe = getStripe();
  let startingAfter: string | undefined;
  while (true) {
    if (!(await ctx.guardPeriod())) return;
    if (!(await ctx.renew())) return;
    let page: Stripe.ApiList<Stripe.Subscription>;
    try {
      page = await stripe.subscriptions.list({
        limit: BATCH,
        status: 'all',
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stripe list failed';
      Sentry.captureException(err, { tags: { cron: JOB } });
      await ctx.fail(message);
      return;
    }

    const ids = page.data.map((subscription) => subscription.id);
    const done = await ctx.terminalKeys(ids);
    const todo = page.data.filter((subscription) => !done.has(subscription.id));
    for (const subscription of todo) {
      if (!(await ctx.renew())) return;
      const recorded = await ctx.record(subscription.id, 'pending');
      if (!recorded) return;
    }
    for (const subscription of todo) {
      if (!(await ctx.guardPeriod())) return;
      if (!(await ctx.renew())) return;
      const outcome = await reconcileSubscription(subscription);
      const recorded = await ctx.record(subscription.id, outcome.status, outcome.error, outcome.detail);
      if (!recorded) return;
    }

    if (!page.has_more || page.data.length === 0) {
      await ctx.finishClear();
      return;
    }
    startingAfter = page.data[page.data.length - 1]!.id;
  }
}

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const exit = await runLeasedCron({
    jobName: JOB,
    runKey: dailyRunKey(JOB),
    leaseSeconds: LEASE_SECONDS,
    resumeExpired: true,
    allowNewAttempt: false,
    currentPeriod: () => dailyRunKey(JOB),
    work: reconcilePages,
  });

  return NextResponse.json(exit.body, { status: exit.httpStatus });
}
