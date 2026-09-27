import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { dailyRunKey } from '@/lib/cron-period';
import { runLeasedCron } from '@/lib/cron-runs';
import {
  ROLLOVER_JOB,
  rolloverCredits,
  rolloverItemStatus,
  type RolloverNotice,
  type RolloverProfileQuery,
  type RolloverResult,
} from '@/lib/challenges/rollover-credits';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const LEASE_SECONDS = 10 * 60;

function failedCarry(outcome: string): boolean {
  return outcome === 'rolled_with_exception' && rolloverItemStatus(outcome) === 'failed';
}

async function listActiveCreditProfiles(
  query: RolloverProfileQuery,
): Promise<{ id: string }[]> {
  if (query.subscriptionStatus !== 'active' || query.workflowVersion !== 'credits') {
    throw new Error(
      'credit rollover snapshot is subscription_status active and workflow_version credits',
    );
  }
  const admin = getSupabaseAdmin();
  let request = admin
    .from('user_profiles')
    .select('id')
    .eq('subscription_status', query.subscriptionStatus)
    .eq('workflow_version', query.workflowVersion)
    .order('id', { ascending: true })
    .limit(query.limit);
  if (query.afterId) request = request.gt('id', query.afterId);
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id }));
}

async function rolloverUser(userId: string): Promise<RolloverResult> {
  const { data, error } = await getSupabaseAdmin().rpc('rollover_credits', {
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row || typeof row.outcome !== 'string' || typeof row.exception_inserted !== 'boolean') {
    throw new Error('rollover_credits did not return outcome and exception_inserted');
  }
  return { outcome: row.outcome, exceptionInserted: row.exception_inserted };
}

async function notifyOperator(notice: RolloverNotice): Promise<void> {
  if (!failedCarry(notice.outcome)) return;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('credit_rollover_exceptions')
    .select('linked_uncompleted_count, future_t2_count')
    .eq('user_id', notice.userId)
    .eq('chicago_month', notice.chicagoMonth)
    .eq('reason', 'carry_cap_exceeded')
    .maybeSingle();
  if (error) throw new Error(error.message);
  Sentry.captureMessage('Credit rollover carry cap exceeded', {
    level: 'error',
    tags: { cron: 'rollover-credits' },
    extra: {
      userId: notice.userId,
      chicagoMonth: notice.chicagoMonth,
      linkedUncompletedCount: data?.linked_uncompleted_count ?? null,
      futureT2Count: data?.future_t2_count ?? null,
    },
  });
}

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const now = new Date();
  const runKey = dailyRunKey(ROLLOVER_JOB, now);
  const exit = await runLeasedCron({
    jobName: ROLLOVER_JOB,
    runKey,
    leaseSeconds: LEASE_SECONDS,
    resumeExpired: true,
    allowNewAttempt: false,
    currentPeriod: () => dailyRunKey(ROLLOVER_JOB),
    work: (ctx) =>
      rolloverCredits({
        now,
        runKey,
        listProfiles: listActiveCreditProfiles,
        rolloverUser,
        notifyOperator,
        lease: ctx,
      }),
  });

  return NextResponse.json(exit.body, { status: exit.httpStatus });
}
