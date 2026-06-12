import { subDays } from 'date-fns';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { verifyCronAuth } from '@/lib/cron-auth';
import { beginCronRun, completeCronRun } from '@/lib/cron-runs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const EXPIRY_DAYS = 35;

export async function GET(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const runId = await beginCronRun('expire-issued-redemptions');

  try {
    const admin = getSupabaseAdmin();
    const cutoff = subDays(new Date(), EXPIRY_DAYS).toISOString();

    const { data: updatedRows, error } = await admin
      .from('redemptions')
      .update({ status: 'expired' })
      .eq('status', 'issued')
      .lt('created_at', cutoff)
      .select('id, user_id, restaurant_id, created_at');

    if (error) {
      await completeCronRun(runId, { status: 'failed', error: error.message });
      Sentry.captureException(new Error(error.message), {
        tags: { cron: 'expire-issued-redemptions' },
      });
      await Sentry.flush(2000);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const expiredCount = updatedRows?.length ?? 0;
    const result = {
      expiredCount,
      cutoff,
      expiryDays: EXPIRY_DAYS,
      expired: (updatedRows ?? []).map((r) => {
        const row = r as {
          id: string;
          user_id: string;
          restaurant_id: string;
          created_at: string;
        };
        return {
          id: row.id,
          userId: row.user_id,
          restaurantId: row.restaurant_id,
          createdAt: row.created_at,
        };
      }),
    };

    await completeCronRun(runId, { status: 'success', result });

    return NextResponse.json({ expiredCount, cutoff });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cron] expire-issued-redemptions:', err);
    Sentry.captureException(err, { tags: { cron: 'expire-issued-redemptions' } });
    await completeCronRun(runId, { status: 'failed', error: message });
    await Sentry.flush(2000);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
