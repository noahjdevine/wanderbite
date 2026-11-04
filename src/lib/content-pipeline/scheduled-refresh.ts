import type { SupabaseClient } from '@supabase/supabase-js';
import type { RecipeSnapshot } from '@/lib/content-pipeline/change-detect';
import { isExceptionReason, type ExceptionReason } from '@/lib/content-pipeline/exceptions';
import { readDescriptionFact, type DescriptionFact } from '@/lib/content-pipeline/facts';
import {
  MAINTENANCE_ACCOUNT_TIER,
  MAINTENANCE_FEATURE_CLASS,
  maintenanceIdempotencyKey,
  refreshContentSources,
  type ContentSourceRecord,
  type MaintenanceReservation,
  type RefreshEffects,
  type RefreshSourceResult,
} from '@/lib/content-pipeline/refresh';
import { callMenuModel, MENU_RECIPE_MODEL } from '@/lib/recipes/menu-generate';
import type { Database, Json } from '@/types/database.types';

type Client = SupabaseClient<Database>;

function first<T>(data: T[] | T | null): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

export function contentRefreshEffects(supabase: Client): RefreshEffects {
  return {
    recordAttempt: async (row) => {
      const { error } = await supabase.from('source_fetch_attempts').insert({
        source_id: row.sourceId,
        attempted_at: row.attemptedAt,
        outcome: row.outcome,
        http_status: row.httpStatus,
        content_hash: row.contentHash,
        error_code: row.errorCode,
      });
      if (error) throw new Error('attempt insert failed');
    },
    updateSource: async (sourceId, patch) => {
      const update: Database['public']['Tables']['content_sources']['Update'] = {
        last_attempted_at: patch.lastAttemptedAt,
      };
      if (patch.lastVerifiedAt) update.last_verified_at = patch.lastVerifiedAt;
      if (patch.lastContentHash) update.last_content_hash = patch.lastContentHash;
      const { error } = await supabase.from('content_sources').update(update).eq('id', sourceId);
      if (error) throw new Error('source update failed');
    },
    applyDescriptionFact: async (row) => {
      const { error } = await supabase.rpc('apply_recipe_description_fact', {
        p_source_id: row.sourceId,
        p_recipe_id: row.recipeId,
        p_value: row.value as unknown as Json,
        p_evidence_excerpt: row.evidenceExcerpt,
        p_retrieved_at: row.retrievedAt ?? undefined,
        p_supersede_fact_id: row.supersedeFactId ?? undefined,
      });
      if (error) throw new Error('description fact apply failed');
    },
    openException: async (row) => {
      const { error } = await supabase.from('content_exceptions').insert({
        source_id: row.sourceId,
        subject_type: row.subjectType,
        subject_id: row.subjectId,
        field: row.field,
        reason: row.reason,
        before: row.before,
        after: row.after,
        evidence_excerpt: row.evidenceExcerpt,
        status: 'open',
      });
      if (error) throw new Error('exception insert failed');
    },
  };
}

export async function loadActiveMenuSources(supabase: Client): Promise<ContentSourceRecord[]> {
  const { data, error } = await supabase
    .from('content_sources')
    .select('id, kind, url, status, last_attempted_at, last_verified_at, last_content_hash')
    .eq('status', 'active')
    .eq('kind', 'public_menu')
    .order('url');
  if (error) throw new Error('content source load failed');
  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    url: row.url,
    status: row.status as ContentSourceRecord['status'],
    lastAttemptedAt: row.last_attempted_at,
    lastVerifiedAt: row.last_verified_at,
    lastContentHash: row.last_content_hash,
  }));
}

export async function loadContentSourceContext(
  supabase: Client,
  sourceId: string,
): Promise<{
  facts: DescriptionFact[];
  recipes: RecipeSnapshot[];
  openExceptions: { subjectId: string | null; field: string | null; reason: ExceptionReason }[];
}> {
  const { data: factRows, error: factError } = await supabase
    .from('source_facts')
    .select('id, source_id, subject_id, version, status, value, evidence_excerpt')
    .eq('source_id', sourceId)
    .eq('field', 'description');
  if (factError) throw new Error('fact load failed');
  const facts = (factRows ?? []).flatMap((row) => {
    const parsed = readDescriptionFact(row);
    return parsed ? [parsed] : [];
  });
  const { data: sourceRow, error: sourceError } = await supabase
    .from('content_sources')
    .select('id, url, restaurant_id')
    .eq('id', sourceId)
    .single();
  if (sourceError || !sourceRow) throw new Error('content source load failed');
  let recipeQuery = supabase
    .from('recipes')
    .select('id, title, description, version, visibility, recipe_type, source_kind, source_url')
    .eq('recipe_type', 'inspired_by')
    .eq('source_kind', 'public_menu')
    .eq('source_url', sourceRow.url);
  if (sourceRow.restaurant_id) recipeQuery = recipeQuery.eq('restaurant_id', sourceRow.restaurant_id);
  const { data: recipeRows, error: recipeError } = await recipeQuery;
  if (recipeError) throw new Error('recipe load failed');
  const recipes: RecipeSnapshot[] = (recipeRows ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    version: row.version,
    visibility: row.visibility,
    recipeType: row.recipe_type,
    sourceKind: row.source_kind,
    sourceUrl: row.source_url,
  }));
  const { data: openRows, error: openError } = await supabase
    .from('content_exceptions')
    .select('subject_id, field, reason')
    .eq('source_id', sourceId)
    .eq('status', 'open');
  if (openError) throw new Error('exception load failed');
  const openExceptions = (openRows ?? []).flatMap((row) => {
    if (!isExceptionReason(row.reason)) return [];
    return [{ subjectId: row.subject_id, field: row.field, reason: row.reason }];
  });
  return { facts, recipes, openExceptions };
}

export async function reserveMaintenance(
  supabase: Client,
  input: { sourceId: string; contentHash: string; estimatedInput: number; estimatedOutput: number },
): Promise<MaintenanceReservation> {
  const versionsResult = await supabase.rpc('ai_current_versions');
  if (versionsResult.error) return { ok: false, reason: 'maintenance versions unavailable' };
  const versions = first(versionsResult.data);
  if (!versions) return { ok: false, reason: 'maintenance versions unavailable' };
  const usage = { input: input.estimatedInput, output: input.estimatedOutput };
  const reserved = await supabase.rpc('ai_reserve', {
    p_account_tier: MAINTENANCE_ACCOUNT_TIER,
    p_config_version_id: versions.config_version_id,
    p_feature_class: MAINTENANCE_FEATURE_CLASS,
    p_idempotency_key: maintenanceIdempotencyKey(input.sourceId, input.contentHash),
    p_model_id: MENU_RECIPE_MODEL,
    p_price_version_id: versions.price_version_id,
    p_provider: 'anthropic',
    p_usage_units: usage,
  });
  if (reserved.error) return { ok: false, reason: 'maintenance reserve failed' };
  const row = first(reserved.data);
  if (!row?.acquired) return { ok: false, reason: row?.deny_reason || 'maintenance budget denied' };
  const dispatched = await supabase.rpc('ai_dispatch', { p_request_id: row.request_id });
  if (dispatched.error) return { ok: false, reason: 'maintenance dispatch failed' };
  const dispatchRow = first(dispatched.data);
  if (!dispatchRow?.acquired) return { ok: false, reason: 'maintenance dispatch denied' };
  return {
    ok: true,
    settle: async (actual) => {
      const settled = await supabase.rpc('ai_settle', {
        p_request_id: row.request_id,
        p_usage_actual: actual ?? usage,
      });
      if (settled.error) throw new Error('maintenance settle failed');
    },
    release: async () => {
      const released = await supabase.rpc('ai_mark_assumed_spent', { p_request_id: row.request_id });
      if (released.error) throw new Error('maintenance release failed');
    },
  };
}

export async function runApplyContentRefresh(args: {
  sources: readonly ContentSourceRecord[];
  load: (source: ContentSourceRecord) => Promise<{
    facts: DescriptionFact[];
    recipes: RecipeSnapshot[];
    openExceptions: { subjectId: string | null; field: string | null; reason: ExceptionReason }[];
  }>;
  effects?: RefreshEffects;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  callModel?: Parameters<typeof refreshContentSources>[0]['callModel'];
  reserveModel?: Parameters<typeof refreshContentSources>[0]['reserveModel'];
}): Promise<{ results: RefreshSourceResult[]; skips: string[] }> {
  return refreshContentSources({
    sources: args.sources,
    load: args.load,
    apply: true,
    effects: args.effects,
    fetchImpl: args.fetchImpl,
    now: args.now,
    sleep: args.sleep,
    callModel: args.callModel,
    reserveModel: args.reserveModel,
  });
}

export function scheduledModelCaller(apiKey: string | undefined): NonNullable<
  Parameters<typeof refreshContentSources>[0]['callModel']
> {
  return (input) => callMenuModel({ ...input, apiKey: apiKey ?? '' });
}

export function refreshItemStatus(result: RefreshSourceResult): 'succeeded' | 'skipped' | 'failed' {
  if (result.refused) return 'skipped';
  const outcome = result.attempts.at(-1)?.outcome;
  if (outcome === 'ok' || outcome === 'unchanged') return 'succeeded';
  if (!outcome) return 'skipped';
  return 'failed';
}
