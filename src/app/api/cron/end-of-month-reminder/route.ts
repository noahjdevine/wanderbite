import { differenceInCalendarDays, endOfMonth, format, startOfMonth } from 'date-fns';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { verifyCronAuth } from '@/lib/cron-auth';
import { beginCronRun, completeCronRun } from '@/lib/cron-runs';
import { sendRedemptionReminderEmail } from '@/lib/resend';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type UserOutcome = {
  userId: string;
  email: string | null;
  status: 'emailed' | 'skipped' | 'failed';
  reason?: string;
};

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const runId = await beginCronRun('end-of-month-reminder');

  try {
    const admin = getSupabaseAdmin();
    const now = new Date();
    const cycleMonthStr = format(startOfMonth(now), 'yyyy-MM-dd');
    const daysLeft = Math.max(1, differenceInCalendarDays(endOfMonth(now), now));

    const { data: cycles, error: cyclesError } = await admin
      .from('challenge_cycles')
      .select('id, user_id')
      .eq('cycle_month', cycleMonthStr)
      .eq('status', 'active');

    if (cyclesError) {
      await completeCronRun(runId, { status: 'failed', error: cyclesError.message });
      return NextResponse.json({ error: cyclesError.message }, { status: 500 });
    }

    const cycleRows = (cycles ?? []) as { id: string; user_id: string }[];

    if (cycleRows.length === 0) {
      const summary = { processed: 0, emailed: 0, skipped: 0, failed: 0, outcomes: [] };
      await completeCronRun(runId, { status: 'success', result: summary });
      return NextResponse.json(summary);
    }

    const cycleIds = cycleRows.map((c) => c.id);

    const { data: assignedItems, error: itemsError } = await admin
      .from('challenge_items')
      .select('cycle_id, restaurant_id')
      .in('cycle_id', cycleIds)
      .eq('status', 'assigned');

    if (itemsError) {
      await completeCronRun(runId, { status: 'failed', error: itemsError.message });
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    const itemsByUserCycle = new Map<string, string[]>();
    const restaurantIds = new Set<string>();

    for (const row of (assignedItems ?? []) as { cycle_id: string; restaurant_id: string }[]) {
      const cycle = cycleRows.find((c) => c.id === row.cycle_id);
      if (!cycle) continue;

      const key = cycle.user_id;
      if (!itemsByUserCycle.has(key)) itemsByUserCycle.set(key, []);
      itemsByUserCycle.get(key)!.push(row.restaurant_id);
      restaurantIds.add(row.restaurant_id);
    }

    if (itemsByUserCycle.size === 0) {
      const summary = {
        processed: 0,
        emailed: 0,
        skipped: cycleRows.length,
        failed: 0,
        outcomes: [],
      };
      await completeCronRun(runId, { status: 'success', result: summary });
      return NextResponse.json(summary);
    }

    const userIds = Array.from(itemsByUserCycle.keys());

    const [{ data: restaurants }, { data: profiles }] = await Promise.all([
      admin
        .from('restaurants')
        .select('id, name')
        .in('id', Array.from(restaurantIds)),
      admin
        .from('user_profiles')
        .select('id, email')
        .in('id', userIds)
        .eq('subscription_status', 'active'),
    ]);

    const restaurantNameById = new Map(
      ((restaurants ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name])
    );
    const emailByUserId = new Map(
      ((profiles ?? []) as { id: string; email: string | null }[]).map((p) => [p.id, p.email])
    );

    const outcomes: UserOutcome[] = [];
    let emailed = 0;
    let skipped = 0;
    let failed = 0;

    for (const [userId, rIds] of itemsByUserCycle.entries()) {
      const email = emailByUserId.get(userId);
      if (!email) {
        skipped++;
        outcomes.push({
          userId,
          email: null,
          status: 'skipped',
          reason: 'not an active subscriber or no email on profile',
        });
        continue;
      }

      const names = rIds
        .map((id) => restaurantNameById.get(id))
        .filter((n): n is string => Boolean(n));

      if (names.length === 0) {
        skipped++;
        outcomes.push({
          userId,
          email,
          status: 'skipped',
          reason: 'no resolvable restaurant names',
        });
        continue;
      }

      const result = await sendRedemptionReminderEmail(email, names, daysLeft);

      if (result.ok) {
        emailed++;
        outcomes.push({ userId, email, status: 'emailed' });
      } else {
        failed++;
        outcomes.push({ userId, email, status: 'failed', reason: result.error });
        Sentry.captureMessage('Redemption reminder email failed', {
          level: 'warning',
          tags: { cron: 'end-of-month-reminder', userId },
          extra: { error: result.error },
        });
      }
    }

    const summary = {
      processed: itemsByUserCycle.size,
      emailed,
      skipped,
      failed,
      daysLeft,
      outcomes,
    };

    await completeCronRun(runId, { status: 'success', result: summary });

    return NextResponse.json({
      processed: summary.processed,
      emailed,
      skipped,
      failed,
      daysLeft,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cron] end-of-month-reminder:', err);
    Sentry.captureException(err, { tags: { cron: 'end-of-month-reminder' } });
    await completeCronRun(runId, { status: 'failed', error: message });
    await Sentry.flush(2000);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
