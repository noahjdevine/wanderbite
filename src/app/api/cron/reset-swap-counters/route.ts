import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { monthlyRunKey } from '@/lib/cron-period';
import { runLeasedCron } from '@/lib/cron-runs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { format, startOfMonth } from 'date-fns';

export const dynamic = 'force-dynamic';

const JOB = 'reset-swap-counters';
const LEASE_SECONDS = 10 * 60;

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const exit = await runLeasedCron({
    jobName: JOB,
    runKey: monthlyRunKey(JOB),
    leaseSeconds: LEASE_SECONDS,
    resumeExpired: true,
    allowNewAttempt: false,
    currentPeriod: () => monthlyRunKey(JOB),
    async work(ctx) {
      if (!(await ctx.guardPeriod())) return;
      if (!(await ctx.renew())) return;
      const admin = getSupabaseAdmin();
      const currentMonthStr = format(startOfMonth(new Date()), 'yyyy-MM-dd');
      const { data, error } = await admin
        .from('challenge_cycles')
        .update({ swap_count_used: 0 })
        .lt('cycle_month', currentMonthStr)
        .gt('swap_count_used', 0)
        .select('id');
      if (error) {
        await ctx.fail(error.message);
        return;
      }
      const recorded = await ctx.record('statement', 'succeeded', null, {
        resetCount: data?.length ?? 0,
      });
      if (!recorded) return;
      await ctx.finishClear({ resetCount: data?.length ?? 0 });
    },
  });

  return NextResponse.json(exit.body, { status: exit.httpStatus });
}
