import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { planMenuChanges } from '@/lib/content-pipeline/change-detect';
import type { ExceptionDraft } from '@/lib/content-pipeline/exceptions';
import { formatContentInstant, type DescriptionFact } from '@/lib/content-pipeline/facts';
import { contentHash } from '@/lib/content-pipeline/hash';
import { seedSourcesFromRegistry } from '@/lib/content-pipeline/registry';
import { planFactRollback, planRecipeRollback, resolveSavedDescription } from '@/lib/content-pipeline/rollback';
import {
  contentRefreshAllowed,
  maintenanceIdempotencyKey,
  parseContentRefreshArgs,
  refreshContentSource,
  MAINTENANCE_ACCOUNT_TIER,
  MAINTENANCE_FEATURE_CLASS,
  type AttemptWrite,
  type ContentSourceRecord,
  type RecipePatch,
  type RefreshEffects,
  type SourcePatch,
} from '@/lib/content-pipeline/refresh';
import { extractMenuDishes } from '@/lib/recipes/menu-extract';
import { MENU_DATA_START, MENU_RECIPE_MODEL } from '@/lib/recipes/menu-generate';
import { loadMenuSources } from '@/lib/recipes/menu-sources';
import type { MenuModelDish } from '@/lib/recipes/menu-row';
import type { RecipeSnapshot } from '@/lib/content-pipeline/change-detect';

const NOW = new Date('2026-01-15T18:00:00.000Z');
const SUMMER = '2026-07-15T17:00:00.000Z';
const MENU_URL = 'https://hutchinsbbq.com/mckinney-menu/';
const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const RECIPE_ID = '22222222-2222-4222-8222-222222222222';
const FACT_ID = '33333333-3333-4333-8333-333333333333';
const GARDEN_RECIPE_ID = '44444444-4444-4444-8444-444444444444';
const GARDEN_FACT_ID = '55555555-5555-4555-8555-555555555555';
const GHOST_RECIPE_ID = '66666666-6666-4666-8666-666666666666';
const FIXTURES = path.join(process.cwd(), 'src/lib/content-pipeline/__fixtures__');

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

const BASELINE = fixture('menu-baseline.html');
const CHANGED = fixture('menu-changed.html');
const MISSING = fixture('menu-missing.html');
const CONFLICT = fixture('menu-conflict.html');
const INJECTED = fixture('menu-injected.html');
const SKILLET_MENU = 'White beans simmered with smoked paprika, garlic, and olive oil until the sauce turns glossy.';
const GARDEN_MENU = 'Roasted vegetables with lemon, herbs, and olive oil on a warm plate.';
const PARAPHRASE = 'A weeknight skillet of beans with a smoky paprika finish.';

function source(overrides: Partial<ContentSourceRecord> = {}): ContentSourceRecord {
  return {
    id: SOURCE_ID,
    kind: 'public_menu',
    url: MENU_URL,
    status: 'active',
    lastAttemptedAt: null,
    lastVerifiedAt: null,
    lastContentHash: contentHash(BASELINE),
    ...overrides,
  };
}

function fact(overrides: Partial<DescriptionFact> = {}): DescriptionFact {
  return {
    id: FACT_ID,
    sourceId: SOURCE_ID,
    subjectId: RECIPE_ID,
    version: 1,
    status: 'current',
    dish: 'Skillet Beans',
    text: 'A home pot of beans warmed with paprika and garlic.',
    menuDescription: SKILLET_MENU,
    ingredients: ['white beans', 'smoked paprika', 'garlic', 'olive oil'],
    price: '$12',
    evidenceExcerpt: SKILLET_MENU,
    ...overrides,
  };
}

function gardenFact(): DescriptionFact {
  return fact({
    id: GARDEN_FACT_ID,
    subjectId: GARDEN_RECIPE_ID,
    dish: 'Garden Plate',
    text: 'A home plate of roasted vegetables with lemon and herbs.',
    menuDescription: GARDEN_MENU,
    ingredients: ['zucchini', 'lemon', 'herbs', 'olive oil'],
    price: null,
    evidenceExcerpt: GARDEN_MENU,
  });
}

function recipe(overrides: Partial<RecipeSnapshot> = {}): RecipeSnapshot {
  return {
    id: RECIPE_ID,
    title: 'Home Skillet Beans',
    description: 'A home pot of beans warmed with paprika and garlic.',
    version: 1,
    visibility: 'draft',
    recipeType: 'inspired_by',
    sourceKind: 'public_menu',
    sourceUrl: MENU_URL,
    ...overrides,
  };
}

function modelDish(name: string, description: string): MenuModelDish {
  return {
    menuDish: name,
    title: `Home ${name}`,
    description,
    servings: 2,
    estMinutes: 25,
    ingredients: [{ name: 'Beans', quantity: '1', unit: 'cup' }],
    steps: [{ order: 1, text: 'Warm the beans in a skillet.' }],
    substitutions: [],
    dietaryNotes: [],
  };
}

function modelJson(dishes: MenuModelDish[]): string {
  return JSON.stringify({
    dishes: dishes.map((dish) => ({
      menu_dish: dish.menuDish,
      title: dish.title,
      description: dish.description,
      servings: dish.servings,
      est_minutes: dish.estMinutes,
      ingredients: dish.ingredients,
      steps: dish.steps.map((step) => ({ text: step.text })),
      substitutions: dish.substitutions,
      dietary_notes: dish.dietaryNotes,
    })),
  });
}

function fetchHtml(html: string, status = 200, robots = 'User-agent: *\nAllow: /\n'): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) {
      return new Response(robots, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
}

type Memory = {
  source: ContentSourceRecord;
  facts: DescriptionFact[];
  recipes: RecipeSnapshot[];
  attempts: AttemptWrite[];
  exceptions: ExceptionDraft[];
  patches: SourcePatch[];
  recipePatches: { id: string; patch: RecipePatch }[];
  effects: RefreshEffects;
};

function memory(initial: {
  source?: ContentSourceRecord;
  facts?: DescriptionFact[];
  recipes?: RecipeSnapshot[];
}): Memory {
  const state: Memory = {
    source: initial.source ?? source(),
    facts: [...(initial.facts ?? [fact()])],
    recipes: [...(initial.recipes ?? [recipe()])],
    attempts: [],
    exceptions: [],
    patches: [],
    recipePatches: [],
    effects: {
      recordAttempt: async (row) => {
        state.attempts.push(row);
      },
      updateSource: async (_id, patch) => {
        state.patches.push(patch);
        state.source.lastAttemptedAt = patch.lastAttemptedAt;
        if (patch.lastVerifiedAt) state.source.lastVerifiedAt = patch.lastVerifiedAt;
        if (patch.lastContentHash) state.source.lastContentHash = patch.lastContentHash;
      },
      applyDescriptionFact: async (row) => {
        const recipe = state.recipes.find((item) => item.id === row.recipeId);
        if (!recipe) throw new Error('recipe missing');
        if (!row.supersedeFactId) {
          if (state.facts.some((item) => item.subjectId === row.recipeId && item.status === 'current')) return;
          state.facts.push({
            id: `fact-${state.facts.length + 1}`,
            sourceId: row.sourceId,
            subjectId: row.recipeId,
            version: recipe.version,
            status: 'current',
            dish: row.value.dish,
            text: row.value.text,
            menuDescription: row.value.menu_description,
            ingredients: row.value.ingredients,
            price: row.value.price,
            evidenceExcerpt: row.evidenceExcerpt,
          });
          return;
        }
        const current = state.facts.find((item) => item.id === row.supersedeFactId && item.status === 'current');
        if (!current || current.version !== recipe.version) throw new Error('fact version');
        const nextVersion = recipe.version + 1;
        current.status = 'superseded';
        state.facts.push({
          id: `fact-${state.facts.length + 1}`,
          sourceId: row.sourceId,
          subjectId: row.recipeId,
          version: nextVersion,
          status: 'current',
          dish: row.value.dish,
          text: row.value.text,
          menuDescription: row.value.menu_description,
          ingredients: row.value.ingredients,
          price: row.value.price,
          evidenceExcerpt: row.evidenceExcerpt,
        });
        recipe.description = row.value.text;
        recipe.version = nextVersion;
        state.recipePatches.push({
          id: row.recipeId,
          patch: {
            description: row.value.text,
            version: nextVersion,
            retrievedAt: row.retrievedAt ?? '',
          },
        });
      },
      openException: async (row) => {
        state.exceptions.push(row);
      },
    },
  };
  return state;
}

async function run(
  state: Memory,
  html: string,
  extra: {
    fetchImpl?: typeof fetch;
    maxRetries?: number;
    callModel?: (input: { system: string; user: string }) => Promise<{ text: string; usage: { input: number; output: number } | null }>;
    reserve?: () => Promise<{ ok: true } | { ok: false; reason: string }>;
    apply?: boolean;
  } = {},
) {
  const calls: { system: string; user: string }[] = [];
  const reserves: string[] = [];
  const result = await refreshContentSource({
    source: state.source,
    facts: state.facts,
    recipes: state.recipes,
    openExceptions: state.exceptions,
    apply: extra.apply ?? true,
    now: () => NOW,
    sleep: async () => undefined,
    fetchImpl: extra.fetchImpl ?? fetchHtml(html),
    maxRetries: extra.maxRetries ?? 0,
    callModel: async (input) => {
      calls.push(input);
      if (extra.callModel) return extra.callModel(input);
      return { text: modelJson([modelDish('Skillet Beans', PARAPHRASE)]), usage: { input: 20, output: 30 } };
    },
    reserveModel: async (input) => {
      reserves.push(input.contentHash);
      const decision = extra.reserve ? await extra.reserve() : { ok: true as const };
      if (!decision.ok) return decision;
      return { ok: true, settle: async () => undefined, release: async () => undefined };
    },
    effects: state.effects,
  });
  return { result, calls, reserves };
}

function labelUnderTz(tz: string, iso: string): string {
  const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
  const result = spawnSync(
    tsx,
    [
      '-e',
      `import { formatContentInstant } from './src/lib/content-pipeline/facts.ts'; process.stdout.write(formatContentInstant(${JSON.stringify(iso)}));`,
    ],
    { cwd: process.cwd(), env: { ...process.env, TZ: tz }, encoding: 'utf8' },
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

describe('content pipeline', () => {
  it('hashes page bytes and keeps Chicago labels under UTC and America/Chicago', () => {
    expect(contentHash(BASELINE)).toMatch(/^[a-f0-9]{64}$/);
    expect(contentHash(BASELINE)).toBe(contentHash(BASELINE));
    expect(contentHash(CHANGED)).not.toBe(contentHash(BASELINE));
    const winter = formatContentInstant(NOW.toISOString());
    const summer = formatContentInstant(SUMMER);
    for (const tz of ['UTC', 'America/Chicago']) {
      expect(labelUnderTz(tz, NOW.toISOString())).toBe(winter);
      expect(labelUnderTz(tz, SUMMER)).toBe(summer);
    }
    expect(winter).toMatch(/^Jan 15, 2026, 12:00 PM /);
    expect(summer).toMatch(/^Jul 15, 2026, 12:00 PM /);
    expect(NOW.toISOString()).toBe('2026-01-15T18:00:00.000Z');
  });

  it('records unchanged, advances last_verified_at, and does not call the model', async () => {
    const state = memory({});
    const { result, calls, reserves } = await run(state, BASELINE);
    expect(result.attempts.map((row) => row.outcome)).toEqual(['unchanged']);
    expect(result.modelCalls).toBe(0);
    expect(calls).toHaveLength(0);
    expect(reserves).toHaveLength(0);
    expect(state.source.lastAttemptedAt).toBe(NOW.toISOString());
    expect(state.source.lastVerifiedAt).toBe(NOW.toISOString());
    expect(state.recipePatches).toHaveLength(0);
    expect(state.facts.filter((row) => row.status === 'current')).toHaveLength(1);
  });

  it('records timeout, http 500, and robots without advancing last_verified_at', async () => {
    const timeoutState = memory({});
    const timeout = await refreshContentSource({
      source: timeoutState.source,
      facts: timeoutState.facts,
      recipes: timeoutState.recipes,
      apply: true,
      now: () => NOW,
      sleep: async () => undefined,
      maxRetries: 0,
      fetchImpl: async (input) => {
        if (String(input).endsWith('/robots.txt')) {
          return new Response('User-agent: *\nAllow: /\n', { status: 200, headers: { 'content-type': 'text/plain' } });
        }
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      },
      effects: timeoutState.effects,
    });
    expect(timeout.attempts.map((row) => row.outcome)).toEqual(['timeout']);
    expect(timeoutState.source.lastAttemptedAt).toBe(NOW.toISOString());
    expect(timeoutState.source.lastVerifiedAt).toBeNull();
    expect(timeoutState.patches[0]?.lastVerifiedAt).toBeUndefined();

    const httpState = memory({});
    const http = await run(httpState, 'nope', { fetchImpl: fetchHtml('nope', 500) });
    expect(http.result.attempts).toEqual([
      expect.objectContaining({ outcome: 'http_error', httpStatus: 500, errorCode: 'http_500' }),
    ]);
    expect(httpState.source.lastVerifiedAt).toBeNull();

    const robotsState = memory({});
    const robots = await run(robotsState, BASELINE, {
      fetchImpl: fetchHtml(BASELINE, 200, 'User-agent: *\nDisallow: /\n'),
    });
    expect(robots.result.attempts.map((row) => row.outcome)).toEqual(['robots_disallowed']);
    expect(robotsState.source.lastVerifiedAt).toBeNull();
    expect(robots.calls).toHaveLength(0);
  });

  it('retries a timeout with backoff and stops at the cap', async () => {
    const sleeps: number[] = [];
    let tries = 0;
    const state = memory({});
    const result = await refreshContentSource({
      source: state.source,
      facts: state.facts,
      recipes: state.recipes,
      apply: true,
      now: () => NOW,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      maxRetries: 1,
      fetchImpl: async (input) => {
        if (String(input).endsWith('/robots.txt')) {
          return new Response('User-agent: *\nAllow: /\n', { status: 200, headers: { 'content-type': 'text/plain' } });
        }
        tries += 1;
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      },
      effects: state.effects,
    });
    expect(tries).toBe(2);
    expect(result.attempts).toHaveLength(2);
    expect(sleeps).toContain(250);
    expect(state.source.lastVerifiedAt).toBeNull();
  });

  it('publishes one description version and does not publish again on re-run', async () => {
    const state = memory({});
    const first = await run(state, CHANGED);
    expect(first.result.modelCalls).toBe(1);
    expect(first.calls).toHaveLength(1);
    expect(first.calls[0]?.user).toContain(MENU_DATA_START);
    expect(first.reserves).toHaveLength(1);
    expect(first.reserves[0]).toBe(contentHash(CHANGED));
    expect(state.recipePatches).toHaveLength(1);
    expect(state.recipePatches[0]?.patch).toEqual({
      description: PARAPHRASE,
      version: 2,
      retrievedAt: NOW.toISOString(),
    });
    expect(state.recipePatches[0]?.patch).not.toHaveProperty('recipeType');
    expect(state.facts.filter((row) => row.status === 'current')).toHaveLength(1);
    expect(state.facts.filter((row) => row.version === 2)).toHaveLength(1);
    expect(state.facts.find((row) => row.version === 1)?.status).toBe('superseded');
    expect(state.recipes[0]?.recipeType).toBe('inspired_by');
    expect(state.recipes[0]?.visibility).toBe('draft');
    expect(resolveSavedDescription(state.facts, 1)).toBe('A home pot of beans warmed with paprika and garlic.');

    const second = await run(state, CHANGED);
    expect(second.result.attempts.map((row) => row.outcome)).toEqual(['unchanged']);
    expect(second.result.modelCalls).toBe(0);
    expect(second.calls).toHaveLength(0);
    expect(second.reserves).toHaveLength(0);
    expect(state.recipePatches).toHaveLength(1);
    expect(state.facts.filter((row) => row.version === 2)).toHaveLength(1);
  });

  it('opens a conflict and does not publish a contradicting price or ingredient list', async () => {
    const state = memory({});
    const { result, calls } = await run(state, CONFLICT);
    expect(calls).toHaveLength(0);
    expect(result.updates).toHaveLength(0);
    expect(state.recipePatches).toHaveLength(0);
    expect(state.facts.filter((row) => row.status === 'current')).toHaveLength(1);
    const conflict = state.exceptions.find((row) => row.reason === 'conflict');
    expect(conflict?.before).toBeTruthy();
    expect(conflict?.after).toBeTruthy();
    expect(conflict?.evidenceExcerpt.length).toBeGreaterThan(0);
    expect(state.recipes[0]?.description).toBe('A home pot of beans warmed with paprika and garlic.');
  });

  it('opens a missing-dish exception and leaves the published recipe in place', async () => {
    const published = recipe({ visibility: 'published', version: 1 });
    const state = memory({
      facts: [fact(), gardenFact()],
      recipes: [published, recipe({ id: GARDEN_RECIPE_ID, title: 'Home Garden Plate', visibility: 'published' })],
    });
    const { calls } = await run(state, MISSING);
    expect(calls).toHaveLength(0);
    expect(state.exceptions.some((row) => row.reason === 'missing_source' && row.subjectId === RECIPE_ID)).toBe(true);
    expect(state.recipePatches).toHaveLength(0);
    expect(state.recipes[0]).toMatchObject({ version: 1, visibility: 'published', recipeType: 'inspired_by' });
    expect(state.facts.find((row) => row.id === FACT_ID)?.status).toBe('current');
  });

  it('keeps an injected page inspired_by and draft, and does not publish it', async () => {
    const state = memory({
      facts: [gardenFact()],
      recipes: [recipe({
        id: GARDEN_RECIPE_ID,
        title: 'Home Garden Plate',
        visibility: 'draft',
        recipeType: 'inspired_by',
        description: 'A home plate of roasted vegetables with lemon and herbs.',
      })],
    });
    const { result, calls } = await run(state, INJECTED);
    expect(calls).toHaveLength(0);
    expect(result.modelCalls).toBe(0);
    expect(state.exceptions.some((row) => row.reason === 'injection_suspected')).toBe(true);
    expect(state.recipePatches).toHaveLength(0);
    expect(state.facts.every((row) => row.version === 1)).toBe(true);
    expect(state.recipes[0]).toMatchObject({ recipeType: 'inspired_by', visibility: 'draft' });
  });

  it('baselines matched recipes with no facts, then a change updates once and a removal opens an exception', async () => {
    const state = memory({
      source: source({ lastContentHash: null }),
      facts: [],
      recipes: [
        recipe({ title: 'Home Skillet Beans', version: 1 }),
        recipe({
          id: GHOST_RECIPE_ID,
          title: 'Home Ghost Plate',
          description: 'A plate that left the menu.',
          version: 1,
        }),
      ],
    });
    const first = await run(state, BASELINE);
    expect(first.calls).toHaveLength(0);
    expect(first.reserves).toHaveLength(0);
    expect(first.result.modelCalls).toBe(0);
    const current = state.facts.filter((row) => row.status === 'current');
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({
      subjectId: RECIPE_ID,
      version: 1,
      text: 'A home pot of beans warmed with paprika and garlic.',
      menuDescription: SKILLET_MENU,
    });
    expect(state.recipes[0]?.version).toBe(1);
    expect(state.recipePatches).toHaveLength(0);
    expect(state.exceptions.some((row) => row.reason === 'missing_source' && row.subjectId === GHOST_RECIPE_ID)).toBe(true);

    const again = await run(state, BASELINE);
    expect(again.result.attempts.map((row) => row.outcome)).toEqual(['unchanged']);
    expect(again.calls).toHaveLength(0);
    expect(state.facts.filter((row) => row.status === 'current')).toHaveLength(1);

    const changed = await run(state, CHANGED);
    expect(changed.result.modelCalls).toBe(1);
    expect(changed.calls).toHaveLength(1);
    expect(state.recipePatches).toHaveLength(1);
    expect(state.recipes[0]?.version).toBe(2);
    expect(state.facts.filter((row) => row.version === 2 && row.status === 'current')).toHaveLength(1);

    const repeat = await run(state, CHANGED);
    expect(repeat.result.modelCalls).toBe(0);
    expect(state.facts.filter((row) => row.version === 2)).toHaveLength(1);

    const missing = await run(state, MISSING);
    expect(missing.calls).toHaveLength(0);
    expect(state.exceptions.some((row) => row.reason === 'missing_source' && row.subjectId === RECIPE_ID)).toBe(true);
    expect(state.recipes[0]?.version).toBe(2);
    expect(state.recipes[0]?.description).toBe(PARAPHRASE);
  });

  it('stores a baseline fact at the recipe version when that version is already above 1', async () => {
    const description = 'A home pot of beans warmed with paprika and garlic.';
    const state = memory({
      source: source({ lastContentHash: null }),
      facts: [],
      recipes: [recipe({ title: 'Home Skillet Beans', version: 3, description })],
    });
    const { calls } = await run(state, BASELINE);
    expect(calls).toHaveLength(0);
    expect(state.facts.filter((row) => row.status === 'current')).toEqual([
      expect.objectContaining({ version: 3, text: description, subjectId: RECIPE_ID }),
    ]);
    expect(state.recipes[0]?.version).toBe(3);
    expect(resolveSavedDescription(state.facts, 3)).toBe(description);
  });

  it('marks a maintenance reservation spent when the model call throws', async () => {
    const state = memory({});
    let released = 0;
    const result = await refreshContentSource({
      source: state.source,
      facts: state.facts,
      recipes: state.recipes,
      apply: true,
      now: () => NOW,
      sleep: async () => undefined,
      maxRetries: 0,
      fetchImpl: fetchHtml(CHANGED),
      callModel: async () => {
        throw new Error('model down');
      },
      reserveModel: async () => ({
        ok: true,
        settle: async () => undefined,
        release: async () => {
          released += 1;
        },
      }),
      effects: state.effects,
    });
    expect(released).toBe(1);
    expect(result.modelCalls).toBe(1);
    expect(result.verified).toBe(false);
    expect(result.attempts.map((row) => row.outcome)).toEqual(['parse_error']);
    expect(state.recipePatches).toHaveLength(0);
    expect(state.facts.filter((row) => row.status === 'current')).toHaveLength(1);
    expect(state.source.lastVerifiedAt).toBeNull();
  });

  it('refuses a source that is not active', async () => {
    const state = memory({ source: source({ status: 'paused' }) });
    const { result, calls } = await run(state, CHANGED);
    expect(result.refused).toMatch(/not active/);
    expect(result.attempts).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(state.attempts).toHaveLength(0);
    expect(state.recipePatches).toHaveLength(0);
  });

  it('does not call the model when the maintenance reserve is denied', async () => {
    const state = memory({});
    const { result, calls } = await run(state, CHANGED, { reserve: async () => ({ ok: false, reason: 'maintenance budget' }) });
    expect(calls).toHaveLength(0);
    expect(result.modelCalls).toBe(0);
    expect(state.recipePatches).toHaveLength(0);
    expect(result.attempts.map((row) => row.outcome)).toEqual(['parse_error']);
    expect(state.source.lastVerifiedAt).toBeNull();
  });

  it('restores a recipe as a new version and keeps the saved version resolvable', () => {
    const rows = [fact(), fact({
      id: 'fact-2',
      version: 2,
      status: 'current',
      text: PARAPHRASE,
      menuDescription: 'White beans finished with a smoky paprika oil and plenty of garlic.',
    })];
    rows[0] = { ...rows[0], status: 'superseded' };
    expect(resolveSavedDescription(rows, 1)).toBe('A home pot of beans warmed with paprika and garlic.');
    const planned = planRecipeRollback(rows, 'fact-2', 2);
    expect('error' in planned).toBe(false);
    if ('error' in planned) return;
    expect(planned.description).toBe('A home pot of beans warmed with paprika and garlic.');
    expect(planned.recipeVersion).toBe(3);
    expect(planned.version).toBe(3);
    expect(planned.supersedeId).toBe('fact-2');
    expect(rows).toHaveLength(2);
    expect(planFactRollback(rows, 'fact-2')).toEqual({ error: 'use rollback_recipe_to_previous' });
  });

  it('extracts the changed, missing, conflicting, and injected fixtures', () => {
    expect(extractMenuDishes(CHANGED).map((dish) => dish.name)).toEqual(['Skillet Beans', 'Garden Plate']);
    expect(extractMenuDishes(MISSING).map((dish) => dish.name)).toEqual(['Garden Plate']);
    const conflict = planMenuChanges({
      sourceId: SOURCE_ID,
      dishes: extractMenuDishes(CONFLICT),
      facts: [fact()],
      recipes: [recipe()],
    });
    expect(conflict.candidates).toHaveLength(0);
    expect(conflict.exceptions.some((row) => row.reason === 'conflict')).toBe(true);
    const injected = planMenuChanges({
      sourceId: SOURCE_ID,
      dishes: extractMenuDishes(INJECTED),
      facts: [gardenFact()],
      recipes: [recipe({ id: GARDEN_RECIPE_ID })],
    });
    expect(injected.candidates).toHaveLength(0);
    expect(injected.exceptions.some((row) => row.reason === 'injection_suspected')).toBe(true);
  });

  it('refuses hosted writes unless both guard env vars are set', () => {
    expect(contentRefreshAllowed('http://127.0.0.1:54321', 'read', {}).ok).toBe(true);
    expect(contentRefreshAllowed('http://127.0.0.1:54321', 'write', {}).ok).toBe(false);
    expect(contentRefreshAllowed('http://127.0.0.1:54321', 'write', { WANDERBITE_CONTENT_REFRESH_APPLY: '1' }).ok).toBe(true);
    const hosted = 'https://yiajoycgiyxjvznndjge.supabase.co';
    expect(contentRefreshAllowed(hosted, 'read', {}).ok).toBe(false);
    expect(contentRefreshAllowed(hosted, 'write', { WANDERBITE_CONTENT_REFRESH_APPLY: '1' }).ok).toBe(false);
    expect(contentRefreshAllowed('https://abc.supabase.co', 'write', {
      WANDERBITE_CONTENT_REFRESH_APPLY: '1',
      WANDERBITE_CONTENT_REFRESH_HOSTED_OK: '1',
    }).ok).toBe(true);
    expect(parseContentRefreshArgs(['--url', 'https://evil.example/menu'])).toEqual({
      error: 'Refused. Only a URL already stored in content_sources can be refreshed.',
    });
    expect(parseContentRefreshArgs(['--refresh'])).toMatchObject({ help: false, command: 'refresh', apply: false });
    expect(MAINTENANCE_FEATURE_CLASS).toBe('maintenance');
    expect(MAINTENANCE_ACCOUNT_TIER).toBe('ops');
    expect(maintenanceIdempotencyKey(SOURCE_ID, contentHash(BASELINE)).length).toBeGreaterThan(8);
    expect(MENU_RECIPE_MODEL).toBe('claude-haiku-4-5-20251001');
  });

  it('seeds registry URLs from the script fixture and not from SQL', () => {
    const registry = loadMenuSources(readFileSync(path.join(process.cwd(), 'scripts/fixtures/e05-menu-sources.json'), 'utf8'));
    expect(registry.ok).toBe(true);
    if (!registry.ok) return;
    const seeded = seedSourcesFromRegistry(registry.sources);
    expect(seeded.map((row) => row.url)).toEqual([
      'https://hutchinsbbq.com/mckinney-menu/',
      'https://www.rickschophouse.com/dinner',
    ]);
    const sql = readFileSync(path.join(process.cwd(), 'supabase/migrations/20261104040000_e05_b2_content_pipeline.sql'), 'utf8');
    expect(sql).not.toContain('hutchinsbbq.com');
    expect(sql).not.toContain('rickschophouse.com');
    const sources = [
      'src/lib/content-pipeline/refresh.ts',
      'src/lib/content-pipeline/change-detect.ts',
      'src/lib/content-pipeline/facts.ts',
      'src/lib/content-pipeline/rollback.ts',
      'scripts/content-refresh.ts',
    ].map((file) => readFileSync(path.join(process.cwd(), file), 'utf8')).join('\n');
    expect(sources).not.toMatch(/from\('(?:entitlement_credits|challenge_items|challenge_cycles|redemptions|user_badges|restaurant_offers|offer_versions|drawings)'\)/);
    expect(sources).toContain('p_feature_class: MAINTENANCE_FEATURE_CLASS');
    expect(sources).toContain('p_account_tier: MAINTENANCE_ACCOUNT_TIER');
    expect(sources).not.toContain('p_user_id');
  });
});
