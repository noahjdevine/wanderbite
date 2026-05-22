import { format, startOfMonth } from 'date-fns';
import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { beginCronRun, completeCronRun } from '@/lib/cron-runs';
import { generateMonthlyChallenge } from '@/lib/challenges/generate';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type UserOutcome = {
  userId: string;
  status: 'succeeded' | 'skipped' | 'failed';
  error?: string;
};

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const runId = await beginCronRun('issue-monthly-challenges');

  try {
    const admin = getSupabaseAdmin();
    const cycleMonthStr = format(startOfMonth(new Date()), 'yyyy-MM-dd');

    const { data: market, error: marketError } = await admin
      .from('markets')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (marketError || !market) {
      const message = marketError?.message ?? 'No market configured';
      await completeCronRun(runId, { status: 'failed', error: message });
      return NextResponse.json({ error: message }, { status: 500 });
    }

    const marketId = (market as { id: string }).id;

    const { data: subscribers, error: subsError } = await admin
      .from('user_profiles')
      .select('id')
      .eq('subscription_status', 'active');

    if (subsError) {
      await completeCronRun(runId, { status: 'failed', error: subsError.message });
      return NextResponse.json({ error: subsError.message }, { status: 500 });
    }

    const users = (subscribers ?? []) as { id: string }[];
    const outcomes: UserOutcome[] = [];
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;

    for (const { id: userId } of users) {
      const { data: existingCycle } = await admin
        .from('challenge_cycles')
        .select('id')
        .eq('user_id', userId)
        .eq('cycle_month', cycleMonthStr)
        .eq('status', 'active')
        .maybeSingle();

      if (existingCycle) {
        skipped++;
        outcomes.push({ userId, status: 'skipped' });
        continue;
      }

      const result = await generateMonthlyChallenge(userId, marketId);
      if (result.ok) {
        succeeded++;
        outcomes.push({ userId, status: 'succeeded' });
      } else {
        failed++;
        outcomes.push({ userId, status: 'failed', error: result.error });
        console.error(`[cron] issue-monthly-challenges failed for ${userId}:`, result.error);
      }
    }

    const processed = users.length;
    const summary = { processed, succeeded, skipped, failed, outcomes };

    await completeCronRun(runId, { status: 'success', result: summary });

    return NextResponse.json({ processed, succeeded, failed, skipped });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cron] issue-monthly-challenges:', err);
    await completeCronRun(runId, { status: 'failed', error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
