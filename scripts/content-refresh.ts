import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { isExceptionReason, type ExceptionReason } from '../src/lib/content-pipeline/exceptions';
import { formatContentInstant, readDescriptionFact, type DescriptionFact } from '../src/lib/content-pipeline/facts';
import { seedSourcesFromRegistry } from '../src/lib/content-pipeline/registry';
import {
  contentRefreshAllowed,
  contentRepoPath,
  maintenanceIdempotencyKey,
  MAINTENANCE_ACCOUNT_TIER,
  MAINTENANCE_FEATURE_CLASS,
  parseContentRefreshArgs,
  refreshContentSources,
  type ContentSourceRecord,
  type RefreshEffects,
} from '../src/lib/content-pipeline/refresh';
import type { RecipeSnapshot } from '../src/lib/content-pipeline/change-detect';
import { callMenuModel, MENU_RECIPE_MODEL } from '../src/lib/recipes/menu-generate';
import { loadMenuSources } from '../src/lib/recipes/menu-sources';
import type { Database, Json } from '../src/types/database.types';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const HELP = `Operator-only content maintenance. Default --refresh is a dry-run.

  npm run content:refresh -- --sources
  npm run content:refresh -- --register
  WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --register --apply
  npm run content:refresh -- --refresh
  npm run content:refresh -- --refresh --source <uuid>
  npm run content:refresh -- --refresh --from-file .menu-recipes/menu.html --source <uuid>
  WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --refresh --apply
  npm run content:refresh -- --exceptions
  WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --resolve <uuid> approve
  WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --rollback recipe <uuid>

--register copies scripts/fixtures/e05-menu-sources.json into content_sources.
The migration does not insert those URLs. --refresh fetches active public_menu
rows only. A byte-identical page records unchanged and does not call the model.
Model calls on --apply reserve G13-A maintenance (account tier ops, no member).
Conflicts, removed dishes, prices, hours, dietary claims, and injected text open
content_exceptions and are not published.

Hosted reads and writes need Noah's separate OK, then WANDERBITE_CONTENT_REFRESH_HOSTED_OK=1
for that run. Writes also need WANDERBITE_CONTENT_REFRESH_APPLY=1. Do not point this at hosted
as part of ordinary local review.
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function client(mode: 'read' | 'write'): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  if (!url || !key) fail('content refresh needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  const allowed = contentRefreshAllowed(url, mode);
  if (!allowed.ok) fail(allowed.reason);
  return createClient<Database>(url, key);
}

function first<T>(data: T[] | T | null): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

async function main(): Promise<void> {
  const parsed = parseContentRefreshArgs(process.argv.slice(2));
  if ('error' in parsed) fail(parsed.error);
  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }
  const needsWrite = parsed.apply
    || parsed.command === 'resolve'
    || parsed.command === 'rollback';
  const supabase = client(needsWrite || parsed.apply ? 'write' : 'read');
  if (parsed.command === 'sources') {
    await listSources(supabase);
    return;
  }
  if (parsed.command === 'exceptions') {
    await listExceptions(supabase);
    return;
  }
  if (parsed.command === 'register') {
    await registerSources(supabase, parsed.registryPath, parsed.apply);
    return;
  }
  if (parsed.command === 'resolve' && parsed.resolveId && parsed.resolveAction) {
    await resolveException(supabase, parsed.resolveId, parsed.resolveAction);
    return;
  }
  if (parsed.command === 'rollback' && parsed.rollbackKind && parsed.rollbackId) {
    await rollback(supabase, parsed.rollbackKind, parsed.rollbackId);
    return;
  }
  if (parsed.command === 'refresh') {
    await refresh(supabase, parsed);
    return;
  }
  fail('content refresh command was not recognized');
}

async function listSources(supabase: SupabaseClient<Database>): Promise<void> {
  const { data, error } = await supabase
    .from('content_sources')
    .select('id, kind, url, status, last_attempted_at, last_verified_at, notes')
    .order('url');
  if (error) fail('content source list failed');
  for (const row of data ?? []) {
    process.stdout.write(
      `${row.id} kind=${row.kind} status=${row.status} attempted=${formatContentInstant(row.last_attempted_at)} verified=${formatContentInstant(row.last_verified_at)} url=${row.url}\n`,
    );
  }
  process.stdout.write(`sources=${data?.length ?? 0}\n`);
}

async function listExceptions(supabase: SupabaseClient<Database>): Promise<void> {
  const { data, error } = await supabase
    .from('content_exceptions')
    .select('id, source_id, field, reason, status, resolved_at, evidence_excerpt')
    .order('id');
  if (error) fail('exception list failed');
  for (const row of data ?? []) {
    process.stdout.write(
      `${row.id} status=${row.status} reason=${row.reason} field=${row.field ?? ''} resolved=${formatContentInstant(row.resolved_at)} source=${row.source_id}\n`,
    );
  }
  process.stdout.write(`exceptions=${data?.length ?? 0}\n`);
}

async function registerSources(supabase: SupabaseClient<Database>, registryPath: string, apply: boolean): Promise<void> {
  const fullPath = contentRepoPath(registryPath, process.cwd());
  if (!fullPath) fail('registry path must stay inside the repo');
  let text = '';
  try {
    text = readFileSync(fullPath, 'utf8');
  } catch {
    fail('menu source registry was not found');
  }
  const registry = loadMenuSources(text);
  if (!registry.ok) fail(registry.reason);
  const seeds = seedSourcesFromRegistry(registry.sources);
  for (const seed of seeds) {
    const { data: existing, error: lookupError } = await supabase
      .from('content_sources')
      .select('id, url')
      .eq('url', seed.url)
      .maybeSingle();
    if (lookupError) fail('content source lookup failed');
    if (existing) {
      process.stdout.write(`exists ${existing.id} ${seed.url}\n`);
      continue;
    }
    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('id, slug')
      .eq('slug', seed.restaurantSlug)
      .maybeSingle();
    if (restaurantError) fail('restaurant lookup failed');
    if (!apply) {
      process.stdout.write(`would register ${seed.restaurantSlug} ${seed.url}\n`);
      continue;
    }
    const { data, error } = await supabase
      .from('content_sources')
      .insert({
        kind: seed.kind,
        url: seed.url,
        restaurant_id: restaurant?.id ?? null,
        notes: seed.notes,
        status: 'active',
      })
      .select('id')
      .single();
    if (error || !data) fail('content source insert failed');
    process.stdout.write(`registered ${data.id} ${seed.url}\n`);
  }
}

async function resolveException(
  supabase: SupabaseClient<Database>,
  id: string,
  action: 'approve' | 'reject',
): Promise<void> {
  const status = action === 'approve' ? 'approved' : 'rejected';
  const { data, error } = await supabase
    .from('content_exceptions')
    .update({ status, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'open')
    .select('id');
  if (error) fail('exception resolve failed');
  if ((data ?? []).length !== 1) fail('exception was not an open row');
  process.stdout.write(`${status} ${id}\n`);
}

async function rollback(supabase: SupabaseClient<Database>, kind: 'fact' | 'recipe', id: string): Promise<void> {
  if (kind === 'fact') {
    const { data, error } = await supabase.rpc('rollback_content_fact', { p_fact_id: id });
    if (error || !data) fail('fact rollback failed');
    process.stdout.write(`rolled back fact ${id} as ${data}\n`);
    return;
  }
  const { data, error } = await supabase.rpc('rollback_recipe_to_previous', { p_recipe_id: id });
  if (error || data == null) fail('recipe rollback failed');
  process.stdout.write(`rolled back recipe ${id} to version ${data}\n`);
}

async function refresh(
  supabase: SupabaseClient<Database>,
  parsed: { apply: boolean; sourceId: string | null; fromFile: string | null },
): Promise<void> {
  let query = supabase
    .from('content_sources')
    .select('id, kind, url, status, last_attempted_at, last_verified_at, last_content_hash')
    .order('url');
  if (parsed.sourceId) query = query.eq('id', parsed.sourceId);
  else query = query.eq('status', 'active').eq('kind', 'public_menu');
  const { data, error } = await query;
  if (error) fail('content source load failed');
  const rows = data ?? [];
  if (parsed.sourceId && rows.length === 0) fail('Refused. That source is not in content_sources.');
  const sources: ContentSourceRecord[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    url: row.url,
    status: row.status as ContentSourceRecord['status'],
    lastAttemptedAt: row.last_attempted_at,
    lastVerifiedAt: row.last_verified_at,
    lastContentHash: row.last_content_hash,
  }));
  let html: string | null = null;
  if (parsed.fromFile) {
    const filePath = contentRepoPath(parsed.fromFile, process.cwd());
    if (!filePath) fail('menu text path must stay inside the repo');
    try {
      html = readFileSync(filePath, 'utf8');
    } catch {
      fail('menu text file was not found');
    }
    if (Buffer.byteLength(html, 'utf8') > 1_000_000) fail('menu text file exceeds the size cap');
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? '';
  const effects: RefreshEffects | undefined = parsed.apply ? dbEffects(supabase) : undefined;
  const summary = await refreshContentSources({
    sources,
    apply: parsed.apply,
    htmlBySourceId: html && parsed.sourceId ? new Map([[parsed.sourceId, html]]) : undefined,
    load: (source) => loadSourceContext(supabase, source.id),
    callModel: async (input) => {
      if (!apiKey) fail('ANTHROPIC_API_KEY is not set. Apply still uses the maintenance budget, not a member budget.');
      return callMenuModel({ ...input, apiKey });
    },
    reserveModel: parsed.apply
      ? async (input) => {
          if (!apiKey) {
            fail('ANTHROPIC_API_KEY is not set. Apply uses the maintenance budget, not a member budget.');
          }
          return reserveMaintenance(supabase, input);
        }
      : undefined,
    effects,
  });
  for (const result of summary.results) {
    const outcomes = result.attempts.map((row) => row.outcome).join(',') || 'none';
    process.stdout.write(
      `source=${result.sourceId} refused=${result.refused ?? ''} attempts=${outcomes} model_calls=${result.modelCalls} model_needed=${result.modelNeeded} baselines=${result.baselines.length} updates=${result.updates.length} exceptions=${result.exceptions.length} verified=${result.verified}\n`,
    );
  }
  for (const skip of summary.skips) process.stdout.write(`skip: ${skip}\n`);
  process.stdout.write(`mode=${parsed.apply ? 'apply' : 'dry-run'} model=${MENU_RECIPE_MODEL}\n`);
}

async function loadSourceContext(supabase: SupabaseClient<Database>, sourceId: string): Promise<{
  facts: DescriptionFact[];
  recipes: RecipeSnapshot[];
  openExceptions: { subjectId: string | null; field: string | null; reason: ExceptionReason }[];
}> {
  const { data: factRows, error: factError } = await supabase
    .from('source_facts')
    .select('id, source_id, subject_id, version, status, value, evidence_excerpt, field')
    .eq('source_id', sourceId)
    .eq('field', 'description');
  if (factError) fail('fact load failed');
  const facts = (factRows ?? []).flatMap((row) => {
    const parsed = readDescriptionFact(row);
    return parsed ? [parsed] : [];
  });
  const { data: sourceRow, error: sourceError } = await supabase
    .from('content_sources')
    .select('id, url, restaurant_id')
    .eq('id', sourceId)
    .single();
  if (sourceError || !sourceRow) fail('content source load failed');
  let recipeQuery = supabase
    .from('recipes')
    .select('id, title, description, version, visibility, recipe_type, source_kind, source_url')
    .eq('recipe_type', 'inspired_by')
    .eq('source_kind', 'public_menu')
    .eq('source_url', sourceRow.url);
  if (sourceRow.restaurant_id) recipeQuery = recipeQuery.eq('restaurant_id', sourceRow.restaurant_id);
  const { data: recipeRows, error: recipeError } = await recipeQuery;
  if (recipeError) fail('recipe load failed');
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
  if (openError) fail('exception load failed');
  const openExceptions = (openRows ?? []).flatMap((row) => {
    if (!isExceptionReason(row.reason)) return [];
    return [{ subjectId: row.subject_id, field: row.field, reason: row.reason }];
  });
  return { facts, recipes, openExceptions };
}

function dbEffects(supabase: SupabaseClient<Database>): RefreshEffects {
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
      if (error) fail('attempt insert failed');
    },
    updateSource: async (sourceId, patch) => {
      const update: Database['public']['Tables']['content_sources']['Update'] = {
        last_attempted_at: patch.lastAttemptedAt,
      };
      if (patch.lastVerifiedAt) update.last_verified_at = patch.lastVerifiedAt;
      if (patch.lastContentHash) update.last_content_hash = patch.lastContentHash;
      const { error } = await supabase.from('content_sources').update(update).eq('id', sourceId);
      if (error) fail('source update failed');
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
      if (error) fail('description fact apply failed');
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
      if (error) fail('exception insert failed');
    },
  };
}

async function reserveMaintenance(
  supabase: SupabaseClient<Database>,
  input: { sourceId: string; contentHash: string; estimatedInput: number; estimatedOutput: number },
) {
  const versionsResult = await supabase.rpc('ai_current_versions');
  if (versionsResult.error) return { ok: false as const, reason: 'maintenance versions unavailable' };
  const versions = first(versionsResult.data);
  if (!versions) return { ok: false as const, reason: 'maintenance versions unavailable' };
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
  if (reserved.error) return { ok: false as const, reason: 'maintenance reserve failed' };
  const row = first(reserved.data);
  if (!row?.acquired) return { ok: false as const, reason: row?.deny_reason || 'maintenance budget denied' };
  const dispatched = await supabase.rpc('ai_dispatch', { p_request_id: row.request_id });
  if (dispatched.error) return { ok: false as const, reason: 'maintenance dispatch failed' };
  const dispatchRow = first(dispatched.data);
  if (!dispatchRow?.acquired) return { ok: false as const, reason: 'maintenance dispatch denied' };
  return {
    ok: true as const,
    settle: async (actual: { input: number; output: number } | null) => {
      const settled = await supabase.rpc('ai_settle', {
        p_request_id: row.request_id,
        p_usage_actual: actual ?? usage,
      });
      if (settled.error) fail('maintenance settle failed');
    },
    release: async () => {
      const released = await supabase.rpc('ai_mark_assumed_spent', { p_request_id: row.request_id });
      if (released.error) fail('maintenance release failed');
    },
  };
}

main().catch((err: unknown) => {
  console.error('[content-refresh] failed');
  fail(err instanceof Error ? err.message : 'content refresh failed');
});
