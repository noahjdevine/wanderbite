import {
  dietaryClaim,
  extractPrice,
  hoursSuspected,
  injectionSuspected,
} from '@/lib/content-pipeline/change-detect';
import {
  descriptionFactValue,
  evidenceExcerpt,
  formatContentInstant,
  type DescriptionFact,
  type DescriptionFactValue,
} from '@/lib/content-pipeline/facts';
import { contentHash } from '@/lib/content-pipeline/hash';
import { MENU_WORDING_PARAPHRASE } from '@/lib/recipes/display';
import { descriptionCopiesMenu } from '@/lib/recipes/menu-paraphrase';
import type { AdminAuditAction } from '@/lib/audit/log-admin-action';
import type { Json } from '@/types/database.types';

import {
  EXCEPTION_REASONS,
  NOTHING_PUBLISHED,
  type ContentReviewModel,
  type ExceptionView,
  type RecipeHistoryView,
  type SourceView,
} from '@/lib/content-pipeline/review-model';

export const RECIPE_DESCRIPTION_MAX = 400;
export const CONTENT_REFRESH_JOB = 'content-refresh';
export { NOTHING_PUBLISHED };

const CHICAGO_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function contentRefreshCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.E05_CONTENT_REFRESH_CRON_ENABLED === 'true';
}

/** Exact string only. Unset, empty, and every other value leave activity maintenance off. */
export function activityMaintenanceCronEnabled(
  value: string | undefined = process.env.E06_ACTIVITY_MAINTENANCE_CRON_ENABLED,
): boolean {
  return value === 'true';
}

/** One leased run per America/Chicago calendar day. Independent of process TZ. */
export function contentRefreshRunKey(now = new Date()): string {
  const parts = CHICAGO_DAY.formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${CONTENT_REFRESH_JOB}:${year}-${month}-${day}`;
}

export function untrustedPlainText(value: Json | string | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

export function reviewValueHash(value: Json | string | null | undefined): string {
  return contentHash(untrustedPlainText(value));
}

export function safeSourceHref(url: string): string | null {
  return /^https:\/\/[^\s]+$/.test(url) ? url : null;
}

export type StoredException = {
  id: string;
  sourceId: string;
  subjectId: string | null;
  field: string | null;
  reason: string;
  before: Json | null;
  after: Json | null;
  evidenceExcerpt: string | null;
  status: string;
};

export type RecipeGuard = {
  id: string;
  title: string;
  description: string | null;
  version: number;
  visibility: string;
  recipeType: string;
  sourceKind: string | null;
  menuWording: string | null;
  sourceUrl: string | null;
  restaurantId: string | null;
};

export type ContentAuditEntry = {
  adminId: string;
  action: AdminAuditAction;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
};

export type ContentReviewStore = {
  loadException(id: string): Promise<StoredException | null>;
  loadRecipe(id: string): Promise<RecipeGuard | null>;
  loadCurrentFact(sourceId: string, recipeId: string): Promise<DescriptionFact | null>;
  claimException(id: string, status: 'approved' | 'edited' | 'rejected', adminId: string): Promise<boolean>;
  reopenException(id: string): Promise<void>;
  applyDescriptionFact(row: {
    sourceId: string;
    recipeId: string;
    supersedeFactId: string;
    value: DescriptionFactValue;
    evidenceExcerpt: string;
  }): Promise<string>;
  rollbackRecipe(recipeId: string): Promise<number>;
  loadSource(id: string): Promise<{ id: string; status: string } | null>;
  setSourceStatus(id: string, from: string, to: 'active' | 'paused'): Promise<boolean>;
  audit(entry: ContentAuditEntry): Promise<void>;
};

export type ContentActionResult =
  | { ok: true; published: boolean; notice: string }
  | { ok: false; error: string };

type PublishPlan = {
  recipeId: string;
  description: string;
  value: DescriptionFactValue;
  evidenceExcerpt: string;
  supersedeFactId: string;
};

type ApprovePlan = { kind: 'review_only' };

function menuContext(fact: DescriptionFact): { menuDescription: string; prose: string } {
  return {
    menuDescription: fact.menuDescription,
    prose: [fact.dish, fact.menuDescription, fact.ingredients.join(' ')].filter(Boolean).join(' '),
  };
}

export function descriptionPublishError(
  text: string,
  menu?: { menuDescription: string; prose: string } | null,
): string | null {
  if (!text) return 'Description is required.';
  if (text.length > RECIPE_DESCRIPTION_MAX) {
    return `Description must be ${RECIPE_DESCRIPTION_MAX} characters or fewer.`;
  }
  if (injectionSuspected(text) || dietaryClaim(text) || hoursSuspected(text) || extractPrice(text)) {
    return 'That text is not a publishable paraphrase.';
  }
  if (menu && descriptionCopiesMenu(text, menu.menuDescription, menu.prose)) {
    return 'That text repeats the menu. Write a paraphrase.';
  }
  return null;
}

function recipePublishError(recipe: RecipeGuard | null): string | null {
  if (!recipe) return 'That recipe was not found.';
  if (recipe.recipeType !== 'inspired_by' || recipe.sourceKind !== 'public_menu') {
    return 'Only an inspired-by public menu recipe can take a description from this view.';
  }
  if (recipe.menuWording !== MENU_WORDING_PARAPHRASE) {
    return 'Menu wording must stay a paraphrase.';
  }
  return null;
}

/**
 * Refresh opens conflicts on price and ingredients, plus missing, sensitive,
 * injection, and validation rows. None of those carry a paraphrase to publish.
 * Edit is the publish path.
 */
export function planApprove(
  _exception: StoredException,
  _recipe: RecipeGuard | null,
  _fact: DescriptionFact | null,
): ApprovePlan {
  return { kind: 'review_only' };
}

export function approvePublishes(
  exception: StoredException,
  recipe: RecipeGuard | null,
  fact: DescriptionFact | null,
): boolean {
  return planApprove(exception, recipe, fact).kind !== 'review_only';
}

function editPlan(
  exception: StoredException,
  recipe: RecipeGuard | null,
  fact: DescriptionFact | null,
  description: string,
): PublishPlan | { error: string } {
  const guard = recipePublishError(recipe);
  if (guard) return { error: guard };
  if (!fact || !recipe) return { error: 'No current description to replace.' };
  if (fact.version !== recipe.version) return { error: 'Description fact version does not match the recipe version.' };
  const text = description.trim();
  const textError = descriptionPublishError(text, menuContext(fact));
  if (textError) return { error: textError };
  return {
    recipeId: recipe.id,
    description: text,
    value: { ...descriptionFactValue(fact), text },
    evidenceExcerpt: evidenceExcerpt(exception.evidenceExcerpt || text),
    supersedeFactId: fact.id,
  };
}

async function context(store: ContentReviewStore, exception: StoredException): Promise<{
  recipe: RecipeGuard | null;
  fact: DescriptionFact | null;
}> {
  if (!exception.subjectId) return { recipe: null, fact: null };
  const recipe = await store.loadRecipe(exception.subjectId);
  const fact = await store.loadCurrentFact(exception.sourceId, exception.subjectId);
  return { recipe, fact };
}

function hashes(before: Json | null, after: Json | string | null): { beforeHash: string; afterHash: string } {
  return { beforeHash: reviewValueHash(before), afterHash: reviewValueHash(after) };
}

export async function approveOpenException(
  store: ContentReviewStore,
  input: { exceptionId: string; adminId: string },
): Promise<ContentActionResult> {
  const exception = await store.loadException(input.exceptionId);
  if (!exception) return { ok: false, error: 'Exception not found.' };
  if (exception.status !== 'open') return { ok: false, error: 'Already resolved.' };
  const { recipe, fact } = await context(store, exception);
  if (planApprove(exception, recipe, fact).kind !== 'review_only') {
    return { ok: false, error: 'Approve does not publish.' };
  }
  const claimed = await store.claimException(exception.id, 'approved', input.adminId);
  if (!claimed) return { ok: false, error: 'Already resolved.' };
  try {
    await store.audit({
      adminId: input.adminId,
      action: 'content.exception_approve',
      targetType: 'content_exception',
      targetId: exception.id,
      metadata: {
        adminId: input.adminId,
        exceptionId: exception.id,
        published: false,
        reason: exception.reason,
        field: exception.field,
        ...hashes(exception.before, exception.after),
      },
    });
  } catch (err) {
    await store.reopenException(exception.id);
    const message = err instanceof Error ? err.message : 'Audit row was not written.';
    return { ok: false, error: message };
  }
  return { ok: true, published: false, notice: `Approved. ${NOTHING_PUBLISHED}` };
}

export async function editOpenException(
  store: ContentReviewStore,
  input: { exceptionId: string; adminId: string; description: string },
): Promise<ContentActionResult> {
  const exception = await store.loadException(input.exceptionId);
  if (!exception) return { ok: false, error: 'Exception not found.' };
  if (exception.status !== 'open') return { ok: false, error: 'Already resolved.' };
  const { recipe, fact } = await context(store, exception);
  const planned = editPlan(exception, recipe, fact, input.description);
  if ('error' in planned) return { ok: false, error: planned.error };
  return publishClaim(store, {
    exception,
    adminId: input.adminId,
    status: 'edited',
    action: 'content.exception_edit',
    plan: planned,
    notice: 'Published the edited paraphrase.',
  });
}

export async function rejectOpenException(
  store: ContentReviewStore,
  input: { exceptionId: string; adminId: string },
): Promise<ContentActionResult> {
  const exception = await store.loadException(input.exceptionId);
  if (!exception) return { ok: false, error: 'Exception not found.' };
  if (exception.status !== 'open') return { ok: false, error: 'Already resolved.' };
  const claimed = await store.claimException(exception.id, 'rejected', input.adminId);
  if (!claimed) return { ok: false, error: 'Already resolved.' };
  await store.audit({
    adminId: input.adminId,
    action: 'content.exception_reject',
    targetType: 'content_exception',
    targetId: exception.id,
    metadata: {
      adminId: input.adminId,
      exceptionId: exception.id,
      published: false,
      reason: exception.reason,
      ...hashes(exception.before, exception.after),
    },
  });
  return { ok: true, published: false, notice: `Rejected. ${NOTHING_PUBLISHED}` };
}

async function publishClaim(
  store: ContentReviewStore,
  input: {
    exception: StoredException;
    adminId: string;
    status: 'approved' | 'edited';
    action: 'content.exception_approve' | 'content.exception_edit';
    plan: PublishPlan;
    notice: string;
  },
): Promise<ContentActionResult> {
  const claimed = await store.claimException(input.exception.id, input.status, input.adminId);
  if (!claimed) return { ok: false, error: 'Already resolved.' };
  let factId: string;
  try {
    factId = await store.applyDescriptionFact({
      sourceId: input.exception.sourceId,
      recipeId: input.plan.recipeId,
      supersedeFactId: input.plan.supersedeFactId,
      value: input.plan.value,
      evidenceExcerpt: input.plan.evidenceExcerpt,
    });
  } catch (err) {
    await store.reopenException(input.exception.id);
    const message = err instanceof Error ? err.message : 'Description fact was not published.';
    return { ok: false, error: message };
  }
  // apply_recipe_description_fact already superseded the fact and bumped the
  // recipe in that one call. Reopening would offer a second publish.
  try {
    await store.audit({
      adminId: input.adminId,
      action: input.action,
      targetType: 'content_exception',
      targetId: input.exception.id,
      metadata: {
        adminId: input.adminId,
        exceptionId: input.exception.id,
        published: true,
        reason: input.exception.reason,
        factId,
        supersedeFactId: input.plan.supersedeFactId,
        recipeId: input.plan.recipeId,
        ...hashes(input.exception.before, input.plan.value),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Audit row was not written.';
    return { ok: false, error: `The description was published. ${message}` };
  }
  return { ok: true, published: true, notice: input.notice };
}

export async function rollbackRecipeDescription(
  store: ContentReviewStore,
  input: { recipeId: string; adminId: string },
): Promise<ContentActionResult> {
  const recipe = await store.loadRecipe(input.recipeId);
  if (!recipe) return { ok: false, error: 'Recipe not found.' };
  const guard = recipePublishError(recipe);
  if (guard) return { ok: false, error: guard };
  const beforeHash = reviewValueHash(recipe.description);
  try {
    const version = await store.rollbackRecipe(recipe.id);
    await store.audit({
      adminId: input.adminId,
      action: 'content.recipe_rollback',
      targetType: 'recipe',
      targetId: recipe.id,
      metadata: {
        adminId: input.adminId,
        recipeId: recipe.id,
        beforeVersion: recipe.version,
        afterVersion: version,
        beforeHash,
      },
    });
    return { ok: true, published: true, notice: `Restored the previous description as version ${version}.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Recipe rollback failed.';
    return { ok: false, error: message };
  }
}

export async function setContentSourceRunning(
  store: ContentReviewStore,
  input: { sourceId: string; adminId: string; status: 'active' | 'paused' },
): Promise<ContentActionResult> {
  const source = await store.loadSource(input.sourceId);
  if (!source) return { ok: false, error: 'Source not found.' };
  if (source.status === 'retired') return { ok: false, error: 'A retired source stays retired.' };
  if (source.status === input.status) {
    return { ok: false, error: input.status === 'paused' ? 'Already paused.' : 'Already active.' };
  }
  if (source.status !== 'active' && source.status !== 'paused') {
    return { ok: false, error: 'Source status cannot change from this view.' };
  }
  const updated = await store.setSourceStatus(input.sourceId, source.status, input.status);
  if (!updated) return { ok: false, error: 'Source status changed. Refresh and try again.' };
  await store.audit({
    adminId: input.adminId,
    action: input.status === 'paused' ? 'content.source_pause' : 'content.source_resume',
    targetType: 'content_source',
    targetId: input.sourceId,
    metadata: {
      adminId: input.adminId,
      sourceId: input.sourceId,
      from: source.status,
      to: input.status,
    },
  });
  return {
    ok: true,
    published: false,
    notice: input.status === 'paused' ? 'Source paused.' : 'Source resumed.',
  };
}

export type ReviewSourceRow = {
  id: string;
  url: string;
  status: string;
  restaurantId: string | null;
  lastAttemptedAt: string | null;
  lastVerifiedAt: string | null;
};

export type ReviewExceptionRow = {
  id: string;
  sourceId: string;
  subjectId: string | null;
  field: string | null;
  reason: string;
  before: Json | null;
  after: Json | null;
  evidenceExcerpt: string | null;
  status: string;
};

export type { ContentReviewModel, ExceptionView, RecipeHistoryView, SourceView };

function restaurantName(names: ReadonlyMap<string, string>, id: string | null): string {
  if (!id) return 'No restaurant';
  return names.get(id) ?? 'Unknown restaurant';
}

function recipeLabel(recipe: RecipeGuard | null, fact: DescriptionFact | null): string {
  if (!recipe) return 'No linked recipe';
  const factLabel = fact ? `fact version ${fact.version}` : 'no current fact';
  return `${recipe.title} · recipe version ${recipe.version} · ${factLabel}`;
}

export function assembleContentReview(input: {
  exceptions: readonly ReviewExceptionRow[];
  sources: readonly ReviewSourceRow[];
  recipes: readonly RecipeGuard[];
  facts: readonly DescriptionFact[];
  restaurantNames: ReadonlyMap<string, string>;
}): ContentReviewModel {
  const sourcesById = new Map(input.sources.map((source) => [source.id, source]));
  const recipesById = new Map(input.recipes.map((recipe) => [recipe.id, recipe]));
  const exceptions = input.exceptions
    .filter((row) => row.status === 'open')
    .map((row) => {
      const source = sourcesById.get(row.sourceId);
      const recipe = row.subjectId ? recipesById.get(row.subjectId) ?? null : null;
      const fact = row.subjectId
        ? input.facts.find(
            (item) => item.status === 'current' && item.subjectId === row.subjectId && item.sourceId === row.sourceId,
          ) ?? null
        : null;
      const guardOk = recipePublishError(recipe) == null;
      return {
        sortAt: source?.lastAttemptedAt ?? '',
        view: {
          id: row.id,
          restaurantName: restaurantName(input.restaurantNames, source?.restaurantId ?? recipe?.restaurantId ?? null),
          sourceUrl: source?.url ?? '',
          sourceHref: source ? safeSourceHref(source.url) : null,
          reason: row.reason,
          field: row.field,
          beforeText: untrustedPlainText(row.before),
          afterText: untrustedPlainText(row.after),
          evidenceText: row.evidenceExcerpt ?? '',
          attemptedLabel: formatContentInstant(source?.lastAttemptedAt),
          verifiedLabel: formatContentInstant(source?.lastVerifiedAt),
          recipeLabel: recipeLabel(recipe, fact),
          approveKind: 'review_only',
          approveBlock: null,
          canEdit: Boolean(guardOk && fact && recipe && fact.version === recipe.version),
        } satisfies ExceptionView,
      };
    })
    .sort((left, right) => {
      if (left.sortAt !== right.sortAt) return right.sortAt < left.sortAt ? -1 : 1;
      return right.view.id < left.view.id ? -1 : 1;
    })
    .map((row) => row.view);

  const sources = [...input.sources]
    .sort((left, right) => left.url.localeCompare(right.url))
    .map((source) => ({
      id: source.id,
      url: source.url,
      sourceHref: safeSourceHref(source.url),
      status: source.status,
      restaurantName: restaurantName(input.restaurantNames, source.restaurantId),
      attemptedLabel: formatContentInstant(source.lastAttemptedAt),
      verifiedLabel: formatContentInstant(source.lastVerifiedAt),
      canPause: source.status === 'active',
      canResume: source.status === 'paused',
    }));

  const history = input.recipes
    .map((recipe) => {
      const series = input.facts
        .filter((fact) => fact.subjectId === recipe.id)
        .sort((left, right) => left.version - right.version);
      const current = series.filter((fact) => fact.status === 'current').at(-1) ?? null;
      const previous = current
        ? series.filter((fact) => fact.version < current.version).at(-1) ?? null
        : null;
      return {
        recipeId: recipe.id,
        title: recipe.title,
        restaurantName: restaurantName(input.restaurantNames, recipe.restaurantId),
        version: recipe.version,
        visibility: recipe.visibility,
        recipeType: recipe.recipeType,
        menuWording: recipe.menuWording,
        description: recipe.description ?? '',
        factVersion: current?.version ?? null,
        previousVersion: previous?.version ?? null,
        canRollback: Boolean(previous && recipePublishError(recipe) == null && current?.version === recipe.version),
      } satisfies RecipeHistoryView;
    })
    .sort((left, right) => left.title.localeCompare(right.title));

  return { exceptions, sources, history, reasons: EXCEPTION_REASONS };
}
