import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ACTIVITY_NOTE_MODEL,
  ACTIVITY_NOTE_PROMPT_VERSION,
  ACTIVITY_NOTE_WALK_DISTANCE_RULE,
  activityNoteSourceHash,
  buildActivityNotePrompt,
  isActivityNoteRetryReason,
  parseActivityNoteDraft,
} from '@/lib/activities/note-copy';
import { eligibleNoteActivities, type NoteSourceActivity, type NoteSourceRestaurant } from '@/lib/activities/note-eligible';

export const ACTIVITY_NOTE_SCHEMA = 'wanderbite.e06.activity_notes.v1';
export const ACTIVITY_NOTE_OUTPUT_DIR = '.activity-notes';
export const ACTIVITY_NOTE_RESTAURANT_CAP = 20;

const HOSTED_PROJECT_REF = 'yiajoycgiyxjvznndjge';

export type ActivityNoteModelCaller = (input: {
  system: string;
  user: string;
}) => Promise<{ text: string; usage: { input: number; output: number } | null }>;

export type ActivityNoteDraftInsert = {
  restaurant_id: string;
  body: string;
  status: 'draft';
  activity_ids: string[];
  model: string;
  prompt_version: string;
  source_hash: string;
  is_sample: false;
  version: 1;
};

export type ExistingActivityNote = {
  restaurantId: string;
  status: string;
  sourceHash: string;
};

export type ActivityNoteRestaurantResult = {
  restaurantId: string;
  restaurantName: string;
  sourceHash: string | null;
  draft: ActivityNoteDraftInsert | null;
  insertedId: string | null;
  skips: string[];
};

export type ActivityNoteRunSummary = {
  schema: typeof ACTIVITY_NOTE_SCHEMA;
  mode: 'dry-run' | 'apply';
  model: string;
  generatedAt: string;
  dbWrites: number;
  restaurants: ActivityNoteRestaurantResult[];
  skips: string[];
};

export function hostedActivityNoteUrl(supabaseUrl: string): boolean {
  if (supabaseUrl.includes(HOSTED_PROJECT_REF)) return true;
  try {
    const host = new URL(supabaseUrl).hostname;
    return host.endsWith('.supabase.co') || host.endsWith('.supabase.com');
  } catch {
    return true;
  }
}

export function activityNoteReadAllowed(
  supabaseUrl: string,
  env: Record<string, string | undefined> = process.env,
): { ok: true } | { ok: false; reason: string } {
  const url = supabaseUrl.trim();
  if (!url) return { ok: false, reason: 'Refused. NEXT_PUBLIC_SUPABASE_URL is not set.' };
  if (hostedActivityNoteUrl(url) && env.WANDERBITE_ACTIVITY_NOTES_HOSTED_OK !== '1') {
    return {
      ok: false,
      reason:
        "Refused. A hosted or supabase.co URL needs Noah's separate OK, then WANDERBITE_ACTIVITY_NOTES_HOSTED_OK=1 for that run only.",
    };
  }
  return { ok: true };
}

export function activityNoteWriteAllowed(
  supabaseUrl: string,
  env: Record<string, string | undefined> = process.env,
): { ok: true } | { ok: false; reason: string } {
  if (env.WANDERBITE_ACTIVITY_NOTES_APPLY !== '1') {
    return {
      ok: false,
      reason:
        "Refused. Set WANDERBITE_ACTIVITY_NOTES_APPLY=1 for a local apply. Hosted writes need Noah's OK.",
    };
  }
  if (hostedActivityNoteUrl(supabaseUrl) && env.WANDERBITE_ACTIVITY_NOTES_HOSTED_OK !== '1') {
    return {
      ok: false,
      reason:
        "Refused. Hosted apply needs Noah's separate OK, then WANDERBITE_ACTIVITY_NOTES_HOSTED_OK=1 for that run only.",
    };
  }
  return { ok: true };
}

export async function runActivityNoteDrafts(args: {
  restaurants: readonly NoteSourceRestaurant[];
  activities: readonly NoteSourceActivity[];
  restaurantNames: readonly string[];
  mode: 'dry-run' | 'apply';
  model?: string;
  now?: Date;
  callModel: ActivityNoteModelCaller;
  existing?: readonly ExistingActivityNote[];
  insertDraft?: (row: ActivityNoteDraftInsert) => Promise<{ id: string }>;
}): Promise<ActivityNoteRunSummary> {
  const now = args.now ?? new Date();
  const modelId = args.model?.trim() || ACTIVITY_NOTE_MODEL;
  const existing = args.existing ?? [];
  const selected = args.restaurants.slice(0, ACTIVITY_NOTE_RESTAURANT_CAP);
  const skips = args.restaurants.slice(ACTIVITY_NOTE_RESTAURANT_CAP).map(
    (restaurant) => `${restaurant.name}: restaurant cap (${ACTIVITY_NOTE_RESTAURANT_CAP})`,
  );
  const restaurants: ActivityNoteRestaurantResult[] = [];
  let dbWrites = 0;
  for (const restaurant of selected) {
    const result: ActivityNoteRestaurantResult = {
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      sourceHash: null,
      draft: null,
      insertedId: null,
      skips: [],
    };
    const candidates = eligibleNoteActivities({
      restaurant,
      activities: args.activities,
      restaurantNames: args.restaurantNames,
      now,
    });
    if (candidates.length === 0) {
      result.skips.push('no currently showing nearby activity');
      restaurants.push(result);
      continue;
    }
    const sourceHash = activityNoteSourceHash({
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      cuisineTags: restaurant.cuisineTags,
      activities: candidates,
    });
    result.sourceHash = sourceHash;
    const prior = existing.filter((row) => row.restaurantId === restaurant.id);
    if (prior.some((row) => row.status === 'draft')) {
      result.skips.push('a draft is already open');
      restaurants.push(result);
      continue;
    }
    if (prior.some((row) => row.sourceHash === sourceHash)) {
      result.skips.push('this source was already drafted');
      restaurants.push(result);
      continue;
    }
    const prompt = buildActivityNotePrompt({
      restaurantName: restaurant.name,
      cuisineTags: restaurant.cuisineTags,
      activities: candidates,
    });
    const otherRestaurantNames = args.restaurantNames.filter((name) => name !== restaurant.name);
    const firstText = await args.callModel(prompt);
    let parsed = parseActivityNoteDraft(firstText.text, { candidates, otherRestaurantNames });
    if (!parsed.ok && isActivityNoteRetryReason(parsed.reason)) {
      const retry = await args.callModel({
        system: prompt.system,
        user: `${prompt.user}\n\nThe previous draft was blocked: ${parsed.reason} Write a new note that fixes that. Do not use a banned opening or closer. ${ACTIVITY_NOTE_WALK_DISTANCE_RULE}\n`,
      });
      parsed = parseActivityNoteDraft(retry.text, { candidates, otherRestaurantNames });
      if (!parsed.ok) parsed = { ok: false, reason: `blocked: ${parsed.reason}` };
    }
    if (!parsed.ok) {
      result.skips.push(parsed.reason);
      restaurants.push(result);
      continue;
    }
    const draft: ActivityNoteDraftInsert = {
      restaurant_id: restaurant.id,
      body: parsed.body,
      status: 'draft',
      activity_ids: parsed.activityIds,
      model: modelId,
      prompt_version: ACTIVITY_NOTE_PROMPT_VERSION,
      source_hash: sourceHash,
      is_sample: false,
      version: 1,
    };
    result.draft = draft;
    if (args.mode === 'apply') {
      if (!args.insertDraft) {
        result.skips.push('apply writer missing');
        result.draft = null;
      } else {
        const inserted = await args.insertDraft(draft);
        result.insertedId = inserted.id;
        dbWrites += 1;
      }
    }
    restaurants.push(result);
  }
  return {
    schema: ACTIVITY_NOTE_SCHEMA,
    mode: args.mode,
    model: modelId,
    generatedAt: now.toISOString(),
    dbWrites,
    restaurants,
    skips,
  };
}

export function writeActivityNoteFile(filePath: string, summary: ActivityNoteRunSummary): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function formatActivityNoteSummary(summary: ActivityNoteRunSummary, outputPath: string | null): string {
  const lines = summary.restaurants.map((restaurant) => {
    const drafted = restaurant.draft ? 1 : 0;
    return `restaurant=${restaurant.restaurantName} drafts=${drafted} skips=${restaurant.skips.length}`;
  });
  for (const restaurant of summary.restaurants) {
    for (const skip of restaurant.skips) lines.push(`  skip: ${restaurant.restaurantName}: ${skip}`);
  }
  for (const skip of summary.skips) lines.push(`skip: ${skip}`);
  lines.push(`mode=${summary.mode} model=${summary.model} db_writes=${summary.dbWrites}`);
  if (outputPath) lines.push(`wrote ${outputPath}`);
  return `${lines.join('\n')}\n`;
}

export function parseActivityNoteArgs(argv: readonly string[]): { help: true } | { help: false; mode: 'dry-run' | 'apply'; slugs: string[] } | { error: string } {
  let help = false;
  let apply = false;
  let dryRun = false;
  const slugs: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--slug') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) return { error: '--slug needs a restaurant slug' };
      index += 1;
      slugs.push(...value.split(',').map((part) => part.trim()).filter(Boolean));
      continue;
    }
    return { error: `Unknown argument: ${arg}` };
  }
  if (help) return { help: true };
  if (apply && dryRun) return { error: 'Choose one of --dry-run or --apply.' };
  return { help: false, mode: apply ? 'apply' : 'dry-run', slugs };
}

export function containedRepoPath(candidate: string, cwd: string): string | null {
  const resolved = path.resolve(cwd, candidate);
  const relative = path.relative(cwd, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}
