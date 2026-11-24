import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import type { NoteSourceActivity, NoteSourceRestaurant } from '../src/lib/activities/note-eligible';
import {
  activityNoteReadAllowed,
  activityNoteWriteAllowed,
  containedRepoPath,
  formatActivityNoteSummary,
  ACTIVITY_NOTE_OUTPUT_DIR,
  parseActivityNoteArgs,
  runActivityNoteDrafts,
  writeActivityNoteFile,
  type ActivityNoteDraftInsert,
  type ExistingActivityNote,
} from '../src/lib/activities/note-run';
import { callActivityNoteModel, resolveActivityNoteModel } from '../src/lib/activities/note-generate';
import type { Database } from '../src/types/database.types';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const HELP = `Operator-only personal notes for a restaurant and one or two nearby activities.

Default is --dry-run. It calls Anthropic and writes JSON under .activity-notes/.
It does not write the database.

  npm run activity:notes
  npm run activity:notes -- --slug hutchins-bbq
  WANDERBITE_ACTIVITY_NOTES_MODEL=<model-id> npm run activity:notes
  WANDERBITE_ACTIVITY_NOTES_APPLY=1 npm run activity:notes -- --apply --slug hutchins-bbq

Drafts use the restaurant name and cuisine tags plus a varied set of currently
showing, non-kids activities within 5 miles. Real outings are ranked ahead of
dessert, and dessert is capped at 2. Paused, stale, sample, and kids_oriented
rows are skipped. The model sees a short place name, rounded miles, and whether
the stop is walkable. A Wanderbite restaurant is not used as the outing. The
model cannot invent a place. A note that opens or closes with filler, or that
calls a place a short walk when it is not walkable, is retried once, then
reported as blocked and not saved. Nearby is allowed for any listed place.

WANDERBITE_ACTIVITY_NOTES_MODEL overrides the Haiku snapshot for this script only.
The dry-run printout and JSON record the model id that was used.

--apply inserts status=draft rows. A restaurant with an open draft, or the same
source hash, is skipped. Members do not see drafts until an admin approves one.

Hosted reads and --apply need Noah's separate OK. The script refuses a supabase.co
URL, and the hosted project, unless WANDERBITE_ACTIVITY_NOTES_HOSTED_OK=1 is set
for that run. --apply also needs WANDERBITE_ACTIVITY_NOTES_APPLY=1. Do not point
this at hosted as part of ordinary local review.

This does not touch the member AI budget, credits, offers, challenges, visits, badges, or drawings.
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function outputPath(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const relative = path.join(ACTIVITY_NOTE_OUTPUT_DIR, `drafts-${stamp}.json`);
  const filePath = containedRepoPath(relative, process.cwd());
  if (!filePath) fail('output path must stay inside the repo');
  return filePath;
}

async function main(): Promise<void> {
  const parsed = parseActivityNoteArgs(process.argv.slice(2));
  if ('error' in parsed) fail(parsed.error);
  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }
  const resolvedModel = resolveActivityNoteModel(process.env);
  if (!resolvedModel.ok) fail(resolvedModel.reason);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  const read = activityNoteReadAllowed(url);
  if (!read.ok) fail(read.reason);
  if (parsed.mode === 'apply') {
    const write = activityNoteWriteAllowed(url);
    if (!write.ok) fail(write.reason);
  }
  if (!key) fail('activity notes need SUPABASE_SERVICE_ROLE_KEY');
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? '';
  if (!apiKey) fail('ANTHROPIC_API_KEY is not set. Dry-run still calls the model and does not use the member AI budget.');
  const supabase = createClient<Database>(url, key);
  const allRestaurants = await loadRestaurants(supabase, []);
  for (const slug of parsed.slugs) {
    if (!allRestaurants.some((restaurant) => restaurant.slug === slug)) {
      fail(`Refused. ${slug} is not an active restaurant.`);
    }
  }
  const restaurants = parsed.slugs.length
    ? allRestaurants.filter((restaurant) => parsed.slugs.includes(restaurant.slug))
    : allRestaurants;
  const activities = await loadActivities(supabase);
  const existing = await loadExisting(supabase, restaurants.map((restaurant) => restaurant.id));
  const startedAt = new Date();
  const summary = await runActivityNoteDrafts({
    restaurants,
    activities,
    restaurantNames: allRestaurants.map((restaurant) => restaurant.name),
    mode: parsed.mode,
    model: resolvedModel.model,
    now: startedAt,
    existing,
    callModel: async (input) => callActivityNoteModel({ ...input, apiKey, model: resolvedModel.model }),
    insertDraft: parsed.mode === 'apply' ? (row) => insertDraft(supabase, row) : undefined,
  });
  const filePath = outputPath(startedAt);
  writeActivityNoteFile(filePath, summary);
  process.stdout.write(formatActivityNoteSummary(summary, path.relative(process.cwd(), filePath)));
}

async function loadRestaurants(
  supabase: SupabaseClient<Database>,
  slugs: readonly string[],
): Promise<(NoteSourceRestaurant & { slug: string })[]> {
  let query = supabase
    .from('restaurants')
    .select('id, name, slug, cuisine_tags, lat, lon, status')
    .eq('status', 'active');
  if (slugs.length > 0) query = query.in('slug', [...slugs]);
  const { data, error } = await query;
  if (error) {
    console.error('[activity-notes] restaurant lookup failed', error.code);
    throw new Error('restaurant lookup failed');
  }
  return (data ?? []).flatMap((row) => {
    if (!row.slug) return [];
    return [{
      id: row.id,
      name: row.name,
      slug: row.slug,
      cuisineTags: row.cuisine_tags ?? [],
      lat: row.lat,
      lon: row.lon,
    }];
  });
}

async function loadActivities(supabase: SupabaseClient<Database>): Promise<NoteSourceActivity[]> {
  const { data, error } = await supabase
    .from('activities')
    .select('id, name, category, source_url, lat, lon, valid_from, valid_until, last_verified_at, status, is_sample, kids_oriented, cost_category')
    .eq('status', 'active');
  if (error) {
    console.error('[activity-notes] activity lookup failed', error.code);
    throw new Error('activity lookup failed');
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    source_url: row.source_url,
    lat: row.lat,
    lon: row.lon,
    valid_from: row.valid_from,
    valid_until: row.valid_until,
    last_verified_at: row.last_verified_at,
    status: row.status,
    is_sample: row.is_sample,
    kids_oriented: row.kids_oriented,
    cost_category: row.cost_category,
  }));
}

async function loadExisting(
  supabase: SupabaseClient<Database>,
  restaurantIds: readonly string[],
): Promise<ExistingActivityNote[]> {
  if (restaurantIds.length === 0) return [];
  const { data, error } = await supabase
    .from('restaurant_activity_notes')
    .select('restaurant_id, status, source_hash')
    .in('restaurant_id', [...restaurantIds]);
  if (error) {
    console.error('[activity-notes] note lookup failed', error.code);
    throw new Error('note lookup failed');
  }
  return (data ?? []).map((row) => ({
    restaurantId: row.restaurant_id,
    status: row.status,
    sourceHash: row.source_hash,
  }));
}

async function insertDraft(
  supabase: SupabaseClient<Database>,
  row: ActivityNoteDraftInsert,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('restaurant_activity_notes')
    .insert(row)
    .select('id')
    .single();
  if (error || !data) {
    console.error('[activity-notes] draft insert failed', error?.code ?? 'unknown');
    throw new Error('draft insert failed');
  }
  return { id: data.id };
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'activity notes failed';
  fail(message);
});
