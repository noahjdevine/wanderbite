import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { chicagoMonthStart, dailyRunKey } from '@/lib/cron-period';
import { runLeasedCron } from '@/lib/cron-runs';
import {
  CREDIT_CATCHUP_JOB,
  issueCreditCatchup,
  type CreditCatchupProfileQuery,
} from '@/lib/challenges/issue-credit-catchup';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const LEASE_SECONDS = 10 * 60;

async function listActiveCreditProfiles(
  query: CreditCatchupProfileQuery,
): Promise<{ id: string }[]> {
  if (query.subscriptionStatus !== 'active' || query.workflowVersion !== 'credits') {
    throw new Error(
      'credit catch-up snapshot is subscription_status active and workflow_version credits',
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

async function issueCurrentPeriod(userId: string, issuePeriod: string, now: Date): Promise<string> {
  if (issuePeriod !== chicagoMonthStart(now)) {
    throw new Error('credit catch-up period must be chicagoMonthStart');
  }
  const { data, error } = await getSupabaseAdmin().rpc('issue_period_credits', {
    p_user_id: userId,
    p_issue_period: issuePeriod,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== 'string') throw new Error('issue_period_credits did not return text');
  return data;
}

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const now = new Date();
  const runKey = dailyRunKey(CREDIT_CATCHUP_JOB, now);
  const exit = await runLeasedCron({
    jobName: CREDIT_CATCHUP_JOB,
    runKey,
    leaseSeconds: LEASE_SECONDS,
    resumeExpired: true,
    allowNewAttempt: false,
    currentPeriod: () => dailyRunKey(CREDIT_CATCHUP_JOB),
    work: (ctx) =>
      issueCreditCatchup({
        now,
        runKey,
        listProfiles: listActiveCreditProfiles,
        issuePeriodCredits: (userId, issuePeriod) => issueCurrentPeriod(userId, issuePeriod, now),
        lease: ctx,
      }),
  });

  return NextResponse.json(exit.body, { status: exit.httpStatus });
}
