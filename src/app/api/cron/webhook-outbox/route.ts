import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { beginCronRun, completeCronRun } from '@/lib/cron-runs';
import { processWebhookOutbox } from '@/lib/stripe-outbox-worker';
import { getStripe } from '@/lib/stripe';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const runId = await beginCronRun('webhook-outbox');

  try {
    const result = await processWebhookOutbox({
      supabase: getSupabaseAdmin(),
      stripe: getStripe(),
    });

    const failed = result.eventErrors > 0 || result.outboxErrors > 0;
    await completeCronRun(runId, {
      status: failed ? 'failed' : 'success',
      result,
      error: failed
        ? `eventErrors=${result.eventErrors} outboxErrors=${result.outboxErrors}`
        : undefined,
    });

    return NextResponse.json(result, { status: failed ? 500 : 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cron] webhook-outbox:', err);
    Sentry.captureException(err, { tags: { cron: 'webhook-outbox' } });
    await completeCronRun(runId, { status: 'failed', error: message });
    await Sentry.flush(2000);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
