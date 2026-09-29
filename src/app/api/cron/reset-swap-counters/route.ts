import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import {
  chicagoMonthStart,
  resetSwapCountersMonthOpen,
  resetSwapCountersRunKey,
} from '@/lib/cron-period';
import { runLeasedCron } from '@/lib/cron-runs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const JOB = 'reset-swap-counters';
const LEASE_SECONDS = 10 * 60;

// vercel.json schedules this at 06:05 UTC on the 1st. That is 00:05 CST and
// 01:05 CDT, so the Chicago month has started in both offsets. 00:05 UTC on
// the 1st is still the previous Chicago evening; the guard below returns
// success and does not take a lease or reset cycles.
export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const now = new Date();
  if (!resetSwapCountersMonthOpen(now)) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: 'chicago_month_not_open' },
      { status: 200 },
    );
  }

  const exit = await runLeasedCron({
    jobName: JOB,
    runKey: resetSwapCountersRunKey(now),
    leaseSeconds: LEASE_SECONDS,
    resumeExpired: true,
    allowNewAttempt: false,
    currentPeriod: () => resetSwapCountersRunKey(),
    async work(ctx) {
      if (!(await ctx.guardPeriod())) return;
      if (!(await ctx.renew())) return;
      const admin = getSupabaseAdmin();
      const currentMonthStr = chicagoMonthStart();
      const { data: legacyProfiles, error: profileError } = await admin
        .from('user_profiles')
        .select('id')
        .eq('workflow_version', 'legacy');
      if (profileError) {
        await ctx.fail(profileError.message);
        return;
      }
      const legacyIds = (legacyProfiles ?? []).map((row) => row.id);
      let resetCount = 0;
      if (legacyIds.length > 0) {
        const { data, error } = await admin
          .from('challenge_cycles')
          .update({ swap_count_used: 0 })
          .lt('cycle_month', currentMonthStr)
          .gt('swap_count_used', 0)
          .in('user_id', legacyIds)
          .select('id');
        if (error) {
          await ctx.fail(error.message);
          return;
        }
        resetCount = data?.length ?? 0;
      }
      const recorded = await ctx.record('statement', 'succeeded', null, {
        resetCount,
      });
      if (!recorded) return;
      await ctx.finishClear({ resetCount });
    },
  });

  return NextResponse.json(exit.body, { status: exit.httpStatus });
}
