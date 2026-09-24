import { differenceInCalendarDays, endOfMonth, format, startOfMonth } from 'date-fns';
import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { monthlyRunKey, reminderCronItemStatus } from '@/lib/cron-period';
import { runLeasedCron, type CronLeaseContext } from '@/lib/cron-runs';
import {
  deliverAdventureReminder,
  readReminderDeliveryStatus,
} from '@/lib/email-reminder-delivery';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { Json } from '@/types/database.types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const JOB = 'end-of-month-reminder';
const LEASE_SECONDS = 10 * 60;
const BATCH = 25;

function snapshotDone(value: Json | null): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as { snapshotComplete?: unknown }).snapshotComplete === true,
  );
}

function detailOf(value: Json | null): { email: string | null; names: string[]; daysLeft: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as { email?: unknown; names?: unknown; daysLeft?: unknown };
  const names = Array.isArray(row.names) ? row.names.filter((name): name is string => typeof name === 'string') : [];
  return {
    email: typeof row.email === 'string' ? row.email : null,
    names,
    daysLeft: typeof row.daysLeft === 'number' ? row.daysLeft : 1,
  };
}

async function snapshotReminders(ctx: CronLeaseContext, cycleMonth: string, daysLeft: number): Promise<boolean> {
  if (snapshotDone(ctx.checkpoint)) return true;
  if (!(await ctx.guardPeriod())) return false;
  if (!(await ctx.renew())) return false;
  const admin = getSupabaseAdmin();

  const { data: cycles, error: cyclesError } = await admin
    .from('challenge_cycles')
    .select('id, user_id')
    .eq('cycle_month', cycleMonth)
    .eq('status', 'active');
  if (cyclesError) {
    await ctx.fail(cyclesError.message);
    return false;
  }
  const cycleRows = cycles ?? [];
  if (cycleRows.length === 0) {
    return ctx.renew({ snapshotComplete: true, daysLeft });
  }

  const { data: assignedItems, error: itemsError } = await admin
    .from('challenge_items')
    .select('cycle_id, restaurant_id')
    .in('cycle_id', cycleRows.map((cycle) => cycle.id))
    .eq('status', 'assigned');
  if (itemsError) {
    await ctx.fail(itemsError.message);
    return false;
  }

  const restaurantIds = new Set<string>();
  const restaurantsByUser = new Map<string, string[]>();
  for (const row of assignedItems ?? []) {
    if (!row.cycle_id || !row.restaurant_id) continue;
    const cycle = cycleRows.find((candidate) => candidate.id === row.cycle_id);
    if (!cycle?.user_id) continue;
    const list = restaurantsByUser.get(cycle.user_id) ?? [];
    list.push(row.restaurant_id);
    restaurantsByUser.set(cycle.user_id, list);
    restaurantIds.add(row.restaurant_id);
  }

  if (restaurantsByUser.size === 0) {
    return ctx.renew({ snapshotComplete: true, daysLeft });
  }

  const userIds = Array.from(restaurantsByUser.keys()).sort();
  const [{ data: restaurants, error: restaurantError }, { data: profiles, error: profileError }] =
    await Promise.all([
      admin.from('restaurants').select('id, name').in('id', Array.from(restaurantIds)),
      admin
        .from('user_profiles')
        .select('id, email')
        .in('id', userIds)
        .eq('subscription_status', 'active'),
    ]);
  if (restaurantError) {
    await ctx.fail(restaurantError.message);
    return false;
  }
  if (profileError) {
    await ctx.fail(profileError.message);
    return false;
  }

  const restaurantNameById = new Map((restaurants ?? []).map((row) => [row.id, row.name]));
  const emailByUserId = new Map((profiles ?? []).map((row) => [row.id, row.email]));

  for (const userId of userIds) {
    if (!(await ctx.guardPeriod())) return false;
    if (!(await ctx.renew())) return false;
    const names = (restaurantsByUser.get(userId) ?? [])
      .map((id) => restaurantNameById.get(id))
      .filter((name): name is string => Boolean(name));
    const recorded = await ctx.record(userId, 'pending', null, {
      email: emailByUserId.get(userId) ?? null,
      names,
      daysLeft,
    });
    if (!recorded) return false;
  }

  return ctx.renew({ snapshotComplete: true, daysLeft });
}

async function sendPending(ctx: CronLeaseContext, cycleMonth: string): Promise<void> {
  const admin = getSupabaseAdmin();
  while (true) {
    if (!(await ctx.guardPeriod())) return;
    if (!(await ctx.renew())) return;
    const pending = await ctx.listPending(BATCH);
    if (pending.length === 0) {
      await ctx.finishClear();
      return;
    }
    let unresolved = false;
    for (const item of pending) {
      if (!(await ctx.guardPeriod())) return;
      if (!(await ctx.renew())) return;
      const detail = detailOf(item.detail);
      if (!detail?.email || detail.names.length === 0) {
        const recorded = await ctx.record(
          item.itemKey,
          'skipped',
          !detail?.email ? 'not an active subscriber or no email on profile' : 'no resolvable restaurant names',
        );
        if (!recorded) return;
        continue;
      }
      try {
        const delivery = await deliverAdventureReminder({
          supabase: admin,
          userId: item.itemKey,
          cycleMonth,
          email: detail.email,
          restaurantNames: detail.names,
          daysLeft: detail.daysLeft,
        });
        const rowStatus =
          delivery.status === 'skipped' && delivery.reason === 'claimed by another worker'
            ? await readReminderDeliveryStatus(admin, item.itemKey, cycleMonth)
            : null;
        const status = reminderCronItemStatus(delivery, rowStatus);
        if (status === 'pending') {
          unresolved = true;
          continue;
        }
        const recorded = await ctx.record(item.itemKey, status, delivery.reason ?? null);
        if (!recorded) return;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Reminder delivery failed';
        const recorded = await ctx.record(item.itemKey, 'failed', message);
        if (!recorded) return;
      }
    }
    if (unresolved) {
      return;
    }
  }
}

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const now = new Date();
  const cycleMonth = format(startOfMonth(now), 'yyyy-MM-dd');
  const daysLeft = Math.max(1, differenceInCalendarDays(endOfMonth(now), now));

  const exit = await runLeasedCron({
    jobName: JOB,
    runKey: monthlyRunKey(JOB, now),
    leaseSeconds: LEASE_SECONDS,
    resumeExpired: true,
    allowNewAttempt: false,
    currentPeriod: () => monthlyRunKey(JOB),
    async work(ctx) {
      const ready = await snapshotReminders(ctx, cycleMonth, daysLeft);
      if (!ready) return;
      await sendPending(ctx, cycleMonth);
    },
  });

  return NextResponse.json(exit.body, { status: exit.httpStatus });
}
