import path from 'node:path';
import {
  paraphraseUpdates,
  planBaseline,
  planMenuChanges,
  type BaselineWrite,
  type RecipeFactUpdate,
  type RecipeSnapshot,
} from '@/lib/content-pipeline/change-detect';
import { newExceptions, type ExceptionDraft, type OpenExceptionKey } from '@/lib/content-pipeline/exceptions';
import { type DescriptionFact, type DescriptionFactValue } from '@/lib/content-pipeline/facts';
import { classifyMenuFailure, retryableFailure, type FetchOutcome } from '@/lib/content-pipeline/fetch';
import { contentHash } from '@/lib/content-pipeline/hash';
import type { ActivityFactDraft, ActivityFactSnapshot, ActivitySnapshot } from '@/lib/content-pipeline/activity-plan';
import { runActivityRefresh } from '@/lib/content-pipeline/activity-refresh';
import { activeFetchedSource, isActivitySourceKind } from '@/lib/content-pipeline/registry';
import { extractMenuDishes } from '@/lib/recipes/menu-extract';
import { emptyRequestPacer, fetchAllowlistedMenu, type RequestPacer } from '@/lib/recipes/menu-fetch';
import { buildMenuPrompt, estimateTokens, parseMenuModelText } from '@/lib/recipes/menu-generate';
import { hostedSupabaseUrl, containedRepoPath } from '@/lib/recipes/menu-run';
import type { MenuModelCaller } from '@/lib/recipes/menu-run';
import { MENU_MAX_RESTAURANTS } from '@/lib/recipes/menu-run';

export const CONTENT_MAX_SOURCES = MENU_MAX_RESTAURANTS;
export const CONTENT_MAX_RETRIES = 2;
export const CONTENT_MAX_ATTEMPTS = 15;
export const CONTENT_MAX_MODEL_CALLS = CONTENT_MAX_SOURCES;
export const CONTENT_RETRY_BACKOFF_MS = 250;

export const MAINTENANCE_FEATURE_CLASS = 'maintenance';
export const MAINTENANCE_ACCOUNT_TIER = 'ops';

export function maintenanceIdempotencyKey(sourceId: string, contentHashValue: string): string {
  return `e05b2:${sourceId}:${contentHashValue}`;
}

export type ContentSourceRecord = {
  id: string;
  kind: string;
  url: string;
  status: 'active' | 'paused' | 'retired';
  lastAttemptedAt: string | null;
  lastVerifiedAt: string | null;
  lastContentHash: string | null;
};

export type AttemptWrite = {
  sourceId: string;
  attemptedAt: string;
  outcome: FetchOutcome;
  httpStatus: number | null;
  contentHash: string | null;
  errorCode: string | null;
};

export type SourcePatch = {
  lastAttemptedAt: string;
  lastVerifiedAt?: string;
  lastContentHash?: string;
};

export type ApplyDescriptionFact = {
  sourceId: string;
  recipeId: string;
  supersedeFactId: string | null;
  value: DescriptionFactValue;
  evidenceExcerpt: string;
  retrievedAt: string | null;
};

export type RecipePatch = {
  description: string;
  version: number;
  retrievedAt: string;
};

export type RefreshEffects = {
  recordAttempt: (attempt: AttemptWrite) => Promise<void>;
  updateSource: (sourceId: string, patch: SourcePatch) => Promise<void>;
  applyDescriptionFact: (row: ApplyDescriptionFact) => Promise<void>;
  applyActivityFact?: (row: ActivityFactDraft) => Promise<void>;
  openException: (exception: ExceptionDraft) => Promise<void>;
};

export type MaintenanceReservation =
  | {
      ok: true;
      settle: (usage: { input: number; output: number } | null) => Promise<void>;
      release: () => Promise<void>;
    }
  | { ok: false; reason: string };

export type RefreshSourceResult = {
  sourceId: string;
  refused: string | null;
  attempts: AttemptWrite[];
  modelCalls: number;
  modelNeeded: number;
  updates: RecipeFactUpdate[];
  baselines: BaselineWrite[];
  exceptions: ExceptionDraft[];
  verified: boolean;
};

function attempt(args: {
  sourceId: string;
  at: string;
  outcome: FetchOutcome;
  httpStatus?: number | null;
  contentHash?: string | null;
  errorCode?: string | null;
}): AttemptWrite {
  return {
    sourceId: args.sourceId,
    attemptedAt: args.at,
    outcome: args.outcome,
    httpStatus: args.httpStatus ?? null,
    contentHash: args.contentHash ?? null,
    errorCode: args.errorCode ?? null,
  };
}

async function note(
  apply: boolean,
  effects: RefreshEffects | undefined,
  row: AttemptWrite,
  patch: SourcePatch,
  bucket: AttemptWrite[],
): Promise<void> {
  bucket.push(row);
  if (!apply || !effects) return;
  await effects.recordAttempt(row);
  await effects.updateSource(row.sourceId, patch);
}

export async function refreshContentSource(args: {
  source: ContentSourceRecord;
  facts: readonly DescriptionFact[];
  recipes: readonly RecipeSnapshot[];
  activities?: readonly ActivitySnapshot[];
  activityFacts?: readonly ActivityFactSnapshot[];
  openExceptions?: readonly OpenExceptionKey[];
  apply: boolean;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  html?: string | null;
  maxRetries?: number;
  modelCallsUsed?: number;
  callModel?: MenuModelCaller;
  reserveModel?: (input: {
    sourceId: string;
    contentHash: string;
    estimatedInput: number;
    estimatedOutput: number;
  }) => Promise<MaintenanceReservation>;
  effects?: RefreshEffects;
  pacer?: RequestPacer;
}): Promise<RefreshSourceResult> {
  const now = args.now ?? (() => new Date());
  const sleep = args.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const fetchImpl = args.fetchImpl ?? fetch;
  const maxRetries = args.maxRetries ?? CONTENT_MAX_RETRIES;
  const attempts: AttemptWrite[] = [];
  const empty = (refused: string | null): RefreshSourceResult => ({
    sourceId: args.source.id,
    refused,
    attempts,
    modelCalls: 0,
    modelNeeded: 0,
    updates: [],
    baselines: [],
    exceptions: [],
    verified: false,
  });
  const refused = activeFetchedSource(args.source);
  if (refused) return empty(refused);

  let html = args.html ?? null;
  let retrievedAt = html != null ? now().toISOString() : null;
  if (html == null) {
    const pacer = args.pacer ?? emptyRequestPacer();
    let tries = 0;
    for (;;) {
      const fetched = await fetchAllowlistedMenu({
        menuUrl: args.source.url,
        allowlist: [args.source.url],
        fetchImpl,
        now,
        sleep,
        pacer,
      });
      if (fetched.ok) {
        html = fetched.html;
        retrievedAt = fetched.retrievedAt;
        break;
      }
      const failure = classifyMenuFailure(fetched.reason);
      const at = now().toISOString();
      await note(args.apply, args.effects, attempt({
        sourceId: args.source.id,
        at,
        outcome: failure.outcome,
        httpStatus: failure.httpStatus,
        errorCode: failure.errorCode,
      }), { lastAttemptedAt: at }, attempts);
      if (!retryableFailure(failure.outcome) || tries >= maxRetries) return empty(null);
      tries += 1;
      await sleep(CONTENT_RETRY_BACKOFF_MS * 2 ** (tries - 1));
    }
  }
  if (html == null || retrievedAt == null) return empty('page was not fetched');

  const hash = contentHash(html);
  const at = now().toISOString();
  if (args.source.lastContentHash === hash) {
    await note(args.apply, args.effects, attempt({
      sourceId: args.source.id,
      at,
      outcome: 'unchanged',
      httpStatus: 200,
      contentHash: hash,
    }), { lastAttemptedAt: at, lastVerifiedAt: at }, attempts);
    return { ...empty(null), verified: true };
  }

  if (isActivitySourceKind(args.source.kind)) {
    const outcome = await runActivityRefresh({
      sourceId: args.source.id,
      sourceUrl: args.source.url,
      html,
      hash,
      at,
      apply: args.apply,
      activities: args.activities ?? [],
      facts: args.activityFacts ?? [],
      openExceptions: args.openExceptions ?? [],
      modelCallsUsed: args.modelCallsUsed ?? 0,
      maxModelCalls: CONTENT_MAX_MODEL_CALLS,
      callModel: args.callModel,
      reserveModel: args.reserveModel,
      effects: args.effects,
      record: (row, patch) => note(args.apply, args.effects, row, patch, attempts),
    });
    return {
      sourceId: args.source.id,
      refused: null,
      attempts,
      modelCalls: outcome.modelCalls,
      modelNeeded: outcome.modelNeeded,
      updates: [],
      baselines: [],
      exceptions: outcome.exceptions,
      verified: outcome.verified,
    };
  }

  const dishes = extractMenuDishes(html);
  if (dishes.length === 0) {
    await note(args.apply, args.effects, attempt({
      sourceId: args.source.id,
      at,
      outcome: 'parse_error',
      errorCode: 'parse_error',
      contentHash: hash,
    }), { lastAttemptedAt: at }, attempts);
    return empty(null);
  }

  const baseline = planBaseline({
    sourceId: args.source.id,
    sourceUrl: args.source.url,
    dishes,
    facts: args.facts,
    recipes: args.recipes,
  });
  const plan = planMenuChanges({
    sourceId: args.source.id,
    dishes,
    facts: args.facts,
    recipes: args.recipes,
  });
  if (!args.apply && plan.candidates.length > 0) {
    return {
      ...empty(null),
      modelNeeded: plan.candidates.length,
      baselines: baseline.writes,
      exceptions: [...baseline.exceptions, ...plan.exceptions],
    };
  }

  let updates: RecipeFactUpdate[] = [];
  let modelExceptions: ExceptionDraft[] = [];
  let modelCalls = 0;
  let validated = true;
  if (plan.candidates.length > 0) {
    const used = args.modelCallsUsed ?? 0;
    const prompt = buildMenuPrompt({
      restaurantName: plan.candidates[0]?.recipe.title ?? 'Restaurant',
      dishes: plan.candidates.map((candidate) => candidate.dish),
    });
    const estimatedInput = estimateTokens(prompt.system) + estimateTokens(prompt.user);
    const estimatedOutput = plan.candidates.length * 400;
    if (!args.callModel || used >= CONTENT_MAX_MODEL_CALLS) {
      validated = false;
    } else {
      const reservation = args.reserveModel
        ? await args.reserveModel({
            sourceId: args.source.id,
            contentHash: hash,
            estimatedInput,
            estimatedOutput,
          })
        : null;
      if (reservation && !reservation.ok) {
        validated = false;
      } else {
        modelCalls = 1;
        let model: { text: string; usage: { input: number; output: number } | null } | null = null;
        try {
          model = await args.callModel(prompt);
        } catch {
          if (reservation?.ok) await reservation.release();
          validated = false;
        }
        if (model && validated) {
        if (reservation?.ok) {
          if (model.usage) await reservation.settle(model.usage);
          else await reservation.release();
        }
        const parsed = parseMenuModelText(model.text);
        if (parsed.dishes.length === 0) {
          validated = false;
          modelExceptions = plan.candidates.map((candidate) => ({
            sourceId: args.source.id,
            subjectType: 'recipe' as const,
            subjectId: candidate.fact.subjectId,
            field: 'description',
            reason: 'validation_failed' as const,
            before: { text: candidate.fact.text },
            after: null,
            evidenceExcerpt: candidate.dish.name,
          }));
        } else {
          const paraphrased = paraphraseUpdates({
            sourceId: args.source.id,
            candidates: plan.candidates,
            dishes: parsed.dishes,
          });
          updates = paraphrased.updates;
          modelExceptions = paraphrased.exceptions;
        }
        }
      }
    }
  }

  const exceptions = newExceptions(args.openExceptions ?? [], [
    ...baseline.exceptions,
    ...plan.exceptions,
    ...modelExceptions,
  ]);
  if (!validated) {
    await note(args.apply, args.effects, attempt({
      sourceId: args.source.id,
      at,
      outcome: 'parse_error',
      errorCode: 'model_unavailable',
      contentHash: hash,
    }), { lastAttemptedAt: at }, attempts);
    if (args.apply && args.effects) {
      for (const row of newExceptions(args.openExceptions ?? [], [...baseline.exceptions, ...plan.exceptions])) {
        await args.effects.openException(row);
      }
      for (const write of baseline.writes) {
        await args.effects.applyDescriptionFact({
          sourceId: args.source.id,
          recipeId: write.recipeId,
          supersedeFactId: null,
          value: write.value,
          evidenceExcerpt: write.evidenceExcerpt,
          retrievedAt: null,
        });
      }
    }
    return {
      ...empty(null),
      modelCalls,
      modelNeeded: plan.candidates.length,
      baselines: baseline.writes,
      exceptions: [...baseline.exceptions, ...plan.exceptions],
    };
  }

  if (args.apply && args.effects) {
    for (const row of exceptions) await args.effects.openException(row);
    for (const write of baseline.writes) {
      await args.effects.applyDescriptionFact({
        sourceId: args.source.id,
        recipeId: write.recipeId,
        supersedeFactId: null,
        value: write.value,
        evidenceExcerpt: write.evidenceExcerpt,
        retrievedAt: null,
      });
    }
    for (const update of updates) {
      await args.effects.applyDescriptionFact({
        sourceId: update.sourceId,
        recipeId: update.recipeId,
        supersedeFactId: update.factId,
        value: update.value,
        evidenceExcerpt: update.evidenceExcerpt,
        retrievedAt,
      });
    }
  }
  await note(args.apply, args.effects, attempt({
    sourceId: args.source.id,
    at,
    outcome: 'ok',
    httpStatus: 200,
    contentHash: hash,
  }), { lastAttemptedAt: at, lastVerifiedAt: at, lastContentHash: hash }, attempts);
  return {
    sourceId: args.source.id,
    refused: null,
    attempts,
    modelCalls,
    modelNeeded: 0,
    updates,
    baselines: baseline.writes,
    exceptions,
    verified: true,
  };
}

export async function refreshContentSources(args: {
  sources: readonly ContentSourceRecord[];
  load: (source: ContentSourceRecord) => Promise<{
    facts: DescriptionFact[];
    recipes: RecipeSnapshot[];
    openExceptions: OpenExceptionKey[];
    activities?: ActivitySnapshot[];
    activityFacts?: ActivityFactSnapshot[];
  }>;
  apply: boolean;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  htmlBySourceId?: ReadonlyMap<string, string>;
  maxRetries?: number;
  callModel?: MenuModelCaller;
  reserveModel?: RefreshSourceArgs['reserveModel'];
  effects?: RefreshEffects;
}): Promise<{ results: RefreshSourceResult[]; skips: string[] }> {
  const selected = args.sources.slice(0, CONTENT_MAX_SOURCES);
  const skips = args.sources.slice(CONTENT_MAX_SOURCES).map((source) => `${source.id}: source cap`);
  const results: RefreshSourceResult[] = [];
  let modelCalls = 0;
  let attemptCount = 0;
  const pacer = emptyRequestPacer();
  for (const source of selected) {
    if (attemptCount >= CONTENT_MAX_ATTEMPTS) {
      skips.push(`${source.id}: attempt cap`);
      continue;
    }
    const loaded = await args.load(source);
    const result = await refreshContentSource({
      source,
      facts: loaded.facts,
      recipes: loaded.recipes,
      activities: loaded.activities,
      activityFacts: loaded.activityFacts,
      openExceptions: loaded.openExceptions,
      apply: args.apply,
      now: args.now,
      sleep: args.sleep,
      fetchImpl: args.fetchImpl,
      html: args.htmlBySourceId?.get(source.id) ?? null,
      maxRetries: args.maxRetries,
      modelCallsUsed: modelCalls,
      callModel: args.callModel,
      reserveModel: args.reserveModel,
      effects: args.effects,
      pacer,
    });
    modelCalls += result.modelCalls;
    attemptCount += result.attempts.length;
    results.push(result);
  }
  return { results, skips };
}

type RefreshSourceArgs = Parameters<typeof refreshContentSource>[0];

export function contentRefreshAllowed(
  supabaseUrl: string,
  mode: 'read' | 'write',
  env: Record<string, string | undefined> = process.env,
): { ok: true } | { ok: false; reason: string } {
  if (hostedSupabaseUrl(supabaseUrl) && env.WANDERBITE_CONTENT_REFRESH_HOSTED_OK !== '1') {
    return {
      ok: false,
      reason:
        'Refused. Hosted content refresh needs Noah\'s separate OK, then WANDERBITE_CONTENT_REFRESH_HOSTED_OK=1 for that run only.',
    };
  }
  if (mode === 'write' && env.WANDERBITE_CONTENT_REFRESH_APPLY !== '1') {
    return {
      ok: false,
      reason:
        'Refused. Set WANDERBITE_CONTENT_REFRESH_APPLY=1 for a local register, refresh, resolve, rollback, or expire. Hosted writes need Noah\'s OK.',
    };
  }
  return { ok: true };
}

export type ContentRefreshArgs =
  | { help: true }
  | {
      help: false;
      command: 'sources' | 'register' | 'refresh' | 'exceptions' | 'resolve' | 'rollback' | 'expire';
      apply: boolean;
      sourceId: string | null;
      resolveId: string | null;
      resolveAction: 'approve' | 'reject' | null;
      rollbackKind: 'fact' | 'recipe' | null;
      rollbackId: string | null;
      fromFile: string | null;
      registryPath: string;
    };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseContentRefreshArgs(argv: readonly string[]): ContentRefreshArgs | { error: string } {
  let help = false;
  let sources = false;
  let register = false;
  let refresh = false;
  let exceptions = false;
  let resolve = false;
  let rollback = false;
  let expire = false;
  let apply = false;
  let sourceId: string | null = null;
  let resolveId: string | null = null;
  let resolveAction: 'approve' | 'reject' | null = null;
  let rollbackKind: 'fact' | 'recipe' | null = null;
  let rollbackId: string | null = null;
  let fromFile: string | null = null;
  let registryPath = path.join('scripts', 'fixtures', 'e05-menu-sources.json');
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--url' || arg === '--menu-url' || arg.startsWith('--url=') || arg.startsWith('--menu-url=')) {
      return { error: 'Refused. Only a URL already stored in content_sources can be refreshed.' };
    }
    if (arg === '--sources') {
      sources = true;
      continue;
    }
    if (arg === '--register') {
      register = true;
      continue;
    }
    if (arg === '--refresh') {
      refresh = true;
      continue;
    }
    if (arg === '--exceptions') {
      exceptions = true;
      continue;
    }
    if (arg === '--expire') {
      expire = true;
      continue;
    }
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') continue;
    if (arg === '--source') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) return { error: '--source needs a content source id' };
      index += 1;
      if (!UUID_RE.test(value)) return { error: 'source id is not a uuid' };
      sourceId = value;
      continue;
    }
    if (arg === '--resolve') {
      resolve = true;
      const id = argv[index + 1];
      const action = argv[index + 2];
      if (!id || id.startsWith('--') || !action || action.startsWith('--')) {
        return { error: '--resolve needs an exception id and approve or reject' };
      }
      index += 2;
      if (!UUID_RE.test(id)) return { error: 'exception id is not a uuid' };
      if (action !== 'approve' && action !== 'reject') return { error: '--resolve action must be approve or reject' };
      resolveId = id;
      resolveAction = action;
      continue;
    }
    if (arg === '--rollback') {
      rollback = true;
      const kind = argv[index + 1];
      const id = argv[index + 2];
      if (!kind || kind.startsWith('--') || !id || id.startsWith('--')) {
        return { error: '--rollback needs fact or recipe, then an id' };
      }
      index += 2;
      if (kind !== 'fact' && kind !== 'recipe') return { error: '--rollback kind must be fact or recipe' };
      if (!UUID_RE.test(id)) return { error: 'rollback id is not a uuid' };
      rollbackKind = kind;
      rollbackId = id;
      continue;
    }
    if (arg === '--from-file') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) return { error: '--from-file needs a path' };
      index += 1;
      fromFile = value;
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
  const commands = Number(sources) + Number(register) + Number(refresh) + Number(exceptions) + Number(resolve) + Number(rollback) + Number(expire);
  if (commands !== 1) return { error: 'Choose one of --sources, --register, --refresh, --exceptions, --resolve, --rollback, or --expire.' };
  if (fromFile && !refresh) return { error: '--from-file is only valid with --refresh' };
  if (fromFile && !sourceId) return { error: '--from-file needs one --source' };
  if (sourceId && !refresh) return { error: '--source is only valid with --refresh' };
  const command = sources
    ? 'sources'
    : register
      ? 'register'
      : refresh
        ? 'refresh'
        : exceptions
          ? 'exceptions'
          : resolve
            ? 'resolve'
            : rollback
              ? 'rollback'
              : 'expire';
  return {
    help: false,
    command,
    apply,
    sourceId,
    resolveId,
    resolveAction,
    rollbackKind,
    rollbackId,
    fromFile,
    registryPath,
  };
}

export function contentRepoPath(candidate: string, cwd: string): string | null {
  return containedRepoPath(candidate, cwd);
}
