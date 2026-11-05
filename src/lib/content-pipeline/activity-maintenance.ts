import type { SupabaseClient } from '@supabase/supabase-js';
import { activitiesToExpire, type ExpirableActivity } from '@/lib/activities/expire';
import { activitySchemaMissing } from '@/lib/activities/flag';
import { chicagoCalendarDate } from '@/lib/activities/match';
import { selectDueActivitySources } from '@/lib/content-pipeline/registry';
import type { ContentSourceRecord } from '@/lib/content-pipeline/refresh';
import type { Database } from '@/types/database.types';

type Client = SupabaseClient<Database>;

export const ACTIVITY_MAINTENANCE_SKIP_REASON =
  'activity maintenance skipped: activities schema unavailable';

export type SchemaError = { code?: string | null; message?: string | null };

export type ActivityMaintenancePort = {
  probeSchema(): Promise<{ ok: true } | { ok: false; error: SchemaError }>;
  listExpirable(): Promise<ExpirableActivity[]>;
  expireDated(today: string): Promise<number>;
  listActiveActivitySources(): Promise<ContentSourceRecord[]>;
};

export type ActivityMaintenanceResult = {
  sources: ContentSourceRecord[];
  expired: number;
  skip: string | null;
};

export function activityMaintenanceSchemaMissing(error: SchemaError | null | undefined): boolean {
  if (activitySchemaMissing(error)) return true;
  const code = error?.code ?? '';
  if (code === '42703' || code === 'PGRST204') return true;
  const message = error?.message ?? '';
  return message.includes('Could not find the column');
}

function emptyMaintenance(): ActivityMaintenanceResult {
  return { sources: [], expired: 0, skip: null };
}

export function logActivityMaintenanceSkip(reason: string = ACTIVITY_MAINTENANCE_SKIP_REASON): void {
  console.warn(`[content-refresh] ${reason}`);
}

function skipped(): ActivityMaintenanceResult {
  logActivityMaintenanceSkip();
  return { sources: [], expired: 0, skip: ACTIVITY_MAINTENANCE_SKIP_REASON };
}

function schemaErrorOf(error: unknown): SchemaError | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as SchemaError;
  if (typeof record.code !== 'string' && typeof record.message !== 'string') return null;
  return record;
}

function coded(error: SchemaError): Error & { code?: string | null } {
  const wrapped = new Error(error.message ?? 'activity maintenance query failed') as Error & {
    code?: string | null;
  };
  wrapped.code = error.code;
  return wrapped;
}

/**
 * Flag off returns before any port call.
 * A missing activities table, column, or expire function logs one skip and
 * returns no sources. The caller still refreshes menus.
 */
export async function prepareActivityMaintenance(args: {
  enabled: boolean;
  now: Date;
  port: ActivityMaintenancePort;
}): Promise<ActivityMaintenanceResult> {
  if (!args.enabled) return emptyMaintenance();
  try {
    const probe = await args.port.probeSchema();
    if (!probe.ok) {
      if (activityMaintenanceSchemaMissing(probe.error)) return skipped();
      throw coded(probe.error);
    }
    const rows = await args.port.listExpirable();
    const due = activitiesToExpire(rows, args.now);
    let expired = 0;
    if (due.length > 0) {
      const today = chicagoCalendarDate(args.now);
      if (!today) throw new Error('Chicago date was not available');
      expired = await args.port.expireDated(today);
    }
    const sources = selectDueActivitySources(await args.port.listActiveActivitySources(), args.now);
    return { sources, expired, skip: null };
  } catch (error) {
    const schema = schemaErrorOf(error);
    if (schema && activityMaintenanceSchemaMissing(schema)) return skipped();
    throw error;
  }
}

function sourceRecord(row: {
  id: string;
  kind: string;
  url: string;
  status: string;
  last_attempted_at: string | null;
  last_verified_at: string | null;
  last_content_hash: string | null;
}): ContentSourceRecord {
  return {
    id: row.id,
    kind: row.kind,
    url: row.url,
    status: row.status as ContentSourceRecord['status'],
    lastAttemptedAt: row.last_attempted_at,
    lastVerifiedAt: row.last_verified_at,
    lastContentHash: row.last_content_hash,
  };
}

export function activityMaintenancePort(supabase: Client): ActivityMaintenancePort {
  return {
    async probeSchema() {
      const { error } = await supabase
        .from('activities')
        .select('id, content_source_id, status, valid_until')
        .limit(1);
      if (error) return { ok: false, error };
      return { ok: true };
    },
    async listExpirable() {
      const { data, error } = await supabase
        .from('activities')
        .select('id, name, status, valid_until')
        .eq('status', 'active');
      if (error) throw coded(error);
      return data ?? [];
    },
    async expireDated(today) {
      const { data, error } = await supabase.rpc('expire_dated_activities', { p_today: today });
      if (error) throw coded(error);
      return data ?? 0;
    },
    async listActiveActivitySources() {
      const { data, error } = await supabase
        .from('content_sources')
        .select('id, kind, url, status, last_attempted_at, last_verified_at, last_content_hash')
        .eq('status', 'active')
        .in('kind', ['venue_page', 'event_page']);
      if (error) throw coded(error);
      return (data ?? []).map(sourceRecord);
    },
  };
}
