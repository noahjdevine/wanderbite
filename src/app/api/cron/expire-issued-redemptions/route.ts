import { subDays } from 'date-fns';
import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { dailyRunKey } from '@/lib/cron-period';
import { runLeasedCron, type CronLeaseContext } from '@/lib/cron-runs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { Json } from '@/types/database.types';

export const dynamic = 'force-dynamic';

const JOB = 'expire-issued-redemptions';
const LEASE_SECONDS = 10 * 60;
const EXPIRY_DAYS = 35;
const BATCH = 100;

type ExpiryCheckpoint = {
  cutoff: string;
  snapshotComplete: boolean;
  lastId: string | null;
};

function readCheckpoint(value: Json | null, fallbackCutoff: string): ExpiryCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { cutoff: fallbackCutoff, snapshotComplete: false, lastId: null };
  }
  const row = value as { cutoff?: unknown; snapshotComplete?: unknown; lastId?: unknown };
  return {
    cutoff: typeof row.cutoff === 'string' ? row.cutoff : fallbackCutoff,
    snapshotComplete: row.snapshotComplete === true,
    lastId: typeof row.lastId === 'string' ? row.lastId : null,
  };
}

async function snapshotIssued(ctx: CronLeaseContext, state: ExpiryCheckpoint): Promise<ExpiryCheckpoint | null> {
  if (state.snapshotComplete) return state;
  const admin = getSupabaseAdmin();
  let lastId = state.lastId;
  while (true) {
    if (!(await ctx.guardPeriod())) return null;
    if (!(await ctx.renew())) return null;
    let query = admin
      .from('redemptions')
      .select('id')
      .eq('status', 'issued')
      .lt('created_at', state.cutoff)
      .order('id', { ascending: true })
      .limit(BATCH);
    if (lastId) query = query.gt('id', lastId);
    const { data, error } = await query;
    if (error) {
      await ctx.fail(error.message);
      return null;
    }
    const rows = data ?? [];
    if (rows.length === 0) {
      const done = { ...state, snapshotComplete: true, lastId };
      const saved = await ctx.renew(done);
      return saved ? done : null;
    }
    for (const row of rows) {
      if (!(await ctx.renew())) return null;
      const { data: redemption } = await admin
        .from('redemptions')
        .select('challenge_item_id')
        .eq('id', row.id)
        .maybeSingle();
      const itemId = (redemption as { challenge_item_id: string | null } | null)?.challenge_item_id;
      if (itemId) {
        const { data: item } = await admin
          .from('challenge_items')
          .select('redemption_deadline')
          .eq('id', itemId)
          .maybeSingle();
        if ((item as { redemption_deadline: string | null } | null)?.redemption_deadline) {
          lastId = row.id;
          continue;
        }
      }
      const recorded = await ctx.record(row.id, 'pending');
      if (!recorded) return null;
      lastId = row.id;
    }
    const next = { ...state, snapshotComplete: false, lastId };
    const saved = await ctx.renew(next);
    if (!saved) return null;
  }
}

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const exit = await runLeasedCron({
    jobName: JOB,
    runKey: dailyRunKey(JOB),
    leaseSeconds: LEASE_SECONDS,
    resumeExpired: true,
    allowNewAttempt: false,
    currentPeriod: () => dailyRunKey(JOB),
    async work(ctx) {
      const adminForDeadline = getSupabaseAdmin();
      const { data: dueItems, error: dueError } = await adminForDeadline
        .from('challenge_items')
        .select('id')
        .not('redemption_deadline', 'is', null)
        .lte('redemption_deadline', new Date().toISOString())
        .in('status', ['assigned', 'redeemed'])
        .limit(BATCH);
      if (dueError) {
        await ctx.fail(dueError.message);
        return;
      }
      for (const item of dueItems ?? []) {
        const { error: expireError } = await adminForDeadline.rpc(
          'expire_version_bound_assignment',
          { p_item_id: item.id },
        );
        if (expireError) {
          await ctx.fail(expireError.message);
          return;
        }
      }
      const fallbackCutoff = subDays(new Date(), EXPIRY_DAYS).toISOString();
      let initial = readCheckpoint(ctx.checkpoint, '');
      if (!initial.cutoff) {
        initial = { cutoff: fallbackCutoff, snapshotComplete: false, lastId: null };
        if (!(await ctx.renew(initial))) return;
      }
      const state = await snapshotIssued(ctx, initial);
      if (!state) return;
      const admin = getSupabaseAdmin();

      while (true) {
        if (!(await ctx.guardPeriod())) return;
        if (!(await ctx.renew())) return;
        const pending = await ctx.listPending(BATCH);
        if (pending.length === 0) {
          await ctx.finishClear({ cutoff: state.cutoff, expiryDays: EXPIRY_DAYS });
          return;
        }
        const ids = pending.map((item) => item.itemKey);
        const { error } = await admin
          .from('redemptions')
          .update({ status: 'expired' })
          .in('id', ids)
          .eq('status', 'issued')
          .lt('created_at', state.cutoff);
        if (error) {
          await ctx.fail(error.message);
          return;
        }
        for (const id of ids) {
          if (!(await ctx.renew())) return;
          const recorded = await ctx.record(id, 'succeeded');
          if (!recorded) return;
        }
      }
    },
  });

  return NextResponse.json(exit.body, { status: exit.httpStatus });
}
