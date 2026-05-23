import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type CronRunStatus = 'running' | 'success' | 'failed';

export async function beginCronRun(jobName: string): Promise<number | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('cron_runs')
    .insert({ job_name: jobName, status: 'running' })
    .select('id')
    .single();

  if (error) {
    console.error(`[cron] failed to start run for ${jobName}:`, error.message);
    return null;
  }

  return (data as { id: number }).id;
}

export async function completeCronRun(
  runId: number | null,
  params: {
    status: Exclude<CronRunStatus, 'running'>;
    result?: unknown;
    error?: string;
  }
): Promise<void> {
  if (runId == null) return;

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('cron_runs')
    .update({
      finished_at: new Date().toISOString(),
      status: params.status,
      result: params.result ?? null,
      error: params.error ?? null,
    })
    .eq('id', runId);

  if (error) {
    console.error(`[cron] failed to complete run ${runId}:`, error.message);
  }
}
