import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contentHash } from '@/lib/content-pipeline/hash';
import type { ContentSourceRecord, RefreshEffects } from '@/lib/content-pipeline/refresh';
import { runApplyContentRefresh } from '@/lib/content-pipeline/scheduled-refresh';
import type { DescriptionFact } from '@/lib/content-pipeline/facts';
import type { RecipeSnapshot } from '@/lib/content-pipeline/change-detect';
import { GET } from './route';

const FIXTURES = path.join(process.cwd(), 'src/lib/content-pipeline/__fixtures__');
const BASELINE = readFileSync(path.join(FIXTURES, 'menu-baseline.html'), 'utf8');
const CHANGED = readFileSync(path.join(FIXTURES, 'menu-changed.html'), 'utf8');
const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const RECIPE_ID = '22222222-2222-4222-8222-222222222222';
const MENU_URL = 'https://hutchinsbbq.com/mckinney-menu/';
const SECRET = 'cron-secret';

type Row = Record<string, unknown>;
type Filter = { op: 'eq' | 'in'; column: string; value: unknown };

const harness = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  calls: [] as { table: string; op: string }[],
  held: false,
  runId: 7,
  items: [] as { key: string; status: string }[],
  blockSources: false,
  releaseSources: () => {},
  budgetDenied: false,
  fetchUrls: [] as string[],
}));

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    if (filter.op === 'eq') return row[filter.column] === filter.value;
    return Array.isArray(filter.value) && filter.value.includes(row[filter.column]);
  });
}

function resetDb() {
  harness.tables = {
    content_sources: [],
    source_facts: [],
    recipes: [],
    content_exceptions: [],
    source_fetch_attempts: [],
  };
  harness.calls = [];
  harness.held = false;
  harness.items = [];
  harness.blockSources = false;
  harness.budgetDenied = false;
  harness.fetchUrls = [];
}

function seedSource(hash: string | null) {
  harness.tables.content_sources = [{
    id: SOURCE_ID,
    kind: 'public_menu',
    url: MENU_URL,
    status: 'active',
    restaurant_id: null,
    last_attempted_at: null,
    last_verified_at: null,
    last_content_hash: hash,
  }];
  harness.tables.recipes = [{
    id: RECIPE_ID,
    title: 'Home Skillet Beans',
    description: 'A home pot of beans warmed with paprika and garlic.',
    version: 1,
    visibility: 'draft',
    recipe_type: 'inspired_by',
    source_kind: 'public_menu',
    source_url: MENU_URL,
  }];
  harness.tables.source_facts = [{
    id: '33333333-3333-4333-8333-333333333333',
    source_id: SOURCE_ID,
    subject_id: RECIPE_ID,
    field: 'description',
    version: 1,
    status: 'current',
    value: {
      dish: 'Skillet Beans',
      text: 'A home pot of beans warmed with paprika and garlic.',
      menu_description: 'White beans simmered with smoked paprika, garlic, and olive oil until the sauce turns glossy.',
      ingredients: ['white beans', 'smoked paprika', 'garlic', 'olive oil'],
      price: null,
    },
    evidence_excerpt: 'beans',
  }];
}

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const filters: Filter[] = [];
      let op: 'select' | 'insert' | 'update' = 'select';
      let payload: Row | null = null;
      const execute = () => {
        harness.calls.push({ table, op });
        const rows = harness.tables[table] ?? [];
        const matched = rows.filter((row) => matches(row, filters));
        if (op === 'insert' && payload) {
          rows.push({ ...payload });
          harness.tables[table] = rows;
          return { data: [{ ...payload }], error: null };
        }
        if (op === 'update' && payload) {
          for (const row of matched) Object.assign(row, payload);
          return { data: matched.map((row) => ({ ...row })), error: null };
        }
        return { data: matched.map((row) => ({ ...row })), error: null };
      };
      const api = {
        select() {
          if (op !== 'select') return Promise.resolve(execute());
          return api;
        },
        insert(values: Row) {
          op = 'insert';
          payload = values;
          return api;
        },
        update(values: Row) {
          op = 'update';
          payload = values;
          return api;
        },
        eq(column: string, value: unknown) {
          filters.push({ op: 'eq', column, value });
          return api;
        },
        in(column: string, value: unknown) {
          filters.push({ op: 'in', column, value });
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        maybeSingle() {
          const result = execute();
          return Promise.resolve({ data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: null });
        },
        single() {
          return api.maybeSingle();
        },
        then(onFulfilled: (value: { data: unknown; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
          const pending = harness.blockSources && table === 'content_sources' && op === 'select' && filters.length > 0
            ? new Promise<void>((resolve) => {
                harness.releaseSources = resolve;
              }).then(() => execute())
            : Promise.resolve(execute());
          if (harness.blockSources && table === 'content_sources' && op === 'select' && filters.length > 0) {
            harness.blockSources = false;
          }
          return pending.then(onFulfilled, onRejected);
        },
      };
      return api;
    },
    rpc(fn: string, args: Record<string, unknown>) {
      harness.calls.push({ table: fn, op: 'rpc' });
      if (fn === 'acquire_cron_lease') {
        if (harness.held) {
          return Promise.resolve({
            data: { acquired: false, reason: 'lease-held', run_id: harness.runId, run_key: args.p_run_key },
            error: null,
          });
        }
        harness.held = true;
        return Promise.resolve({
          data: { acquired: true, reason: 'acquired', run_id: harness.runId, run_key: args.p_run_key, checkpoint: null },
          error: null,
        });
      }
      if (fn === 'renew_cron_lease' || fn === 'record_cron_run_item') {
        if (fn === 'record_cron_run_item') {
          harness.items.push({ key: String(args.p_item_key), status: String(args.p_status) });
        }
        return Promise.resolve({ data: true, error: null });
      }
      if (fn === 'cron_run_item_counts') {
        return Promise.resolve({
          data: { pending: 0, failed: harness.items.filter((item) => item.status === 'failed').length, succeeded: 1, skipped: 0 },
          error: null,
        });
      }
      if (fn === 'finalize_cron_lease') {
        harness.held = false;
        return Promise.resolve({ data: { finalized: true, result: args.p_result ?? null }, error: null });
      }
      if (fn === 'release_cron_lease') {
        harness.held = false;
        return Promise.resolve({ data: true, error: null });
      }
      if (fn === 'ai_current_versions') {
        return Promise.resolve({
          data: [{ config_version_id: 'cfg', price_version_id: 'price' }],
          error: null,
        });
      }
      if (fn === 'ai_reserve') {
        return Promise.resolve({
          data: [{ acquired: !harness.budgetDenied, deny_reason: harness.budgetDenied ? 'budget' : '', request_id: 'req' }],
          error: null,
        });
      }
      if (fn === 'apply_recipe_description_fact') {
        const recipe = harness.tables.recipes?.find((row) => row.id === args.p_recipe_id);
        if (recipe) {
          recipe.description = (args.p_value as { text: string }).text;
          recipe.version = Number(recipe.version) + 1;
        }
        return Promise.resolve({ data: 'fact-new', error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected ${fn}` } });
    },
  }),
}));

function authorize(): Request {
  return new Request('http://localhost/api/cron/content-refresh', {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

function fetchHtml(html: string): typeof fetch {
  return async (input) => {
    const url = String(input);
    harness.fetchUrls.push(url);
    if (url.endsWith('/robots.txt')) {
      return new Response('User-agent: *\nAllow: /\n', { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
}

beforeEach(() => {
  resetDb();
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('E05_CONTENT_REFRESH_CRON_ENABLED', '');
  vi.stubGlobal('fetch', fetchHtml(BASELINE));
});

describe('content refresh cron', () => {
  it('stays disabled and writes no attempts when the flag is unset', async () => {
    seedSource(contentHash(BASELINE));
    const response = await GET(authorize());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'disabled', skipped: true });
    expect(harness.calls.some((call) => call.table === 'acquire_cron_lease')).toBe(false);
    expect(harness.tables.source_fetch_attempts).toHaveLength(0);

    const missing = await GET(new Request('http://localhost/api/cron/content-refresh'));
    expect(missing.status).toBe(401);
  });

  it('returns lease-held for an overlapping run and does no second refresh', async () => {
    vi.stubEnv('E05_CONTENT_REFRESH_CRON_ENABLED', 'true');
    harness.blockSources = true;
    const first = GET(authorize());
    await vi.waitFor(() => {
      expect(harness.held).toBe(true);
    });
    const second = await GET(authorize());
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ status: 'lease-held' });
    expect(harness.tables.source_fetch_attempts).toHaveLength(0);
    harness.releaseSources();
    const finished = await first;
    expect(finished.status).toBe(200);
    expect(harness.calls.filter((call) => call.table === 'source_fetch_attempts')).toHaveLength(0);
  });

  it('records an unchanged page without a model call', async () => {
    vi.stubEnv('E05_CONTENT_REFRESH_CRON_ENABLED', 'true');
    seedSource(contentHash(BASELINE));
    const response = await GET(authorize());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: 'success', result: { modelCalls: 0 } });
    expect(harness.tables.source_fetch_attempts?.[0]).toMatchObject({ outcome: 'unchanged' });
    expect(harness.tables.content_sources?.[0]?.last_attempted_at).toEqual(expect.any(String));
    expect(harness.tables.content_sources?.[0]?.last_verified_at).toEqual(expect.any(String));
    expect(harness.fetchUrls.some((url) => url.includes('anthropic'))).toBe(false);
    expect(harness.items).toEqual([{ key: SOURCE_ID, status: 'succeeded' }]);
    expect(harness.tables.recipes?.[0]?.description).toBe('A home pot of beans warmed with paprika and garlic.');
  });

  it('advances last_attempted_at and not last_verified_at when the fetch fails', async () => {
    const source: ContentSourceRecord = {
      id: SOURCE_ID,
      kind: 'public_menu',
      url: MENU_URL,
      status: 'active',
      lastAttemptedAt: null,
      lastVerifiedAt: null,
      lastContentHash: null,
    };
    const attempts: { outcome: string }[] = [];
    const effects: RefreshEffects = {
      recordAttempt: async (row) => {
        attempts.push({ outcome: row.outcome });
      },
      updateSource: async (_id, patch) => {
        source.lastAttemptedAt = patch.lastAttemptedAt;
        if (patch.lastVerifiedAt) source.lastVerifiedAt = patch.lastVerifiedAt;
      },
      applyDescriptionFact: async () => {
        throw new Error('published content changed');
      },
      openException: async () => undefined,
    };
    await runApplyContentRefresh({
      sources: [source],
      load: async () => ({ facts: [], recipes: [], openExceptions: [] }),
      effects,
      sleep: async () => undefined,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith('/robots.txt')) {
          return new Response('User-agent: *\nAllow: /\n', { status: 200, headers: { 'content-type': 'text/plain' } });
        }
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      },
    });
    expect(attempts.every((row) => row.outcome === 'timeout')).toBe(true);
    expect(attempts.length).toBeGreaterThan(0);
    expect(source.lastAttemptedAt).toEqual(expect.any(String));
    expect(source.lastVerifiedAt).toBeNull();
  });

  it('records the attempt and skips the model when the maintenance budget is exhausted', async () => {
    const source: ContentSourceRecord = {
      id: SOURCE_ID,
      kind: 'public_menu',
      url: MENU_URL,
      status: 'active',
      lastAttemptedAt: null,
      lastVerifiedAt: null,
      lastContentHash: contentHash(BASELINE),
    };
    const recipe: RecipeSnapshot = {
      id: RECIPE_ID,
      title: 'Home Skillet Beans',
      description: 'A home pot of beans warmed with paprika and garlic.',
      version: 1,
      visibility: 'draft',
      recipeType: 'inspired_by',
      sourceKind: 'public_menu',
      sourceUrl: MENU_URL,
    };
    const fact: DescriptionFact = {
      id: '33333333-3333-4333-8333-333333333333',
      sourceId: SOURCE_ID,
      subjectId: RECIPE_ID,
      version: 1,
      status: 'current',
      dish: 'Skillet Beans',
      text: recipe.description ?? '',
      menuDescription: 'White beans simmered with smoked paprika, garlic, and olive oil until the sauce turns glossy.',
      ingredients: ['white beans', 'smoked paprika', 'garlic', 'olive oil'],
      price: null,
      evidenceExcerpt: 'beans',
    };
    const attempts: Row[] = [];
    let modelCalls = 0;
    const effects: RefreshEffects = {
      recordAttempt: async (row) => {
        attempts.push({ ...row });
      },
      updateSource: async (_id, patch) => {
        source.lastAttemptedAt = patch.lastAttemptedAt;
        if (patch.lastVerifiedAt) source.lastVerifiedAt = patch.lastVerifiedAt;
      },
      applyDescriptionFact: async () => {
        throw new Error('published content changed');
      },
      openException: async () => undefined,
    };
    const summary = await runApplyContentRefresh({
      sources: [source],
      load: async () => ({ facts: [fact], recipes: [recipe], openExceptions: [] }),
      effects,
      fetchImpl: fetchHtml(CHANGED),
      sleep: async () => undefined,
      callModel: async () => {
        modelCalls += 1;
        return { text: '{}', usage: null };
      },
      reserveModel: async () => ({ ok: false, reason: 'budget' }),
    });
    expect(modelCalls).toBe(0);
    expect(summary.results[0]?.attempts.at(-1)).toMatchObject({ outcome: 'parse_error', errorCode: 'model_unavailable' });
    expect(attempts.length).toBeGreaterThan(0);
    expect(source.lastAttemptedAt).toEqual(expect.any(String));
    expect(source.lastVerifiedAt).toBeNull();
    expect(recipe.description).toBe('A home pot of beans warmed with paprika and garlic.');
    expect(recipe.visibility).toBe('draft');
  });
});
