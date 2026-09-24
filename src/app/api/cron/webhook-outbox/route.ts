import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { runLeasedCron } from '@/lib/cron-runs';
import { processWebhookOutbox, webhookQueueSnapshot } from '@/lib/stripe-outbox-worker';
import { getStripe } from '@/lib/stripe';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const JOB = 'webhook-outbox';
const LEASE_SECONDS = 3 * 60;

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const exit = await runLeasedCron({
    jobName: JOB,
    runKey: JOB,
    leaseSeconds: LEASE_SECONDS,
    resumeExpired: false,
    allowNewAttempt: true,
    async work(ctx) {
      if (!(await ctx.renew())) return;
      let result: Awaited<ReturnType<typeof processWebhookOutbox>>;
      try {
        result = await processWebhookOutbox({
          supabase: getSupabaseAdmin(),
          stripe: getStripe(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Webhook outbox failed';
        Sentry.captureException(err, { tags: { cron: JOB } });
        await ctx.fail(message);
        return;
      }

      for (const item of result.items) {
        if (!(await ctx.renew())) return;
        const recorded = await ctx.record(
          item.itemKey,
          item.status,
          item.status === 'failed' ? 'claimed item did not finish' : null,
        );
        if (!recorded) return;
      }

      let backlog: number | null = null;
      let inFlight: number | null = null;
      try {
        const queue = await webhookQueueSnapshot(getSupabaseAdmin());
        backlog = queue.backlog;
        inFlight = queue.inFlight;
      } catch (err) {
        console.error('[cron] webhook queue snapshot failed:', err);
      }

      await ctx.finishClear({
        eventsClaimed: result.eventsClaimed,
        outboxClaimed: result.outboxClaimed,
        eventErrors: result.eventErrors,
        outboxErrors: result.outboxErrors,
        backlog,
        inFlight,
      });
    },
  });

  return NextResponse.json(exit.body, { status: exit.httpStatus });
}
