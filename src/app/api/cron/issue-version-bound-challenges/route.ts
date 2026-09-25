import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { runLeasedCron, type CronLeaseContext } from '@/lib/cron-runs';
import { chicagoMonthStart, issueItemStatus } from '@/lib/cron-period';
import { generateMonthlyChallengeForUser } from '@/lib/challenges/generate';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { Json } from '@/types/database.types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const JOB = 'issue-version-bound-challenges';
const LEASE_SECONDS = 10 * 60;
const BATCH = 25;

function checkpointState(value: Json | null): { snapshotComplete: boolean; lastId: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { snapshotComplete: false, lastId: null };
  }
  const row = value as { snapshotComplete?: unknown; lastId?: unknown };
  return {
    snapshotComplete: row.snapshotComplete === true,
    lastId: typeof row.lastId === 'string' ? row.lastId : null,
  };
}

async function snapshotSubscribers(ctx: CronLeaseContext): Promise<boolean> {
  const state = checkpointState(ctx.checkpoint);
  if (state.snapshotComplete) return true;
  let lastId = state.lastId;
  const admin = getSupabaseAdmin();

  while (true) {
    if (!(await ctx.guardPeriod())) return false;
    if (!(await ctx.renew())) return false;
    let query = admin
      .from('user_profiles')
      .select('id')
      .eq('subscription_status', 'active')
      .order('id', { ascending: true })
      .limit(BATCH);
    if (lastId) query = query.gt('id', lastId);
    const { data, error } = await query;
    if (error) {
      await ctx.fail(error.message);
      return false;
    }
    const rows = data ?? [];
    if (rows.length === 0) {
      const saved = await ctx.renew({ snapshotComplete: true, lastId });
      return saved;
    }
    for (const row of rows) {
      if (!(await ctx.renew())) return false;
      const recorded = await ctx.record(row.id, 'pending');
      if (!recorded) return false;
      lastId = row.id;
    }
    const saved = await ctx.renew({ snapshotComplete: false, lastId });
    if (!saved) return false;
  }
}

async function issuePending(ctx: CronLeaseContext): Promise<void> {
  while (true) {
    if (!(await ctx.guardPeriod())) return;
    if (!(await ctx.renew())) return;
    const pending = await ctx.listPending(BATCH);
    if (pending.length === 0) {
      await ctx.finishClear();
      return;
    }
    for (const item of pending) {
      if (!(await ctx.guardPeriod())) return;
      if (!(await ctx.renew())) return;
      try {
        const result = await generateMonthlyChallengeForUser(item.itemKey);
        const recorded = await ctx.record(
          item.itemKey,
          issueItemStatus(result),
          result.ok ? null : result.error,
        );
        if (!recorded) return;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Challenge generation failed';
        const recorded = await ctx.record(item.itemKey, 'failed', message);
        if (!recorded) return;
      }
    }
  }
}

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const exit = await runLeasedCron({
    jobName: JOB,
    runKey: `${JOB}:${chicagoMonthStart()}`,
    leaseSeconds: LEASE_SECONDS,
    resumeExpired: true,
    allowNewAttempt: false,
    currentPeriod: () => `${JOB}:${chicagoMonthStart()}`,
    async work(ctx) {
      const snapshotted = await snapshotSubscribers(ctx);
      if (!snapshotted) return;
      await issuePending(ctx);
    },
  });

  return NextResponse.json(exit.body, { status: exit.httpStatus });
}
