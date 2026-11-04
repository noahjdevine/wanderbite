import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { runLeasedCron } from '@/lib/cron-runs';
import {
  CONTENT_REFRESH_JOB,
  contentRefreshCronEnabled,
  contentRefreshRunKey,
} from '@/lib/content-pipeline/review';
import {
  contentRefreshEffects,
  loadActiveMenuSources,
  loadContentSourceContext,
  refreshItemStatus,
  reserveMaintenance,
  runApplyContentRefresh,
  scheduledModelCaller,
} from '@/lib/content-pipeline/scheduled-refresh';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const LEASE_SECONDS = 10 * 60;

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  if (!contentRefreshCronEnabled()) {
    return NextResponse.json({ status: 'disabled', skipped: true });
  }

  const now = new Date();
  const runKey = contentRefreshRunKey(now);
  const exit = await runLeasedCron({
    jobName: CONTENT_REFRESH_JOB,
    runKey,
    leaseSeconds: LEASE_SECONDS,
    resumeExpired: true,
    allowNewAttempt: false,
    currentPeriod: () => contentRefreshRunKey(),
    async work(ctx) {
      if (!(await ctx.guardPeriod())) return;
      if (!(await ctx.renew())) return;
      const admin = getSupabaseAdmin();
      const sources = await loadActiveMenuSources(admin);
      const summary = await runApplyContentRefresh({
        sources,
        load: (source) => loadContentSourceContext(admin, source.id),
        effects: contentRefreshEffects(admin),
        reserveModel: (input) => reserveMaintenance(admin, input),
        callModel: scheduledModelCaller(process.env.ANTHROPIC_API_KEY),
        now: () => now,
      });
      for (const result of summary.results) {
        const status = refreshItemStatus(result);
        const recorded = await ctx.record(
          result.sourceId,
          status,
          status === 'failed' ? (result.attempts.at(-1)?.errorCode ?? 'refresh failed') : null,
          {
            outcomes: result.attempts.map((row) => row.outcome),
            modelCalls: result.modelCalls,
            verified: result.verified,
          },
        );
        if (!recorded) return;
      }
      for (const skip of summary.skips) {
        const recorded = await ctx.record(`skip:${skip}`, 'skipped', skip);
        if (!recorded) return;
      }
      await ctx.finishClear({
        sources: summary.results.length,
        skips: summary.skips.length,
        modelCalls: summary.results.reduce((total, result) => total + result.modelCalls, 0),
      });
    },
  });

  return NextResponse.json(exit.body, { status: exit.httpStatus });
}
