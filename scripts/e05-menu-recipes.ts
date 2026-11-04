import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { callMenuModel } from '../src/lib/recipes/menu-generate';
import { normalizeMenuTitle } from '../src/lib/recipes/menu-paraphrase';
import { toRecipeInsert, type MenuDraftRow } from '../src/lib/recipes/menu-row';
import {
  containedRepoPath,
  formatMenuRunSummary,
  MENU_OUTPUT_DIR,
  menuRecipeWriteAllowed,
  parseMenuRecipeArgs,
  publishMenuDrafts,
  runMenuRecipeDrafts,
  writeMenuDraftFile,
  type PublishCandidate,
} from '../src/lib/recipes/menu-run';
import { loadMenuSources } from '../src/lib/recipes/menu-sources';
import type { Database } from '../src/types/database.types';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const HELP = `Operator-only inspired-by recipe drafts from one public menu URL per restaurant.

Default is --dry-run. It fetches allowlisted pages (or reads --from-file) and writes JSON
under .menu-recipes/. It does not write the database.

  npm run menu:recipes -- --slug hutchins-bbq
  npm run menu:recipes -- --from-file .menu-recipes/menu.txt --slug hutchins-bbq
  WANDERBITE_MENU_RECIPES_APPLY=1 npm run menu:recipes -- --apply --slug hutchins-bbq
  WANDERBITE_MENU_RECIPES_APPLY=1 npm run menu:recipes -- --publish <uuid>,<uuid>

Only scripts/fixtures/e05-menu-sources.json URLs are fetched. The script checks robots.txt
for that path, sends WanderbiteMenuDraftBot, waits about one second between requests, and
does not follow links, redirects, logins, or PDFs. --from-file reads pasted menu text and
makes no network call. Dish and restaurant counts are capped. Descriptions that copy a long
run of menu wording are skipped. Drafts stay unpublished (visibility=draft).

--apply inserts those drafts with the service role. Re-runs match restaurant, menu URL, and
dish title and do not insert a duplicate. --publish flips reviewed draft ids to published.

Hosted --apply and --publish need Noah's separate OK. The script refuses a supabase.co URL,
and the hosted project, unless that OK is already given and WANDERBITE_MENU_RECIPES_HOSTED_OK=1
is set for that run. Do not point this at hosted as part of ordinary local review.

This does not touch the member AI budget, credits, offers, challenges, visits, badges, or drawings.
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function client(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  if (!url || !key) fail('menu recipes need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  const allowed = menuRecipeWriteAllowed(url);
  if (!allowed.ok) fail(allowed.reason);
  return createClient<Database>(url, key);
}

function outputPath(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(process.cwd(), MENU_OUTPUT_DIR, `drafts-${stamp}.json`);
}

async function main(): Promise<void> {
  const parsed = parseMenuRecipeArgs(process.argv.slice(2));
  if ('error' in parsed) fail(parsed.error);
  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }
  if (parsed.mode === 'publish') {
    const supabase = client();
    const result = await publishMenuDrafts({
      ids: parsed.publishIds,
      load: (id) => loadDraft(supabase, id),
      update: (id, checkedAt) => markPublished(supabase, id, checkedAt),
    });
    for (const id of result.published) process.stdout.write(`published ${id}\n`);
    for (const skip of result.skips) process.stdout.write(`skip: ${skip}\n`);
    process.stdout.write(`mode=publish db_writes=${result.dbWrites}\n`);
    return;
  }

  const registryPath = containedRepoPath(parsed.registryPath, process.cwd());
  if (!registryPath) fail('registry path must stay inside the repo');
  let registryText = '';
  try {
    registryText = readFileSync(registryPath, 'utf8');
  } catch {
    fail('menu source registry was not found');
  }
  const registry = loadMenuSources(registryText);
  if (!registry.ok) fail(registry.reason);
  const sources = parsed.slugs.length
    ? registry.sources.filter((source) => parsed.slugs.includes(source.restaurantSlug))
    : registry.sources;
  for (const slug of parsed.slugs) {
    if (!registry.sources.some((source) => source.restaurantSlug === slug)) {
      fail(`Refused. ${slug} is not in the menu source registry.`);
    }
  }
  let fromFileText: string | null = null;
  if (parsed.fromFile) {
    const filePath = containedRepoPath(parsed.fromFile, process.cwd());
    if (!filePath) fail('menu text path must stay inside the repo');
    try {
      fromFileText = readFileSync(filePath, 'utf8');
    } catch {
      fail('menu text file was not found');
    }
    if (Buffer.byteLength(fromFileText, 'utf8') > 1_000_000) fail('menu text file exceeds the size cap');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? '';
  if (!apiKey) fail('ANTHROPIC_API_KEY is not set. Dry-run still calls the model and does not use the member AI budget.');
  const supabase = parsed.mode === 'apply' ? client() : null;
  const startedAt = new Date();
  const summary = await runMenuRecipeDrafts({
    sources,
    mode: parsed.mode,
    fromFileText,
    callModel: async (input) => callMenuModel({ ...input, apiKey }),
    resolveRestaurant: supabase ? (slug) => resolveRestaurant(supabase, slug) : undefined,
    findExisting: supabase ? (restaurantId, sourceUrl, title) => findExisting(supabase, restaurantId, sourceUrl, title) : undefined,
    insertDraft: supabase ? (row) => insertDraft(supabase, row) : undefined,
  });
  const filePath = outputPath(startedAt);
  writeMenuDraftFile(filePath, summary);
  process.stdout.write(formatMenuRunSummary(summary, path.relative(process.cwd(), filePath)));
}

async function resolveRestaurant(
  supabase: SupabaseClient<Database>,
  slug: string,
): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabase.from('restaurants').select('id, name, slug').eq('slug', slug).maybeSingle();
  if (error) {
    console.error('[menu-recipes] restaurant lookup failed', error.code);
    throw new Error('restaurant lookup failed');
  }
  if (!data) return null;
  return { id: data.id, name: data.name };
}

async function findExisting(
  supabase: SupabaseClient<Database>,
  restaurantId: string,
  sourceUrl: string,
  title: string,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('recipes')
    .select('id, title')
    .eq('restaurant_id', restaurantId)
    .eq('source_url', sourceUrl)
    .eq('source_kind', 'public_menu');
  if (error) {
    console.error('[menu-recipes] draft lookup failed', error.code);
    throw new Error('draft lookup failed');
  }
  const wanted = normalizeMenuTitle(title);
  const match = (data ?? []).find((row) => normalizeMenuTitle(row.title) === wanted);
  return match ? { id: match.id } : null;
}

async function insertDraft(supabase: SupabaseClient<Database>, row: MenuDraftRow): Promise<{ id: string }> {
  const { data, error } = await supabase.from('recipes').insert(toRecipeInsert(row)).select('id').single();
  if (error || !data) {
    console.error('[menu-recipes] draft insert failed', error?.code ?? 'unknown');
    throw new Error('draft insert failed');
  }
  return { id: data.id };
}

async function loadDraft(supabase: SupabaseClient<Database>, id: string): Promise<PublishCandidate | null> {
  const { data, error } = await supabase
    .from('recipes')
    .select('id, visibility, source_kind, recipe_type, source_url, retrieved_at')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('[menu-recipes] publish lookup failed', error.code);
    return null;
  }
  if (!data) return null;
  return {
    id: data.id,
    visibility: data.visibility,
    sourceKind: data.source_kind,
    recipeType: data.recipe_type,
    sourceUrl: data.source_url,
    retrievedAt: data.retrieved_at,
  };
}

async function markPublished(supabase: SupabaseClient<Database>, id: string, checkedAt: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('recipes')
    .update({ visibility: 'published', checked_at: checkedAt })
    .eq('id', id)
    .eq('visibility', 'draft')
    .select('id');
  if (error) {
    console.error('[menu-recipes] publish failed', error.code);
    return false;
  }
  return (data ?? []).length === 1;
}

main().catch((err: unknown) => {
  console.error('[menu-recipes] failed');
  fail(err instanceof Error ? err.message : 'menu recipes failed');
});
