import * as Sentry from '@sentry/nextjs';
import { format, startOfMonth } from 'date-fns';
import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { beginCronRun, completeCronRun } from '@/lib/cron-runs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const runId = await beginCronRun('reset-swap-counters');

  try {
    const admin = getSupabaseAdmin();
    const currentMonthStr = format(startOfMonth(new Date()), 'yyyy-MM-dd');

    const { data: updatedRows, error } = await admin
      .from('challenge_cycles')
      .update({ swap_count_used: 0 })
      .lt('cycle_month', currentMonthStr)
      .gt('swap_count_used', 0)
      .select('id');

    if (error) {
      await completeCronRun(runId, { status: 'failed', error: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const resetCount = updatedRows?.length ?? 0;
    const result = { resetCount, cycleIds: (updatedRows ?? []).map((r) => (r as { id: string }).id) };

    await completeCronRun(runId, { status: 'success', result });

    return NextResponse.json({ resetCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cron] reset-swap-counters:', err);
    Sentry.captureException(err, { tags: { cron: 'reset-swap-counters' } });
    await completeCronRun(runId, { status: 'failed', error: message });
    await Sentry.flush(2000);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
