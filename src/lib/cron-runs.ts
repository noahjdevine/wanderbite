import * as Sentry from '@sentry/nextjs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { Json } from '@/types/database.types';
import { PERIOD_BOUNDARY_ERROR } from '@/lib/cron-period';

export { PERIOD_BOUNDARY_ERROR } from '@/lib/cron-period';

const LEASE_LOST = 'lease-lost';

type ItemStatus = 'pending' | 'succeeded' | 'skipped' | 'failed';

type DegradedPrevious = {
  runId: number;
  runKey: string | null;
  error: string | null;
};

type AcquirePayload = {
  acquired?: boolean;
  reason?: string;
  run_id?: number | null;
  run_key?: string | null;
  resumed?: boolean;
  checkpoint?: Json | null;
  terminal_status?: string | null;
  terminal_result?: Json | null;
  terminal_error?: string | null;
  degraded_previous?: unknown;
};

export type CronExit = {
  httpStatus: number;
  body: Json;
};

type FinishFlag = {
  finalized: boolean;
  exit: CronExit | null;
};

export type CronLeaseContext = {
  runId: number;
  token: string;
  checkpoint: Json | null;
  renew: (checkpoint?: Json | null) => Promise<boolean>;
  record: (
    itemKey: string,
    status: ItemStatus,
    error?: string | null,
    detail?: Json | null,
  ) => Promise<boolean>;
  listPending: (limit: number) => Promise<{ itemKey: string; detail: Json | null }[]>;
  terminalKeys: (itemKeys: string[]) => Promise<Set<string>>;
  guardPeriod: () => Promise<boolean>;
  fail: (error: string) => Promise<void>;
  finishClear: (extra?: Json | null) => Promise<void>;
};

function asObject(value: Json | null): Record<string, Json | undefined> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function degradedList(value: unknown): DegradedPrevious[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as { run_id?: unknown; run_key?: unknown; error?: unknown };
    const runId = typeof row.run_id === 'number' ? row.run_id : null;
    if (runId == null) return [];
    return [
      {
        runId,
        runKey: typeof row.run_key === 'string' ? row.run_key : null,
        error: typeof row.error === 'string' ? row.error : null,
      },
    ];
  });
}

function captureDegraded(jobName: string, previous: DegradedPrevious[]): void {
  for (const row of previous) {
    Sentry.captureMessage('Cron run closed without finishing', {
      level: 'warning',
      tags: { cron: jobName, runKey: row.runKey ?? '' },
      extra: { runId: row.runId, error: row.error },
    });
  }
}

async function rpcJson(
  fn: 'acquire_cron_lease' | 'finalize_cron_lease',
  args: Record<string, unknown>,
): Promise<Json> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc(fn, args as never);
  if (error) throw new Error(error.message);
  return data;
}

export async function runLeasedCron(params: {
  jobName: string;
  runKey: string;
  leaseSeconds: number;
  resumeExpired: boolean;
  allowNewAttempt: boolean;
  checkpoint?: Json | null;
  currentPeriod?: () => string;
  work: (ctx: CronLeaseContext) => Promise<void>;
}): Promise<CronExit> {
  const token = crypto.randomUUID();
  const flag: FinishFlag = { finalized: false, exit: null };
  let runId: number | null = null;

  try {
    const acquired = asObject(
      await rpcJson('acquire_cron_lease', {
        p_job_name: params.jobName,
        p_run_key: params.runKey,
        p_token: token,
        p_lease_seconds: params.leaseSeconds,
        p_checkpoint: params.checkpoint ?? null,
        p_resume_expired: params.resumeExpired,
        p_allow_new_attempt: params.allowNewAttempt,
      }),
    ) as AcquirePayload;

    captureDegraded(params.jobName, degradedList(acquired.degraded_previous));

    if (!acquired.acquired) {
      if (acquired.reason === 'lease-held') {
        return {
          httpStatus: 409,
          body: { status: 'lease-held', runId: acquired.run_id ?? null, runKey: acquired.run_key ?? null },
        };
      }
      const terminal = acquired.terminal_status ?? 'failed';
      return {
        httpStatus: terminal === 'success' ? 200 : 500,
        body: {
          status: terminal,
          runId: acquired.run_id ?? null,
          result: acquired.terminal_result ?? null,
          error: acquired.terminal_error ?? null,
        },
      };
    }

    if (typeof acquired.run_id !== 'number') {
      throw new Error('Cron lease did not return a run id');
    }
    runId = acquired.run_id;
    let checkpoint = (acquired.checkpoint ?? null) as Json | null;

    const renew = async (next?: Json | null): Promise<boolean> => {
      const admin = getSupabaseAdmin();
      const { data, error } = await admin.rpc('renew_cron_lease', {
        p_job_name: params.jobName,
        p_token: token,
        p_run_id: runId!,
        p_lease_seconds: params.leaseSeconds,
        p_checkpoint: next === undefined ? null : next,
      });
      if (error) throw new Error(error.message);
      if (next !== undefined && next !== null) checkpoint = next;
      return Boolean(data);
    };

    const record = async (
      itemKey: string,
      status: ItemStatus,
      error?: string | null,
      detail?: Json | null,
    ): Promise<boolean> => {
      const admin = getSupabaseAdmin();
      const { data, error: rpcError } = await admin.rpc('record_cron_run_item', {
        p_job_name: params.jobName,
        p_token: token,
        p_run_id: runId!,
        p_item_key: itemKey,
        p_status: status,
        p_detail: detail ?? null,
        p_error: error ?? null,
      });
      if (rpcError) throw new Error(rpcError.message);
      return Boolean(data);
    };

    const finalize = async (
      status: 'success' | 'degraded' | 'failed',
      error: string | null,
      extra?: Json | null,
    ): Promise<boolean> => {
      const payload = asObject(
        await rpcJson('finalize_cron_lease', {
          p_job_name: params.jobName,
          p_token: token,
          p_run_id: runId!,
          p_status: status,
          p_result: extra ?? null,
          p_error: error,
        }),
      );
      const finalized = payload.finalized === true;
      if (finalized) flag.finalized = true;
      const stored = (payload.result ?? null) as Json | null;
      flag.exit = {
        httpStatus: finalized && status === 'success' ? 200 : 500,
        body: {
          status: finalized ? status : 'running',
          runId,
          result: stored,
          error: finalized ? error : (typeof payload.reason === 'string' ? payload.reason : LEASE_LOST),
        },
      };
      return finalized;
    };

    const ctx: CronLeaseContext = {
      runId,
      token,
      get checkpoint() {
        return checkpoint;
      },
      renew,
      record,
      async listPending(limit: number) {
        const admin = getSupabaseAdmin();
        const { data, error } = await admin
          .from('cron_run_items')
          .select('item_key, detail')
          .eq('run_id', runId!)
          .eq('status', 'pending')
          .order('item_key', { ascending: true })
          .limit(limit);
        if (error) throw new Error(error.message);
        return (data ?? []).map((row) => ({
          itemKey: row.item_key,
          detail: row.detail,
        }));
      },
      async terminalKeys(itemKeys: string[]) {
        const found = new Set<string>();
        if (itemKeys.length === 0) return found;
        const admin = getSupabaseAdmin();
        const { data, error } = await admin
          .from('cron_run_items')
          .select('item_key, status')
          .eq('run_id', runId!)
          .in('item_key', itemKeys);
        if (error) throw new Error(error.message);
        for (const row of data ?? []) {
          if (row.status !== 'pending') found.add(row.item_key);
        }
        return found;
      },
      async guardPeriod() {
        if (!params.currentPeriod) return true;
        if (params.currentPeriod() === params.runKey) return true;
        await finalize('degraded', PERIOD_BOUNDARY_ERROR);
        return false;
      },
      async fail(error: string) {
        await finalize('failed', error);
      },
      async finishClear(extra?: Json | null) {
        const admin = getSupabaseAdmin();
        const { data, error } = await admin.rpc('cron_run_item_counts', { p_run_id: runId! });
        if (error) throw new Error(error.message);
        const counts = asObject(data);
        const pending = Number(counts.pending ?? 0);
        const failed = Number(counts.failed ?? 0);
        if (pending > 0) {
          flag.exit = {
            httpStatus: 500,
            body: { status: 'running', runId, result: data, error: 'pending items remain' },
          };
          return;
        }
        await finalize(failed > 0 ? 'degraded' : 'success', failed > 0 ? 'item failures' : null, extra ?? null);
      },
    };

    await params.work(ctx);
    if (!flag.exit) {
      flag.exit = {
        httpStatus: 500,
        body: { status: 'running', runId, error: 'run stopped before finalize' },
      };
    }
    return flag.exit;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cron lease failed';
    Sentry.captureException(err, { tags: { cron: params.jobName } });
    return {
      httpStatus: 500,
      body: { status: 'failed', runId, error: message },
    };
  } finally {
    if (runId != null && !flag.finalized) {
      const admin = getSupabaseAdmin();
      await admin
        .rpc('release_cron_lease', {
          p_job_name: params.jobName,
          p_token: token,
          p_run_id: runId,
        })
        .then(({ error }) => {
          if (error) {
            console.error(`[cron] release failed for ${params.jobName}:`, error.message);
          }
        });
    }
  }
}
