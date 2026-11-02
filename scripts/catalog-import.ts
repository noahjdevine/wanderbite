import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  applyCatalogPlan,
  buildCatalogPlan,
  CATALOG_IMPORT_PLAN_SCHEMA,
  isTestOfferAuditMarker,
  TEST_OFFER_AUDIT_ACTIONS,
  TEST_OFFER_AUDIT_TARGET_TYPE,
  emptyGeocodeCache,
  fetchGooglePlaceCoordinates,
  formatCatalogImportSummary,
  geocodeWithCache,
  importRowsFromSnapshot,
  parseCatalogImportArgs,
  parseCatalogImportDocument,
  type CatalogDbRestaurant,
  type CatalogDbSnapshot,
  type CatalogExecutor,
  type CatalogPlan,
  type CatalogRestaurantPatch,
  type GeocodeCache,
  type GeocodeRequest,
  type GeocodeResult,
} from '../src/lib/catalog/import';
import type { Database, Json } from '../src/types/database.types';

const ROOT = path.resolve('.supply-gate');
const GEOCODE_CACHE = '.supply-gate/geocode-cache.json';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

export function confinedCatalogPath(candidate: string): string {
  const resolved = path.resolve(candidate);
  const relative = path.relative(ROOT, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('catalog import path rejected');
  }
  return resolved;
}

function readConfined(candidate: string): string {
  const confined = confinedCatalogPath(candidate);
  let rootReal: string;
  let fileReal: string;
  try {
    rootReal = realpathSync(ROOT);
    fileReal = realpathSync(confined);
  } catch {
    fail(`catalog import file not found: ${candidate}`);
  }
  const relative = path.relative(rootReal, fileReal);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('catalog import path rejected');
  }
  const text = readFileSync(fileReal, 'utf8');
  if (Buffer.byteLength(text, 'utf8') > 16 * 1024 * 1024) fail('catalog import file is too large');
  return text;
}

function writeConfined(candidate: string, contents: string): void {
  const confined = confinedCatalogPath(candidate);
  mkdirSync(ROOT, { recursive: true });
  mkdirSync(path.dirname(confined), { recursive: true });
  const rootReal = realpathSync(ROOT);
  const parentReal = realpathSync(path.dirname(confined));
  const relative = path.relative(rootReal, parentReal);
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail('catalog import path rejected');
  const temporary = `${confined}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporary, confined);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function readCache(): GeocodeCache {
  try {
    const confined = confinedCatalogPath(GEOCODE_CACHE);
    const parsed = JSON.parse(readFileSync(confined, 'utf8')) as GeocodeCache;
    if (parsed.v !== 1 || !parsed.entries || typeof parsed.entries !== 'object') return emptyGeocodeCache();
    return parsed;
  } catch {
    return emptyGeocodeCache();
  }
}

function client(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail('catalog import needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  return createClient<Database>(url, key);
}

function asNumber(value: number | string | null): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordMetadata(value: Json | null): { [key: string]: Json | undefined } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as { [key: string]: Json | undefined };
}

async function loadSnapshot(supabase: SupabaseClient<Database>): Promise<CatalogDbSnapshot> {
  const marketsResult = await supabase
    .from('markets')
    .select('id, slug, name, state, timezone, status')
    .order('id');
  if (marketsResult.error) throw new Error(marketsResult.error.message);
  const restaurants: CatalogDbRestaurant[] = [];
  for (let from = 0; ; from += 1000) {
    const result = await supabase
      .from('restaurants')
      .select(
        'id, market_id, name, slug, address, lat, lon, google_place_id, cuisine_tags, is_vegan, is_dairy_free, is_halal, price_range, neighborhood, status, current_offer_version_id',
      )
      .order('id')
      .range(from, from + 999);
    if (result.error) throw new Error(result.error.message);
    for (const row of result.data ?? []) {
      restaurants.push({
        id: row.id,
        market_id: row.market_id,
        name: row.name,
        slug: row.slug,
        address: row.address,
        lat: asNumber(row.lat),
        lon: asNumber(row.lon),
        google_place_id: row.google_place_id,
        cuisine_tags: row.cuisine_tags,
        is_vegan: row.is_vegan,
        is_dairy_free: row.is_dairy_free,
        is_halal: row.is_halal,
        price_range: row.price_range,
        neighborhood: row.neighborhood,
        status: row.status,
        current_offer_version_id: row.current_offer_version_id,
        challenge_item_count: 0,
        offer_version_count: 0,
      });
    }
    if ((result.data ?? []).length < 1000) break;
  }
  const itemCounts = new Map<string, number>();
  const versionCounts = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const result = await supabase
      .from('challenge_items')
      .select('restaurant_id')
      .order('id')
      .range(from, from + 999);
    if (result.error) throw new Error(result.error.message);
    for (const row of result.data ?? []) {
      if (!row.restaurant_id) continue;
      itemCounts.set(row.restaurant_id, (itemCounts.get(row.restaurant_id) ?? 0) + 1);
    }
    if ((result.data ?? []).length < 1000) break;
  }
  for (let from = 0; ; from += 1000) {
    const result = await supabase.from('offer_versions').select('restaurant_id').order('id').range(from, from + 999);
    if (result.error) throw new Error(result.error.message);
    for (const row of result.data ?? []) {
      versionCounts.set(row.restaurant_id, (versionCounts.get(row.restaurant_id) ?? 0) + 1);
    }
    if ((result.data ?? []).length < 1000) break;
  }
  for (const restaurant of restaurants) {
    restaurant.challenge_item_count = itemCounts.get(restaurant.id) ?? 0;
    restaurant.offer_version_count = versionCounts.get(restaurant.id) ?? 0;
  }
  const markets = marketsResult.data ?? [];
  const marketSlug = new Map(markets.map((market) => [market.id, market.slug]));
  const restaurantMarket = new Map(
    restaurants.flatMap((restaurant) =>
      restaurant.market_id ? [[restaurant.id, marketSlug.get(restaurant.market_id) ?? ''] as const] : [],
    ),
  );
  const testOffers: CatalogDbSnapshot['test_offers'] = [];
  const seenTestVersions = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const result = await supabase
      .from('admin_audit_log')
      .select('action, target_type, target_id, metadata')
      .in('action', [...TEST_OFFER_AUDIT_ACTIONS])
      .eq('target_type', TEST_OFFER_AUDIT_TARGET_TYPE)
      .order('id')
      .range(from, from + 999);
    if (result.error) throw new Error(result.error.message);
    for (const row of result.data ?? []) {
      const metadata = recordMetadata(row.metadata);
      const marked = isTestOfferAuditMarker({
        action: row.action,
        targetType: row.target_type,
        isTest: metadata.is_test,
      });
      if (!marked || typeof metadata.restaurant_id !== 'string' || !row.target_id) continue;
      if (seenTestVersions.has(row.target_id)) continue;
      const market = restaurantMarket.get(metadata.restaurant_id);
      if (!market) continue;
      seenTestVersions.add(row.target_id);
      testOffers.push({
        version_id: row.target_id,
        restaurant_id: metadata.restaurant_id,
        market_slug: market,
      });
    }
    if ((result.data ?? []).length < 1000) break;
  }
  return {
    markets: markets.map((market) => ({
      id: market.id,
      slug: market.slug,
      name: market.name,
      state: market.state,
      timezone: market.timezone,
      status: market.status,
    })),
    restaurants,
    test_offers: testOffers,
  };
}

function rpcObject(value: Json): { [key: string]: Json | undefined } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as { [key: string]: Json | undefined };
}

function executor(supabase: SupabaseClient<Database>): CatalogExecutor {
  return {
    loadSnapshot: () => loadSnapshot(supabase),
    async assertAdmin(actorId) {
      const result = await supabase.from('user_profiles').select('role').eq('id', actorId).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      return result.data?.role === 'admin';
    },
    async insertMarket(market) {
      const result = await supabase
        .from('markets')
        .insert({
          name: market.name,
          slug: market.slug,
          state: market.state,
          timezone: market.timezone,
          country: market.country,
          currency: market.currency,
          status: market.status,
        })
        .select('id')
        .single();
      if (result.error || !result.data) throw new Error(result.error?.message ?? 'market insert failed');
      return { id: result.data.id };
    },
    async insertOrg(org) {
      const result = await supabase.from('restaurant_orgs').insert(org).select('id').single();
      if (result.error || !result.data) throw new Error(result.error?.message ?? 'org insert failed');
      return { id: result.data.id };
    },
    async insertRestaurant(row) {
      const result = await supabase
        .from('restaurants')
        .insert({
          org_id: row.org_id,
          market_id: row.market_id,
          name: row.name,
          slug: row.slug,
          address: row.address,
          lat: row.lat,
          lon: row.lon,
          google_place_id: row.google_place_id,
          cuisine_tags: row.cuisine_tags,
          is_vegan: row.is_vegan,
          is_dairy_free: row.is_dairy_free,
          is_halal: row.is_halal,
          price_range: row.price_range,
          neighborhood: row.neighborhood,
          status: row.status,
        })
        .select('id')
        .single();
      if (result.error || !result.data) throw new Error(result.error?.message ?? 'restaurant insert failed');
      return { id: result.data.id };
    },
    async updateRestaurant(id, patch: CatalogRestaurantPatch) {
      const result = await supabase.from('restaurants').update(patch).eq('id', id);
      if (result.error) throw new Error(result.error.message);
    },
    async upsertDraft(draft) {
      const result = await supabase
        .from('offer_drafts')
        .upsert(
          {
            restaurant_id: draft.restaurant_id,
            timezone: draft.terms.timezone,
            valid_from: draft.terms.valid_from,
            valid_until: draft.terms.valid_until,
            tiers: draft.terms.tiers as Json,
            boosts: draft.terms.boosts as Json,
            exclusions: draft.exclusions as Json,
            capacity_timezone: draft.terms.capacity_timezone,
            capacity_window_kind: draft.terms.capacity_window_kind,
            capacity_max_redemptions: draft.terms.capacity_max_redemptions,
            boost_session_minutes: null,
          },
          { onConflict: 'restaurant_id' },
        )
        .select('id')
        .single();
      if (result.error || !result.data) throw new Error(result.error?.message ?? 'offer draft upsert failed');
      return { id: result.data.id };
    },
    async publishOfferVersion(draftId, actorId) {
      const result = await supabase.rpc('publish_offer_version', {
        p_draft_id: draftId,
        p_actor_user_id: actorId,
      });
      if (result.error) return { published: false, error: result.error.message };
      const body = rpcObject(result.data);
      if (body.published !== true || typeof body.version_id !== 'string') {
        return { published: false, error: typeof body.error === 'string' ? body.error : 'publish_offer_version failed' };
      }
      return { published: true, versionId: body.version_id };
    },
    async insertTestMark(versionId, actorId, metadata) {
      const inserted = await supabase.from('admin_audit_log').insert({
        actor_user_id: actorId,
        action: 'offer.test_mark',
        target_type: 'offer_version',
        target_id: versionId,
        metadata,
      });
      if (inserted.error) throw new Error(inserted.error.message);
    },
    async retireRestaurant(restaurantId, actorId) {
      const result = await supabase.rpc('retire_restaurant', {
        p_restaurant_id: restaurantId,
        p_actor_user_id: actorId,
      });
      if (result.error) return { ok: false, error: result.error.message };
      const body = rpcObject(result.data);
      if (body.ok !== true) return { ok: false, error: typeof body.error === 'string' ? body.error : 'retire failed' };
      return { ok: true, result: typeof body.result === 'string' ? body.result : undefined };
    },
    async pauseRestaurant(restaurantId, actorId, metadata) {
      const updated = await supabase.from('restaurants').update({ status: 'paused' }).eq('id', restaurantId);
      if (updated.error) throw new Error(updated.error.message);
      const audit = await supabase.from('admin_audit_log').insert({
        actor_user_id: actorId,
        action: 'restaurant.deactivate',
        target_type: 'restaurant',
        target_id: restaurantId,
        metadata: { ...metadata, source: 'catalog-import', result: 'paused' },
      });
      if (audit.error) throw new Error(audit.error.message);
    },
    async withdrawOfferVersion(versionId, actorId) {
      const result = await supabase.rpc('withdraw_offer_version', {
        p_version_id: versionId,
        p_actor_user_id: actorId,
      });
      if (result.error) return { withdrawn: false, error: result.error.message };
      const body = rpcObject(result.data);
      if (body.withdrawn !== true) {
        return {
          withdrawn: false,
          error: typeof body.error === 'string' ? body.error : 'withdraw_offer_version failed',
        };
      }
      return { withdrawn: true };
    },
  };
}

function cachingGeocoder(apiKey: string): {
  geocode: (request: GeocodeRequest) => Promise<GeocodeResult>;
  save: () => void;
} {
  let cache = readCache();
  return {
    async geocode(request) {
      const resolved = await geocodeWithCache(request, cache, (next) =>
        fetchGooglePlaceCoordinates(next, apiKey),
      );
      cache = resolved.cache;
      return resolved.result;
    },
    save() {
      writeConfined(GEOCODE_CACHE, `${JSON.stringify(cache)}\n`);
    },
  };
}

function readPlan(candidate: string): CatalogPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readConfined(candidate)) as unknown;
  } catch {
    fail('catalog import plan rejected');
  }
  if (!parsed || typeof parsed !== 'object') fail('catalog import plan rejected');
  const plan = parsed as CatalogPlan;
  if (plan.schema !== CATALOG_IMPORT_PLAN_SCHEMA || !Array.isArray(plan.actions) || !Array.isArray(plan.markets)) {
    fail('catalog import plan rejected');
  }
  if (typeof plan.snapshot_hash !== 'string' || typeof plan.accepted !== 'boolean') {
    fail('catalog import plan rejected');
  }
  return plan;
}

function formatOf(file: string, explicit: 'csv' | 'json' | null): 'csv' | 'json' {
  if (explicit) return explicit;
  return file.toLowerCase().endsWith('.csv') ? 'csv' : 'json';
}

export async function runCatalogImportCli(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseCatalogImportArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'catalog import rejected'}\n`);
    return 2;
  }
  if (args.mode === 'apply' && args.fromDbMarket) {
    process.stderr.write('catalog import --apply cannot be combined with --from-db\n');
    return 2;
  }
  const supabase = client();
  if (args.mode === 'from-db') {
    if (!args.fromDbMarket) return 2;
    const snapshot = await loadSnapshot(supabase);
    const exported = importRowsFromSnapshot(snapshot, args.fromDbMarket);
    const output = `.supply-gate/catalog-import-from-${args.fromDbMarket}.json`;
    writeConfined(output, `${JSON.stringify(exported.rows, null, 2)}\n`);
    for (const warning of exported.warnings) process.stderr.write(`warning: ${warning}\n`);
    process.stdout.write(`catalog import exported ${exported.rows.length} rows to ${output}\n`);
    return exported.warnings.some((warning) => warning.includes('does not exist')) ? 2 : 0;
  }
  if (args.mode === 'apply') {
    if (!args.planFile) {
      process.stderr.write('catalog import --apply needs --plan-file\n');
      return 2;
    }
    if (!args.actor) {
      process.stderr.write('catalog import --apply needs --actor\n');
      return 2;
    }
    const plan = readPlan(args.planFile);
    const result = await applyCatalogPlan({
      plan,
      confirm: args.confirm,
      actorId: args.actor,
      applyEnv: process.env.WANDERBITE_CATALOG_APPLY,
      exec: executor(supabase),
    });
    process.stdout.write(`catalog import applied ${result.applied} actions\n`);
    return 0;
  }
  if (!args.file && !args.testOffers && !args.withdrawTestOffers) {
    process.stderr.write('catalog import --plan needs --file, --test-offers, or --withdraw-test-offers\n');
    return 2;
  }
  const document = args.file
    ? parseCatalogImportDocument(readFileSync(args.file, 'utf8'), formatOf(args.file, args.format))
    : { ok: true as const, document: { rows: [], errors: [] } };
  if (!document.ok) {
    process.stderr.write(`${document.message}\n`);
    return 2;
  }
  const outboundDisabled = process.env.WANDERBITE_GOOGLE_PLACES_OUTBOUND_DISABLED === 'true';
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim() ?? '';
  const geocoder = !outboundDisabled && apiKey ? cachingGeocoder(apiKey) : null;
  const snapshot = await loadSnapshot(supabase);
  const plan = await buildCatalogPlan({
    document: document.document,
    snapshot,
    options: {
      skipInvalid: args.skipInvalid,
      refreshCoordinates: args.refreshCoordinates,
      testOffers: args.testOffers,
      testOffersAllInMarket: args.testOffersAllInMarket,
      publishRealOffers: args.publishRealOffers,
      testOfferCapacity: args.testOfferCapacity,
      resolveDuplicates: args.resolveDuplicates,
      withdrawTestOffers: args.withdrawTestOffers,
      markets: args.markets,
      now: new Date(),
      sourceLabel: args.file ? path.basename(args.file) : 'database',
      outboundDisabled,
      apiKeyPresent: Boolean(apiKey),
    },
    geocoder: geocoder?.geocode ?? null,
  });
  if (geocoder) geocoder.save();
  writeConfined(args.planOutput, `${JSON.stringify(plan, null, 2)}\n`);
  process.stdout.write(formatCatalogImportSummary(plan));
  process.stdout.write(`plan: ${args.planOutput}\n`);
  return plan.accepted ? 0 : 2;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  runCatalogImportCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'catalog import failed'}\n`);
      process.exitCode = 2;
    });
}
