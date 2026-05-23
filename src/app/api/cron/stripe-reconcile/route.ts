import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { verifyCronAuth } from '@/lib/cron-auth';
import { beginCronRun, completeCronRun } from '@/lib/cron-runs';
import {
  stripePeriodEndIso,
  stripeSubscriptionStatusToProfileStatus,
} from '@/lib/stripe-subscription';
import { getStripe } from '@/lib/stripe';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type MismatchRecord = {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  before: { subscription_status: string | null; current_period_end: string | null };
  after: { subscription_status: string; current_period_end: string | null };
};

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const runId = await beginCronRun('stripe-reconcile');

  try {
    const stripe = getStripe();
    const admin = getSupabaseAdmin();
    const mismatches: MismatchRecord[] = [];
    const fixed: MismatchRecord[] = [];
    let scanned = 0;

    let startingAfter: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const page: Stripe.ApiList<Stripe.Subscription> = await stripe.subscriptions.list({
        limit: 100,
        status: 'all',
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      for (const subscription of page.data) {
        scanned++;
        const customerId =
          typeof subscription.customer === 'string'
            ? subscription.customer
            : subscription.customer?.id;

        if (!customerId) continue;

        const { data: profile } = await admin
          .from('user_profiles')
          .select('id, subscription_status, current_period_end')
          .eq('stripe_customer_id', customerId)
          .maybeSingle();

        if (!profile) continue;

        const row = profile as {
          id: string;
          subscription_status: string | null;
          current_period_end: string | null;
        };

        const expectedStatus = stripeSubscriptionStatusToProfileStatus(subscription.status);
        const expectedPeriodEnd = stripePeriodEndIso(subscription);

        const statusMismatch = row.subscription_status !== expectedStatus;
        const periodMismatch = row.current_period_end !== expectedPeriodEnd;

        if (!statusMismatch && !periodMismatch) continue;

        const record: MismatchRecord = {
          userId: row.id,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscription.id,
          before: {
            subscription_status: row.subscription_status,
            current_period_end: row.current_period_end,
          },
          after: {
            subscription_status: expectedStatus,
            current_period_end: expectedPeriodEnd,
          },
        };

        mismatches.push(record);

        const { error: updateError } = await admin
          .from('user_profiles')
          .update({
            subscription_status: expectedStatus,
            current_period_end: expectedPeriodEnd,
          })
          .eq('id', row.id);

        if (updateError) {
          console.error(
            `[cron] stripe-reconcile update failed for ${row.id}:`,
            updateError.message
          );
        } else {
          fixed.push(record);
        }
      }

      hasMore = page.has_more;
      if (page.data.length > 0) {
        startingAfter = page.data[page.data.length - 1]!.id;
      } else {
        hasMore = false;
      }
    }

    const result = {
      scanned,
      mismatchesFound: mismatches.length,
      fixed: fixed.length,
      mismatches,
      fixedRecords: fixed,
    };

    await completeCronRun(runId, { status: 'success', result });

    return NextResponse.json({
      scanned,
      mismatchesFound: mismatches.length,
      fixed: fixed.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cron] stripe-reconcile:', err);
    await completeCronRun(runId, { status: 'failed', error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
