import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ExtractedDish } from '@/lib/recipes/menu-extract';
import { extractMenuDishes, menuProse } from '@/lib/recipes/menu-extract';
import { emptyRequestPacer, fetchAllowlistedMenu, type RequestPacer } from '@/lib/recipes/menu-fetch';
import { buildMenuPrompt, estimateTokens, parseMenuModelText } from '@/lib/recipes/menu-generate';
import { normalizeMenuTitle } from '@/lib/recipes/menu-paraphrase';
import {
  buildMenuDraftRow,
  menuDraftIdempotencyKey,
  type MenuDraftRow,
  type MenuModelDish,
} from '@/lib/recipes/menu-row';
import { normalizeMenuUrl, type MenuSource } from '@/lib/recipes/menu-sources';

export const MENU_MAX_DISHES = 5;
export const MENU_MAX_RESTAURANTS = 5;
export const MENU_DRAFT_SCHEMA = 'wanderbite.e05.menu_drafts.v1';
export const MENU_OUTPUT_DIR = '.menu-recipes';

const HOSTED_PROJECT_REF = 'yiajoycgiyxjvznndjge';

export type MenuModelCaller = (input: {
  system: string;
  user: string;
}) => Promise<{ text: string; usage: { input: number; output: number } | null }>;

export type MenuDraftOutput = {
  row: MenuDraftRow;
  insertedId: string | null;
};

export type MenuRestaurantResult = {
  restaurantSlug: string;
  restaurantName: string;
  menuUrl: string;
  retrievedAt: string | null;
  dishesFound: number;
  drafts: MenuDraftOutput[];
  skips: string[];
};

export type MenuRunSummary = {
  schema: typeof MENU_DRAFT_SCHEMA;
  mode: 'dry-run' | 'apply';
  generatedAt: string;
  dbWrites: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  reportedInputTokens: number;
  reportedOutputTokens: number;
  restaurants: MenuRestaurantResult[];
  skips: string[];
};

export type MenuPublishResult = {
  published: string[];
  skips: string[];
  dbWrites: number;
};

function matchDraft(source: ExtractedDish, drafts: readonly MenuModelDish[], index: number): MenuModelDish | null {
  const wanted = normalizeMenuTitle(source.name);
  const named = drafts.find((draft) => normalizeMenuTitle(draft.menuDish) === wanted);
  if (named) return named;
  const fallback = drafts[index];
  if (!fallback) return null;
  if (fallback.menuDish && normalizeMenuTitle(fallback.menuDish) !== wanted) return null;
  return fallback;
}

export async function runMenuRecipeDrafts(args: {
  sources: readonly MenuSource[];
  mode: 'dry-run' | 'apply';
  fromFileText?: string | null;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  callModel: MenuModelCaller;
  resolveRestaurant?: (slug: string) => Promise<{ id: string; name: string } | null>;
  findExisting?: (restaurantId: string, sourceUrl: string, title: string) => Promise<{ id: string } | null>;
  insertDraft?: (row: MenuDraftRow) => Promise<{ id: string }>;
  takenSlugs?: Set<string>;
  pacer?: RequestPacer;
}): Promise<MenuRunSummary> {
  const now = args.now ?? (() => new Date());
  const sleep = args.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const fetchImpl = args.fetchImpl ?? fetch;
  const pacer = args.pacer ?? emptyRequestPacer();
  const taken = args.takenSlugs ?? new Set<string>();
  const allowlist = args.sources.map((source) => source.menuUrl);
  const selected = args.sources.slice(0, MENU_MAX_RESTAURANTS);
  const skips = args.sources.slice(MENU_MAX_RESTAURANTS).map(
    (source) => `${source.restaurantSlug}: restaurant cap (${MENU_MAX_RESTAURANTS})`,
  );
  if (args.fromFileText != null && selected.length > 1) {
    skips.push('from-file applies to one restaurant');
  }
  const fileSources = args.fromFileText != null ? selected.slice(0, 1) : selected;
  const restaurants: MenuRestaurantResult[] = [];
  let dbWrites = 0;
  let estimatedInputTokens = 0;
  let estimatedOutputTokens = 0;
  let reportedInputTokens = 0;
  let reportedOutputTokens = 0;

  for (const source of fileSources) {
    const result: MenuRestaurantResult = {
      restaurantSlug: source.restaurantSlug,
      restaurantName: source.restaurantSlug,
      menuUrl: source.menuUrl,
      retrievedAt: null,
      dishesFound: 0,
      drafts: [],
      skips: [],
    };
    let menuText = args.fromFileText ?? null;
    let retrievedAt = args.fromFileText != null ? now().toISOString() : null;
    if (menuText == null) {
      const fetched = await fetchAllowlistedMenu({
        menuUrl: source.menuUrl,
        allowlist,
        fetchImpl,
        now,
        sleep,
        pacer,
      });
      if (!fetched.ok) {
        result.skips.push(fetched.reason);
        restaurants.push(result);
        continue;
      }
      menuText = fetched.html;
      retrievedAt = fetched.retrievedAt;
    }
    result.retrievedAt = retrievedAt;
    const extracted = extractMenuDishes(menuText);
    result.dishesFound = extracted.length;
    if (extracted.length === 0) {
      result.skips.push('no dishes extracted');
      restaurants.push(result);
      continue;
    }
    const capped = extracted.slice(0, MENU_MAX_DISHES);
    if (extracted.length > MENU_MAX_DISHES) {
      result.skips.push(`dish cap (${MENU_MAX_DISHES})`);
    }
    const restaurant = args.resolveRestaurant
      ? await args.resolveRestaurant(source.restaurantSlug)
      : null;
    if (restaurant) result.restaurantName = restaurant.name;
    if (args.mode === 'apply' && !restaurant) {
      result.skips.push('restaurant slug was not found in the catalog');
      restaurants.push(result);
      continue;
    }
    const prompt = buildMenuPrompt({ restaurantName: result.restaurantName, dishes: capped });
    const inputTokens = estimateTokens(prompt.system) + estimateTokens(prompt.user);
    const outputTokens = capped.length * 400;
    estimatedInputTokens += inputTokens;
    estimatedOutputTokens += outputTokens;
    const model = await args.callModel(prompt);
    if (model.usage) {
      reportedInputTokens += model.usage.input;
      reportedOutputTokens += model.usage.output;
    }
    const parsed = parseMenuModelText(model.text);
    if ('reason' in parsed && parsed.dishes.length === 0) {
      result.skips.push(parsed.reason);
      restaurants.push(result);
      continue;
    }
    for (let index = 0; index < capped.length; index += 1) {
      const menuDish = capped[index];
      if (!menuDish || !retrievedAt) continue;
      const draft = matchDraft(menuDish, parsed.dishes, index);
      if (!draft) {
        result.skips.push(`${menuDish.name}: model omitted the dish`);
        continue;
      }
      const built = buildMenuDraftRow({
        restaurantSlug: source.restaurantSlug,
        restaurantId: restaurant?.id ?? null,
        sourceUrl: source.menuUrl,
        retrievedAt,
        menuDescription: menuDish.description,
        menuProse: menuProse(menuDish),
        dish: draft,
        takenSlugs: taken,
      });
      if (!built.ok) {
        result.skips.push(`${menuDish.name}: ${built.reason}`);
        continue;
      }
      taken.add(built.row.slug);
      if (args.mode === 'dry-run') {
        result.drafts.push({ row: built.row, insertedId: null });
        continue;
      }
      const restaurantId = built.row.restaurant_id;
      if (!restaurantId || !args.insertDraft) {
        result.skips.push(`${menuDish.name}: restaurant id is missing`);
        continue;
      }
      const existing = args.findExisting
        ? await args.findExisting(restaurantId, built.row.source_url, built.row.title)
        : null;
      if (existing) {
        result.skips.push(`${menuDish.name}: already drafted (${existing.id})`);
        continue;
      }
      const inserted = await args.insertDraft(built.row);
      dbWrites += 1;
      result.drafts.push({ row: built.row, insertedId: inserted.id });
    }
    restaurants.push(result);
  }

  return {
    schema: MENU_DRAFT_SCHEMA,
    mode: args.mode,
    generatedAt: now().toISOString(),
    dbWrites,
    estimatedInputTokens,
    estimatedOutputTokens,
    reportedInputTokens,
    reportedOutputTokens,
    restaurants,
    skips,
  };
}

export function menuDraftFilePayload(summary: MenuRunSummary): Record<string, unknown> {
  return {
    schema: summary.schema,
    mode: summary.mode,
    generated_at: summary.generatedAt,
    db_writes: summary.dbWrites,
    estimated_input_tokens: summary.estimatedInputTokens,
    estimated_output_tokens: summary.estimatedOutputTokens,
    reported_input_tokens: summary.reportedInputTokens,
    reported_output_tokens: summary.reportedOutputTokens,
    skips: summary.skips,
    restaurants: summary.restaurants.map((restaurant) => ({
      restaurant_slug: restaurant.restaurantSlug,
      menu_url: restaurant.menuUrl,
      retrieved_at: restaurant.retrievedAt,
      dishes_found: restaurant.dishesFound,
      skips: restaurant.skips,
      drafts: restaurant.drafts.map((draft) => ({
        ...draft.row,
        inserted_id: draft.insertedId,
        idempotency_key: menuDraftIdempotencyKey(
          draft.row.restaurant_id ?? `slug:${draft.row.restaurant_slug}`,
          draft.row.source_url,
          draft.row.title,
        ),
      })),
    })),
  };
}

export function writeMenuDraftFile(filePath: string, summary: MenuRunSummary): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(menuDraftFilePayload(summary), null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function hostedSupabaseUrl(supabaseUrl: string): boolean {
  if (supabaseUrl.includes(HOSTED_PROJECT_REF)) return true;
  try {
    const host = new URL(supabaseUrl).hostname;
    return host.endsWith('.supabase.co') || host.endsWith('.supabase.com');
  } catch {
    return true;
  }
}

export function menuRecipeWriteAllowed(
  supabaseUrl: string,
  env: Record<string, string | undefined> = process.env,
): { ok: true } | { ok: false; reason: string } {
  if (env.WANDERBITE_MENU_RECIPES_APPLY !== '1') {
    return {
      ok: false,
      reason: 'Refused. Set WANDERBITE_MENU_RECIPES_APPLY=1 for a local apply or publish. Hosted writes need Noah\'s OK.',
    };
  }
  if (hostedSupabaseUrl(supabaseUrl) && env.WANDERBITE_MENU_RECIPES_HOSTED_OK !== '1') {
    return {
      ok: false,
      reason:
        'Refused. Hosted apply or publish needs Noah\'s separate OK, then WANDERBITE_MENU_RECIPES_HOSTED_OK=1 for that run only.',
    };
  }
  return { ok: true };
}

export type PublishCandidate = {
  id: string;
  visibility: string;
  sourceKind: string | null;
  recipeType: string;
  sourceUrl: string | null;
  retrievedAt: string | null;
};

export async function publishMenuDrafts(args: {
  ids: readonly string[];
  now?: () => Date;
  load: (id: string) => Promise<PublishCandidate | null>;
  update: (id: string, checkedAt: string) => Promise<boolean>;
}): Promise<MenuPublishResult> {
  const now = args.now ?? (() => new Date());
  const published: string[] = [];
  const skips: string[] = [];
  let dbWrites = 0;
  for (const id of args.ids) {
    const row = await args.load(id);
    if (!row) {
      skips.push(`${id}: not found`);
      continue;
    }
    if (row.visibility === 'published') {
      skips.push(`${id}: already published`);
      continue;
    }
    if (row.visibility !== 'draft' || row.recipeType !== 'inspired_by' || row.sourceKind !== 'public_menu') {
      skips.push(`${id}: only an unpublished public_menu inspired-by draft can be published`);
      continue;
    }
    if (!row.sourceUrl || !row.retrievedAt) {
      skips.push(`${id}: missing source_url or retrieved_at`);
      continue;
    }
    const wrote = await args.update(id, now().toISOString());
    if (!wrote) {
      skips.push(`${id}: publish did not update a draft`);
      continue;
    }
    dbWrites += 1;
    published.push(id);
  }
  return { published, skips, dbWrites };
}

export type MenuRecipeArgs =
  | { help: true }
  | {
      help: false;
      mode: 'dry-run' | 'apply' | 'publish';
      publishIds: string[];
      fromFile: string | null;
      slugs: string[];
      registryPath: string;
    };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseMenuRecipeArgs(argv: readonly string[]): MenuRecipeArgs | { error: string } {
  let help = false;
  let apply = false;
  let dryRun = false;
  let publish = false;
  const publishIds: string[] = [];
  let fromFile: string | null = null;
  const slugs: string[] = [];
  let registryPath = path.join('scripts', 'fixtures', 'e05-menu-sources.json');
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--url' || arg === '--menu-url' || arg.startsWith('--url=') || arg.startsWith('--menu-url=')) {
      return { error: 'Refused. Only a menu URL listed in the source registry can be fetched.' };
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--publish') {
      publish = true;
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) return { error: '--publish needs comma-separated recipe ids' };
      index += 1;
      for (const id of value.split(',').map((part) => part.trim()).filter(Boolean)) {
        if (!UUID_RE.test(id)) return { error: `publish id is not a uuid: ${id}` };
        publishIds.push(id);
      }
      continue;
    }
    if (arg === '--from-file') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) return { error: '--from-file needs a path' };
      index += 1;
      fromFile = value;
      continue;
    }
    if (arg === '--slug') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) return { error: '--slug needs a restaurant slug' };
      index += 1;
      slugs.push(...value.split(',').map((part) => part.trim()).filter(Boolean));
      continue;
    }
    if (arg === '--registry') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) return { error: '--registry needs a path' };
      index += 1;
      registryPath = value;
      continue;
    }
    return { error: `Unknown argument: ${arg}` };
  }
  if (help) return { help: true };
  const modes = Number(apply) + Number(dryRun) + Number(publish);
  if (modes > 1) return { error: 'Choose one of --dry-run, --apply, or --publish.' };
  if (publish && publishIds.length === 0) return { error: '--publish needs comma-separated recipe ids' };
  if (fromFile && slugs.length !== 1) return { error: '--from-file needs exactly one --slug from the registry' };
  if (publish && fromFile) return { error: '--publish does not read a menu file' };
  const mode = publish ? 'publish' : apply ? 'apply' : 'dry-run';
  return { help: false, mode, publishIds, fromFile, slugs, registryPath };
}

export function containedRepoPath(candidate: string, cwd: string): string | null {
  const resolved = path.resolve(cwd, candidate);
  const relative = path.relative(cwd, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

export function formatMenuRunSummary(summary: MenuRunSummary, outputPath: string | null): string {
  const lines: string[] = [];
  for (const restaurant of summary.restaurants) {
    lines.push(
      `restaurant=${restaurant.restaurantSlug} dishes_found=${restaurant.dishesFound} drafts=${restaurant.drafts.length} skips=${restaurant.skips.length}`,
    );
    for (const skip of restaurant.skips) lines.push(`  skip: ${skip}`);
  }
  for (const skip of summary.skips) lines.push(`skip: ${skip}`);
  lines.push(
    `estimated_input_tokens=${summary.estimatedInputTokens} estimated_output_tokens=${summary.estimatedOutputTokens}`,
  );
  if (summary.reportedInputTokens > 0 || summary.reportedOutputTokens > 0) {
    lines.push(
      `reported_input_tokens=${summary.reportedInputTokens} reported_output_tokens=${summary.reportedOutputTokens}`,
    );
  }
  lines.push(`mode=${summary.mode} db_writes=${summary.dbWrites}`);
  if (outputPath) lines.push(`wrote ${outputPath}`);
  return `${lines.join('\n')}\n`;
}

export function assertRegistryUrl(menuUrl: string, sources: readonly MenuSource[]): string | null {
  const normalized = normalizeMenuUrl(menuUrl);
  if (!normalized || !sources.some((source) => source.menuUrl === normalized)) {
    return 'URL is not in the menu source registry';
  }
  return null;
}
