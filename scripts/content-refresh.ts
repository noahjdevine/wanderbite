import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { activitiesToExpire } from '../src/lib/activities/expire';
import { chicagoCalendarDate } from '../src/lib/activities/match';
import { activityFactValue, type ActivityFactSnapshot, type ActivitySnapshot } from '../src/lib/content-pipeline/activity-plan';
import { isExceptionReason } from '../src/lib/content-pipeline/exceptions';
import { formatContentInstant, readDescriptionFact } from '../src/lib/content-pipeline/facts';
import { restaurantPageSeedsFromWebsites } from '../src/lib/content-pipeline/briefing-register';
import { briefingValue, readOpenPendingDraft, type OpenPendingDraft } from '../src/lib/content-pipeline/briefing-plan';
import { isBriefingField } from '../src/lib/briefings/types';
import {
  FETCHED_SOURCE_KINDS,
  isActivitySourceKind,
  isRestaurantPageKind,
  loadActivitySourceRegistry,
  manualRefreshOrder,
  seedSourcesFromRegistry,
  type ActivitySeed,
} from '../src/lib/content-pipeline/registry';
import {
  contentRefreshAllowed,
  contentRepoPath,
  maintenanceIdempotencyKey,
  MAINTENANCE_ACCOUNT_TIER,
  MAINTENANCE_FEATURE_CLASS,
  parseContentRefreshArgs,
  refreshContentSources,
  type ContentSourceContext,
  type ContentSourceRecord,
  type RefreshEffects,
} from '../src/lib/content-pipeline/refresh';
import type { RecipeSnapshot } from '../src/lib/content-pipeline/change-detect';
import { callMenuModel, MENU_RECIPE_MODEL } from '../src/lib/recipes/menu-generate';
import { loadMenuSources, type MenuSource } from '../src/lib/recipes/menu-sources';
import type { Database, Json } from '../src/types/database.types';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const HELP = `Operator-only content maintenance. Default --refresh is a dry-run.

  npm run content:refresh -- --sources
  npm run content:refresh -- --register
  npm run content:refresh -- --register --official-websites
  WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --register --apply
  WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --register --official-websites --apply
  npm run content:refresh -- --refresh
  npm run content:refresh -- --refresh --source <uuid>
  npm run content:refresh -- --refresh --from-file .menu-recipes/menu.html --source <uuid>
  WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --refresh --apply
  npm run content:refresh -- --exceptions
  WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --resolve <uuid> approve
  WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --rollback recipe <uuid>
  npm run content:refresh -- --register --registry scripts/fixtures/e06-activity-sources.json
  npm run content:refresh -- --expire
  WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --expire --apply

--register copies scripts/fixtures/e05-menu-sources.json into content_sources.
Pass --registry with venue_page and event_page rows to register activity sources.
--register --official-websites creates restaurant_page rows from
restaurants.official_website when that URL is https. Null websites are skipped.
The migration does not insert those URLs. --refresh fetches active public_menu,
venue_page, and event_page rows, then restaurant_page rows only in slots those
leave under the shared cap of 5. A byte-identical page records unchanged and does
not call the model. Model calls on --apply reserve G13-A maintenance (account tier
ops, no member). One call per source. A restaurant page is read from the fetched
text only. Conflicts, removed evidence, sensitive claims, and injection text open
content_exceptions and are not published. A briefing draft stays pending_review
and does not set restaurant_briefing_facts to active. That draft includes a short
change_summary. An open pending_review row with the same subject, field, and
normalized text is not inserted again. An activity summary is a
pending draft for an activity that already exists, with the same summary and
dedup. This command does not insert
an activity, partnership, booking, discount, credit, or offer.
--expire lists active activities whose valid_until is before today's America/Chicago
date. It does not write unless --apply is set, and it does not delete rows.

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
    if (parsed.officialWebsites) {
      await registerOfficialWebsites(supabase, parsed.apply);
      return;
    }
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
  if (parsed.command === 'expire') {
    await expireActivities(supabase, parsed.apply);
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
    .select('id, source_id, subject_type, field, reason, status, resolved_at, evidence_excerpt')
    .order('id');
  if (error) fail('exception list failed');
  for (const row of data ?? []) {
    process.stdout.write(
      `${row.id} status=${row.status} subject=${row.subject_type ?? ''} reason=${row.reason} field=${row.field ?? ''} resolved=${formatContentInstant(row.resolved_at)} source=${row.source_id}\n`,
    );
  }
  const { data: drafts, error: draftError } = await supabase
    .from('source_facts')
    .select('id, source_id, field, status')
    .eq('subject_type', 'briefing')
    .eq('status', 'pending_review')
    .order('id');
  if (draftError) fail('briefing draft list failed');
  for (const row of drafts ?? []) {
    process.stdout.write(
      `${row.id} status=${row.status} subject=briefing field=${row.field} source=${row.source_id}\n`,
    );
  }
  process.stdout.write(`exceptions=${data?.length ?? 0} briefing_drafts=${drafts?.length ?? 0}\n`);
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
  const registry = loadRegistry(text);
  if (!registry.ok) fail(registry.reason);
  if (registry.kind === 'activity') {
    await registerActivitySources(supabase, registry.sources, apply);
    return;
  }
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

function loadRegistry(text: string):
  | { ok: true; kind: 'menu'; sources: MenuSource[] }
  | { ok: true; kind: 'activity'; sources: ActivitySeed[] }
  | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, reason: 'source registry is not JSON' };
  }
  const first = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as { sources?: unknown }).sources
    : null;
  const entry = Array.isArray(first) ? first[0] : null;
  if (entry && typeof entry === 'object' && !Array.isArray(entry) && 'kind' in entry) {
    const kind = (entry as { kind?: unknown }).kind;
    if (typeof kind === 'string' && isActivitySourceKind(kind)) {
      const loaded = loadActivitySourceRegistry(text);
      return loaded.ok ? { ok: true, kind: 'activity', sources: loaded.sources } : loaded;
    }
  }
  const menu = loadMenuSources(text);
  return menu.ok ? { ok: true, kind: 'menu', sources: menu.sources } : menu;
}

async function registerActivitySources(
  supabase: SupabaseClient<Database>,
  seeds: readonly ActivitySeed[],
  apply: boolean,
): Promise<void> {
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
    let restaurantId: string | null = null;
    if (seed.restaurantSlug) {
      const { data: restaurant, error: restaurantError } = await supabase
        .from('restaurants')
        .select('id, slug')
        .eq('slug', seed.restaurantSlug)
        .maybeSingle();
      if (restaurantError) fail('restaurant lookup failed');
      restaurantId = restaurant?.id ?? null;
    }
    if (!apply) {
      process.stdout.write(`would register ${seed.kind} ${seed.url}\n`);
      continue;
    }
    const { data, error } = await supabase
      .from('content_sources')
      .insert({
        kind: seed.kind,
        url: seed.url,
        restaurant_id: restaurantId,
        notes: seed.notes,
        status: 'active',
      })
      .select('id')
      .single();
    if (error || !data) fail('content source insert failed');
    process.stdout.write(`registered ${data.id} ${seed.kind} ${seed.url}\n`);
  }
}

async function registerOfficialWebsites(supabase: SupabaseClient<Database>, apply: boolean): Promise<void> {
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, name, official_website')
    .not('official_website', 'is', null);
  if (error) {
    if (error.message.includes('official_website')) {
      fail(
        'restaurants.official_website is missing. Apply supabase/migrations/20261105202512_e06_a2_restaurant_official_website.sql on the local database. This script does not apply it.',
      );
    }
    fail('official website lookup failed');
  }
  const mapped = restaurantPageSeedsFromWebsites(
    (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      officialWebsite: row.official_website,
    })),
  );
  process.stdout.write(`skipped=${mapped.skipped}\n`);
  for (const seed of mapped.seeds) {
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
    if (!apply) {
      process.stdout.write(`would register restaurant_page ${seed.restaurantId} ${seed.url}\n`);
      continue;
    }
    const { data: inserted, error: insertError } = await supabase
      .from('content_sources')
      .insert({
        kind: 'restaurant_page',
        url: seed.url,
        restaurant_id: seed.restaurantId,
        notes: seed.notes,
        status: 'active',
      })
      .select('id')
      .single();
    if (insertError || !inserted) fail('content source insert failed');
    process.stdout.write(`registered ${inserted.id} restaurant_page ${seed.url}\n`);
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
  if ((data ?? []).length === 1) {
    process.stdout.write(`${status} ${id}\n`);
    return;
  }
  const { data: fact, error: factError } = await supabase
    .from('source_facts')
    .select('id, subject_type, status')
    .eq('id', id)
    .maybeSingle();
  if (factError) fail('exception resolve failed');
  if (fact?.subject_type === 'briefing' && fact.status === 'pending_review') {
    const { error: decideError } = await supabase.rpc('decide_briefing_fact', {
      p_fact_id: id,
      p_decision: action,
    });
    if (decideError) fail('briefing resolve failed');
    process.stdout.write(`${action === 'approve' ? 'reviewed' : 'rejected'} ${id} published=false\n`);
    return;
  }
  fail('exception was not an open row');
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
    .select('id, kind, url, status, restaurant_id, last_attempted_at, last_verified_at, last_content_hash')
    .order('url');
  if (parsed.sourceId) query = query.eq('id', parsed.sourceId);
  else query = query.eq('status', 'active').in('kind', [...FETCHED_SOURCE_KINDS]);
  const { data, error } = await query;
  if (error) fail('content source load failed');
  const rows = data ?? [];
  if (parsed.sourceId && rows.length === 0) fail('Refused. That source is not in content_sources.');
  let pageRows: typeof rows = [];
  if (!parsed.sourceId) {
    const pages = await supabase
      .from('content_sources')
      .select('id, kind, url, status, restaurant_id, last_attempted_at, last_verified_at, last_content_hash')
      .eq('status', 'active')
      .eq('kind', 'restaurant_page')
      .order('url');
    if (pages.error) fail('content source load failed');
    pageRows = pages.data ?? [];
  }
  const sources: ContentSourceRecord[] = manualRefreshOrder([...rows, ...pageRows]).map((row) => ({
    id: row.id,
    kind: row.kind,
    url: row.url,
    status: row.status as ContentSourceRecord['status'],
    lastAttemptedAt: row.last_attempted_at,
    lastVerifiedAt: row.last_verified_at,
    lastContentHash: row.last_content_hash,
    restaurantId: row.restaurant_id,
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
    load: (source) => loadSourceContext(supabase, source),
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

async function expireActivities(supabase: SupabaseClient<Database>, apply: boolean): Promise<void> {
  const now = new Date();
  const today = chicagoCalendarDate(now);
  if (!today) fail('Chicago date was not available');
  const { data, error } = await supabase
    .from('activities')
    .select('id, name, status, valid_until')
    .eq('status', 'active')
    .not('valid_until', 'is', null);
  if (error) fail('activity expiry list failed');
  const due = activitiesToExpire(data ?? [], now);
  for (const row of due) {
    process.stdout.write(`${apply ? 'expire' : 'would expire'} ${row.id} ${row.name} valid_until=${row.valid_until}\n`);
  }
  if (!apply) {
    process.stdout.write(`mode=dry-run expire=${due.length} chicago_date=${today}\n`);
    return;
  }
  const { data: count, error: rpcError } = await supabase.rpc('expire_dated_activities', { p_today: today });
  if (rpcError) fail('activity expiry update failed');
  process.stdout.write(`mode=apply expired=${count ?? 0} chicago_date=${today}\n`);
}

async function loadSourceContext(
  supabase: SupabaseClient<Database>,
  source: ContentSourceRecord,
): Promise<ContentSourceContext> {
  const sourceId = source.id;
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
  if (isRestaurantPageKind(source.kind)) {
    const briefingContext = await loadBriefingContext(supabase, sourceRow.restaurant_id);
    return { facts, recipes, openExceptions, activities: [], activityFacts: [], ...briefingContext };
  }
  const activityContext = await loadActivityContext(supabase, source);
  return { facts, recipes, openExceptions, ...activityContext };
}

async function loadBriefingContext(
  supabase: SupabaseClient<Database>,
  restaurantId: string | null,
): Promise<{ briefings: { field: string; body: string; status: string }[]; restaurantName: string; pendingDrafts: OpenPendingDraft[] }> {
  if (!restaurantId) return { briefings: [], restaurantName: '', pendingDrafts: [] };
  const [facts, restaurant, pending] = await Promise.all([
    supabase.from('restaurant_briefing_facts').select('field, body, status').eq('restaurant_id', restaurantId),
    supabase.from('restaurants').select('name').eq('id', restaurantId).maybeSingle(),
    supabase
      .from('source_facts')
      .select('subject_type, subject_id, field, status, value')
      .eq('subject_type', 'briefing')
      .eq('subject_id', restaurantId)
      .eq('status', 'pending_review'),
  ]);
  if (facts.error) fail('briefing fact load failed');
  if (restaurant.error) fail('restaurant load failed');
  if (pending.error) fail('briefing draft load failed');
  return {
    briefings: (facts.data ?? []).flatMap((row) => (isBriefingField(row.field) ? [row] : [])),
    restaurantName: restaurant.data?.name ?? '',
    pendingDrafts: (pending.data ?? []).flatMap((row) => {
      const parsed = readOpenPendingDraft(row);
      return parsed ? [parsed] : [];
    }),
  };
}

function readActivityFact(row: {
  id: string;
  subject_id: string | null;
  field: string;
  status: string;
  value: Json;
}): ActivityFactSnapshot | null {
  if (!row.subject_id) return null;
  if (!row.value || typeof row.value !== 'object' || Array.isArray(row.value)) return null;
  const value = row.value as Record<string, Json | undefined>;
  return {
    id: row.id,
    subjectId: row.subject_id,
    field: row.field,
    status: row.status,
    text: typeof value.text === 'string' ? value.text : null,
    price: typeof value.price === 'string' ? value.price : null,
    hoursNote: typeof value.hours_note === 'string' ? value.hours_note : null,
  };
}

async function loadActivityContext(
  supabase: SupabaseClient<Database>,
  source: ContentSourceRecord,
): Promise<{ activities: ActivitySnapshot[]; activityFacts: ActivityFactSnapshot[]; pendingDrafts: OpenPendingDraft[] }> {
  if (!isActivitySourceKind(source.kind)) return { activities: [], activityFacts: [], pendingDrafts: [] };
  const columns = 'id, name, source_url, content_source_id, status, hours_note, booking_required, version';
  const [bySource, byUrl] = await Promise.all([
    supabase.from('activities').select(columns).eq('content_source_id', source.id),
    supabase.from('activities').select(columns).eq('source_url', source.url),
  ]);
  if (bySource.error || byUrl.error) fail('activity load failed');
  const merged = new Map<string, ActivitySnapshot>();
  for (const row of [...(bySource.data ?? []), ...(byUrl.data ?? [])]) {
    merged.set(row.id, {
      id: row.id,
      name: row.name,
      sourceUrl: row.source_url,
      contentSourceId: row.content_source_id,
      status: row.status,
      hoursNote: row.hours_note,
      bookingRequired: row.booking_required,
      version: row.version,
    });
  }
  const { data: factRows, error: factError } = await supabase
    .from('source_facts')
    .select('id, subject_id, field, status, value')
    .eq('source_id', source.id)
    .eq('subject_type', 'activity');
  if (factError) fail('activity fact load failed');
  const activityFacts = (factRows ?? []).flatMap((row) => {
    const parsed = readActivityFact(row);
    return parsed ? [parsed] : [];
  });
  const activityIds = [...merged.keys()];
  let pendingDrafts: OpenPendingDraft[] = [];
  if (activityIds.length > 0) {
    const { data: pendingRows, error: pendingError } = await supabase
      .from('source_facts')
      .select('subject_type, subject_id, field, status, value')
      .eq('subject_type', 'activity')
      .eq('field', 'summary')
      .eq('status', 'pending_review')
      .in('subject_id', activityIds);
    if (pendingError) fail('activity draft load failed');
    pendingDrafts = (pendingRows ?? []).flatMap((row) => {
      const parsed = readOpenPendingDraft(row);
      return parsed ? [parsed] : [];
    });
  }
  return { activities: [...merged.values()], activityFacts, pendingDrafts };
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
    applyActivityFact: async (row) => {
      const { error } = await supabase.rpc('apply_activity_field_fact', {
        p_source_id: row.sourceId,
        p_activity_id: row.activityId,
        p_field: row.field,
        p_value: activityFactValue(row),
        p_evidence_excerpt: row.evidenceExcerpt,
      });
      if (error) fail('activity fact apply failed');
    },
    applyBriefingFact: async (row) => {
      const { error } = await supabase.rpc('apply_briefing_field_fact', {
        p_source_id: row.sourceId,
        p_restaurant_id: row.restaurantId,
        p_field: row.field,
        p_value: briefingValue(row),
        p_evidence_excerpt: row.evidenceExcerpt,
      });
      if (error) fail('briefing fact apply failed');
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
