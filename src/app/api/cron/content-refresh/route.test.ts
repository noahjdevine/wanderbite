import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contentHash } from '@/lib/content-pipeline/hash';
import type { ContentSourceRecord, RefreshEffects } from '@/lib/content-pipeline/refresh';
import { runApplyContentRefresh } from '@/lib/content-pipeline/scheduled-refresh';
import type { DescriptionFact } from '@/lib/content-pipeline/facts';
import type { RecipeSnapshot } from '@/lib/content-pipeline/change-detect';
import { chicagoCalendarDate, shiftCalendarDate } from '@/lib/activities/match';
import { GET, runContentRefresh } from './route';

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
  calls: [] as { table: string; op: string; filters: Filter[] }[],
  held: false,
  runId: 7,
  items: [] as { key: string; status: string; error: string | null }[],
  blockSources: false,
  releaseSources: () => {},
  budgetDenied: false,
  fetchUrls: [] as string[],
  pages: {} as Record<string, string>,
  missingActivities: false,
  activitiesError: { code: '42P01', message: 'relation "public.activities" does not exist' },
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
    activities: [],
  };
  harness.calls = [];
  harness.held = false;
  harness.items = [];
  harness.blockSources = false;
  harness.budgetDenied = false;
  harness.fetchUrls = [];
  harness.pages = {};
  harness.missingActivities = false;
  harness.activitiesError = { code: '42P01', message: 'relation "public.activities" does not exist' };
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
        harness.calls.push({ table, op, filters: filters.map((filter) => ({ ...filter })) });
        if (harness.missingActivities && table === 'activities') {
          return { data: null, error: harness.activitiesError };
        }
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
        then(onFulfilled: (value: { data: unknown; error: unknown }) => unknown, onRejected?: (reason: unknown) => unknown) {
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
      harness.calls.push({ table: fn, op: 'rpc', filters: [] });
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
          harness.items.push({
            key: String(args.p_item_key),
            status: String(args.p_status),
            error: typeof args.p_error === 'string' ? args.p_error : null,
          });
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
      if (fn === 'ai_dispatch') {
        return Promise.resolve({ data: [{ acquired: true }], error: null });
      }
      if (fn === 'ai_settle' || fn === 'ai_mark_assumed_spent') {
        return Promise.resolve({ data: true, error: null });
      }
      if (fn === 'expire_dated_activities') {
        const today = String(args.p_today);
        let count = 0;
        for (const row of harness.tables.activities ?? []) {
          if (row.status === 'active' && typeof row.valid_until === 'string' && row.valid_until < today) {
            row.status = 'expired';
            count += 1;
          }
        }
        return Promise.resolve({ data: count, error: null });
      }
      if (fn === 'apply_activity_field_fact') {
        const fact = {
          id: 'fact-activity',
          source_id: args.p_source_id,
          subject_type: 'activity',
          subject_id: args.p_activity_id,
          field: args.p_field,
          value: args.p_value,
          status: 'pending_review',
        };
        harness.tables.source_facts = [...(harness.tables.source_facts ?? []), fact];
        return Promise.resolve({ data: fact.id, error: null });
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
    if (url === 'https://api.anthropic.com/v1/messages') {
      return new Response(harness.pages[url] ?? '{"content":[]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(harness.pages[url] ?? html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };
}

beforeEach(() => {
  resetDb();
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('E05_CONTENT_REFRESH_CRON_ENABLED', '');
  vi.stubEnv('E06_ACTIVITY_MAINTENANCE_CRON_ENABLED', '');
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
    expect(body).toEqual({
      status: 'success',
      runId: 7,
      result: { sources: 1, skips: 0, modelCalls: 0 },
      error: null,
    });
    expect(harness.tables.source_fetch_attempts?.[0]).toMatchObject({ outcome: 'unchanged' });
    expect(harness.tables.content_sources?.[0]?.last_attempted_at).toEqual(expect.any(String));
    expect(harness.tables.content_sources?.[0]?.last_verified_at).toEqual(expect.any(String));
    expect(harness.fetchUrls.some((url) => url.includes('anthropic'))).toBe(false);
    expect(harness.items).toEqual([{ key: SOURCE_ID, status: 'succeeded', error: null }]);
    expect(harness.tables.recipes?.[0]?.description).toBe('A home pot of beans warmed with paprika and garlic.');
    expect(touchedActivities()).toBe(false);
    expect(pageUrls()).toEqual([MENU_URL]);
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

  it('keeps the main response when activity maintenance is unset, even if activity rows exist', async () => {
    vi.stubEnv('E05_CONTENT_REFRESH_CRON_ENABLED', 'true');
    vi.stubEnv('E06_ACTIVITY_MAINTENANCE_CRON_ENABLED', 'TRUE');
    seedSource(contentHash(BASELINE));
    seedActivityCatalog(new Date('2026-11-05T06:30:00.000Z'));
    const before = structuredClone(harness.tables.activities);
    const response = await GET(authorize());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'success',
      runId: 7,
      result: { sources: 1, skips: 0, modelCalls: 0 },
      error: null,
    });
    expect(touchedActivities()).toBe(false);
    expect(queriedActivitySources()).toBe(false);
    expect(pageUrls()).toEqual([MENU_URL]);
    expect(harness.tables.activities).toEqual(before);
    expect(forbiddenWrites()).toEqual([]);
  });

  it('still refuses an unauthenticated call when activity maintenance is on', async () => {
    vi.stubEnv('E05_CONTENT_REFRESH_CRON_ENABLED', 'true');
    vi.stubEnv('E06_ACTIVITY_MAINTENANCE_CRON_ENABLED', 'true');
    const missing = await GET(new Request('http://localhost/api/cron/content-refresh'));
    expect(missing.status).toBe(401);
    expect(harness.calls).toHaveLength(0);
  });

  it('stays disabled when the content-refresh flag is unset, even if activity maintenance is true', async () => {
    vi.stubEnv('E06_ACTIVITY_MAINTENANCE_CRON_ENABLED', 'true');
    seedActivityCatalog(new Date('2026-11-05T06:30:00.000Z'));
    const response = await GET(authorize());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'disabled', skipped: true });
    expect(touchedActivities()).toBe(false);
    expect(harness.tables.source_fetch_attempts).toHaveLength(0);
  });

  it('expires yesterday at 00:30 Chicago and leaves today and undated activities active', async () => {
    vi.stubEnv('E05_CONTENT_REFRESH_CRON_ENABLED', 'true');
    vi.stubEnv('E06_ACTIVITY_MAINTENANCE_CRON_ENABLED', 'true');
    const today = chicagoCalendarDate(new Date());
    const at = chicagoHalfPastMidnight(today);
    seedSource(contentHash(BASELINE));
    seedActivities(at);
    const response = await runContentRefresh(authorize(), at);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.expiredActivities).toBe(1);
    expect(activityByName('Yesterday').status).toBe('expired');
    expect(activityByName('Today').status).toBe('active');
    expect(activityByName('Undated').status).toBe('active');
    expect(activityByName('Paused').status).toBe('paused');
    expect(harness.tables.activities).toHaveLength(4);
    expect(forbiddenWrites()).toEqual([]);
  });

  it('fetches an event verified 25 hours ago and a venue verified 8 days ago, not a venue verified 3 days ago', async () => {
    vi.stubEnv('E05_CONTENT_REFRESH_CRON_ENABLED', 'true');
    vi.stubEnv('E06_ACTIVITY_MAINTENANCE_CRON_ENABLED', 'true');
    const today = chicagoCalendarDate(new Date());
    const at = chicagoHalfPastMidnight(today);
    seedSource(contentHash(BASELINE));
    seedActivityCatalog(at);
    const response = await runContentRefresh(authorize(), at);
    expect(response.status).toBe(200);
    const pages = pageUrls();
    expect(pages[0]).toBe(MENU_URL);
    expect(pages).toContain(VENUE_OLD_URL);
    expect(pages).toContain(EVENT_URL);
    expect(pages).not.toContain(VENUE_RECENT_URL);
    expect(pages).toHaveLength(3);
    const recent = harness.tables.content_sources?.find((row) => row.url === VENUE_RECENT_URL);
    expect(recent?.last_attempted_at).toBeNull();
    expect(recent?.last_verified_at).toEqual(expect.any(String));
  }, 15000);

  it('opens a content exception when venue hours change and leaves the activity row unchanged', async () => {
    vi.stubEnv('E05_CONTENT_REFRESH_CRON_ENABLED', 'true');
    vi.stubEnv('E06_ACTIVITY_MAINTENANCE_CRON_ENABLED', 'true');
    const today = chicagoCalendarDate(new Date());
    const at = chicagoHalfPastMidnight(today);
    seedSource(contentHash(BASELINE));
    const activity = {
      id: ACTIVITY_ID,
      name: 'Sample Square Walk',
      status: 'active',
      valid_until: null,
      source_url: VENUE_OLD_URL,
      content_source_id: VENUE_OLD_ID,
      hours_note: 'Afternoons on the sample listing',
      booking_required: false,
      version: 1,
    };
    harness.tables.activities = [activity];
    harness.tables.content_sources = [
      ...(harness.tables.content_sources ?? []),
      {
        id: VENUE_OLD_ID,
        kind: 'venue_page',
        url: VENUE_OLD_URL,
        status: 'active',
        restaurant_id: null,
        last_attempted_at: null,
        last_verified_at: null,
        last_content_hash: null,
      },
    ];
    harness.pages[VENUE_OLD_URL] = '<html><body><p>The sample square is open from 9 a.m. to 5 p.m.</p></body></html>';
    const before = structuredClone(activity);
    const response = await runContentRefresh(authorize(), at);
    expect(response.status).toBe(200);
    expect(harness.tables.activities?.[0]).toEqual(before);
    const opened = harness.tables.content_exceptions?.find((row) => row.field === 'hours_note');
    expect(opened).toMatchObject({
      source_id: VENUE_OLD_ID,
      subject_type: 'activity',
      subject_id: ACTIVITY_ID,
      reason: 'conflict',
      status: 'open',
    });
    expect(harness.calls.some((call) => call.table === 'activities' && call.op === 'insert')).toBe(false);
    expect(harness.calls.some((call) => call.table === 'activities' && call.op === 'update')).toBe(false);
    expect(forbiddenWrites()).toEqual([]);
  });

  it('stores a pending summary draft and does not change the activity row', async () => {
    vi.stubEnv('E05_CONTENT_REFRESH_CRON_ENABLED', 'true');
    vi.stubEnv('E06_ACTIVITY_MAINTENANCE_CRON_ENABLED', 'true');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const today = chicagoCalendarDate(new Date());
    const at = chicagoHalfPastMidnight(today);
    seedSource(contentHash(BASELINE));
    const activity = {
      id: ACTIVITY_ID,
      name: 'Sample Square Walk',
      status: 'active',
      valid_until: null,
      source_url: EVENT_URL,
      content_source_id: EVENT_ID,
      hours_note: 'Afternoons on the sample listing',
      booking_required: false,
      version: 1,
    };
    harness.tables.activities = [activity];
    harness.tables.content_sources = [
      ...(harness.tables.content_sources ?? []),
      {
        id: EVENT_ID,
        kind: 'event_page',
        url: EVENT_URL,
        status: 'active',
        restaurant_id: null,
        last_attempted_at: null,
        last_verified_at: null,
        last_content_hash: null,
      },
    ];
    harness.pages[EVENT_URL] = '<html><body><p>A fountain sits on the sample square near the restaurant.</p></body></html>';
    harness.pages['https://api.anthropic.com/v1/messages'] = JSON.stringify({
      content: [{ type: 'text', text: '{"summary":"A fountain sits on the sample square near the restaurant."}' }],
      usage: { input_tokens: 40, output_tokens: 20 },
    });
    const before = structuredClone(activity);
    const response = await runContentRefresh(authorize(), at);
    expect(response.status).toBe(200);
    expect(harness.tables.activities?.[0]).toEqual(before);
    expect(harness.tables.source_facts?.some((row) => row.status === 'pending_review' && row.subject_type === 'activity')).toBe(true);
    expect(harness.calls.some((call) => call.table === 'activities' && call.op === 'insert')).toBe(false);
    expect((await response.json()).result.modelCalls).toBe(1);
  });

  it('skips activity maintenance when the activities table is missing and still refreshes the menu', async () => {
    vi.stubEnv('E05_CONTENT_REFRESH_CRON_ENABLED', 'true');
    vi.stubEnv('E06_ACTIVITY_MAINTENANCE_CRON_ENABLED', 'true');
    seedSource(contentHash(BASELINE));
    harness.missingActivities = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await GET(authorize());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toMatchObject({ sources: 1, expiredActivities: 0, modelCalls: 0 });
    expect(harness.tables.source_fetch_attempts?.[0]).toMatchObject({ outcome: 'unchanged' });
    expect(harness.calls.filter((call) => call.table === 'activities')).toHaveLength(1);
    expect(queriedActivitySources()).toBe(false);
    expect(pageUrls()).toEqual([MENU_URL]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe('[content-refresh] activity maintenance skipped: activities schema unavailable');
    expect(harness.items.some((item) => item.key === 'skip:activity-maintenance' && item.status === 'skipped')).toBe(true);
    warn.mockRestore();
  });
});

const ACTIVITY_ID = '12121212-1212-4121-8121-121212121212';
const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VENUE_RECENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VENUE_OLD_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EVENT_URL = 'https://example.com/sample-dated-fair';
const VENUE_RECENT_URL = 'https://example.com/sample-recent-venue';
const VENUE_OLD_URL = 'https://example.com/sample-old-venue';

function chicagoHalfPastMidnight(day: string): Date {
  for (const offsetHours of [6, 5]) {
    const utc = new Date(Date.parse(`${day}T00:00:00.000Z`) + offsetHours * 60 * 60 * 1000 + 30 * 60 * 1000);
    if (chicagoCalendarDate(utc) !== day) continue;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(utc);
    const hour = parts.find((part) => part.type === 'hour')?.value;
    const minute = parts.find((part) => part.type === 'minute')?.value;
    if (hour === '00' && minute === '30') return utc;
  }
  throw new Error(`no 00:30 America/Chicago instant for ${day}`);
}

function seedActivities(now: Date) {
  const today = chicagoCalendarDate(now);
  const yesterday = shiftCalendarDate(today, -1);
  harness.tables.activities = [
    { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Yesterday', status: 'active', valid_until: yesterday },
    { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Today', status: 'active', valid_until: today },
    { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'Undated', status: 'active', valid_until: null },
    { id: '99999999-9999-4999-8999-999999999999', name: 'Paused', status: 'paused', valid_until: yesterday },
  ];
}

function seedActivityCatalog(now: Date) {
  seedActivities(now);
  const eventVerified = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
  const venueRecent = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const venueOld = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
  harness.tables.content_sources = [
    ...(harness.tables.content_sources ?? []),
    sourceRow(EVENT_ID, 'event_page', EVENT_URL, eventVerified),
    sourceRow(VENUE_RECENT_ID, 'venue_page', VENUE_RECENT_URL, venueRecent),
    sourceRow(VENUE_OLD_ID, 'venue_page', VENUE_OLD_URL, venueOld),
  ];
}

function sourceRow(id: string, kind: string, url: string, lastVerifiedAt: string | null): Row {
  return {
    id,
    kind,
    url,
    status: 'active',
    restaurant_id: null,
    last_attempted_at: null,
    last_verified_at: lastVerifiedAt,
    last_content_hash: null,
  };
}

function activityByName(name: string): Row {
  const row = harness.tables.activities?.find((item) => item.name === name);
  if (!row) throw new Error(`missing activity ${name}`);
  return row;
}

function touchedActivities(): boolean {
  return harness.calls.some((call) => call.table === 'activities' || call.table === 'expire_dated_activities');
}

function queriedActivitySources(): boolean {
  return harness.calls.some((call) =>
    call.table === 'content_sources'
    && call.filters.some((filter) => filter.op === 'in' && Array.isArray(filter.value)
      && filter.value.includes('venue_page')),
  );
}

function pageUrls(): string[] {
  return harness.fetchUrls.filter((url) => !url.endsWith('/robots.txt') && !url.includes('anthropic'));
}

function forbiddenWrites(): string[] {
  const forbidden = [
    'partnerships',
    'bookings',
    'discounts',
    'credits',
    'offers',
    'challenge_items',
    'challenges',
    'redemptions',
    'restaurant_offers',
    'offer_versions',
    'entitlement_credits',
  ];
  return harness.calls
    .filter((call) => forbidden.includes(call.table))
    .map((call) => `${call.op} ${call.table}`);
}
