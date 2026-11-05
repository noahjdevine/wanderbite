import {
  activityPageText,
  activitySummaryPublishable,
  buildActivityPrompt,
  parseActivitySummary,
  planActivityPage,
  type ActivityFactDraft,
  type ActivityFactSnapshot,
  type ActivitySnapshot,
} from '@/lib/content-pipeline/activity-plan';
import { newExceptions, type ExceptionDraft, type OpenExceptionKey } from '@/lib/content-pipeline/exceptions';
import { evidenceExcerpt } from '@/lib/content-pipeline/facts';
import type { AttemptWrite, MaintenanceReservation, SourcePatch } from '@/lib/content-pipeline/refresh';
import { estimateTokens } from '@/lib/recipes/menu-generate';
import type { MenuModelCaller } from '@/lib/recipes/menu-run';

export type ActivityRefreshOutcome = {
  modelCalls: number;
  modelNeeded: number;
  exceptions: ExceptionDraft[];
  verified: boolean;
};

type ActivityEffects = {
  openException: (exception: ExceptionDraft) => Promise<void>;
  applyActivityFact?: (row: ActivityFactDraft) => Promise<void>;
};

function attempt(args: {
  sourceId: string;
  at: string;
  outcome: AttemptWrite['outcome'];
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

/**
 * Venue and event pages share the fetch that already happened.
 * A dry-run does not write and does not call the model.
 * Hours, price, and allergen text open exceptions.
 * A summary draft is stored only for an activity that already exists.
 */
export async function runActivityRefresh(args: {
  sourceId: string;
  sourceUrl: string;
  html: string;
  hash: string;
  at: string;
  apply: boolean;
  activities: readonly ActivitySnapshot[];
  facts: readonly ActivityFactSnapshot[];
  openExceptions: readonly OpenExceptionKey[];
  modelCallsUsed?: number;
  maxModelCalls: number;
  callModel?: MenuModelCaller;
  reserveModel?: (input: {
    sourceId: string;
    contentHash: string;
    estimatedInput: number;
    estimatedOutput: number;
  }) => Promise<MaintenanceReservation>;
  effects?: ActivityEffects;
  record: (row: AttemptWrite, patch: SourcePatch) => Promise<void>;
}): Promise<ActivityRefreshOutcome> {
  const text = activityPageText(args.html);
  const plan = planActivityPage({
    sourceId: args.sourceId,
    sourceUrl: args.sourceUrl,
    pageText: text,
    activities: args.activities,
    facts: args.facts,
  });
  if (!text) {
    await args.record(attempt({
      sourceId: args.sourceId,
      at: args.at,
      outcome: 'parse_error',
      errorCode: 'parse_error',
      contentHash: args.hash,
    }), { lastAttemptedAt: args.at });
    return { modelCalls: 0, modelNeeded: 0, exceptions: [], verified: false };
  }

  const exceptions = newExceptions(args.openExceptions, plan.exceptions);
  if (!args.apply) {
    await args.record(attempt({
      sourceId: args.sourceId,
      at: args.at,
      outcome: 'ok',
      httpStatus: 200,
      contentHash: args.hash,
    }), { lastAttemptedAt: args.at });
    return {
      modelCalls: 0,
      modelNeeded: plan.needsDraft ? 1 : 0,
      exceptions,
      verified: false,
    };
  }

  let modelCalls = 0;
  let summary: string | null = null;
  let modelFailed = false;
  if (plan.needsDraft) {
    const prompt = buildActivityPrompt(text);
    const used = args.modelCallsUsed ?? 0;
    if (!args.callModel || !args.reserveModel || used >= args.maxModelCalls) {
      modelFailed = true;
    } else {
      const estimatedInput = estimateTokens(prompt.system) + estimateTokens(prompt.user);
      const reservation = args.reserveModel
        ? await args.reserveModel({
            sourceId: args.sourceId,
            contentHash: args.hash,
            estimatedInput,
            estimatedOutput: 200,
          })
        : null;
      if (reservation && !reservation.ok) {
        modelFailed = true;
      } else {
        modelCalls = 1;
        try {
          const model = await args.callModel(prompt);
          if (reservation?.ok) {
            if (model.usage) await reservation.settle(model.usage);
            else await reservation.release();
          }
          summary = parseActivitySummary(model.text);
          if (!summary) modelFailed = true;
        } catch {
          if (reservation?.ok) await reservation.release();
          modelFailed = true;
        }
      }
    }
  }

  if (modelFailed) {
    await args.record(attempt({
      sourceId: args.sourceId,
      at: args.at,
      outcome: 'parse_error',
      errorCode: 'model_unavailable',
      contentHash: args.hash,
    }), { lastAttemptedAt: args.at });
    if (args.effects) {
      for (const row of exceptions) await args.effects.openException(row);
    }
    return { modelCalls, modelNeeded: 1, exceptions, verified: false };
  }

  const drafts: ExceptionDraft[] = [...exceptions];
  let fact: ActivityFactDraft | null = null;
  if (summary && plan.activityId) {
    if (!activitySummaryPublishable(summary)) {
      drafts.push({
        sourceId: args.sourceId,
        subjectType: 'activity',
        subjectId: plan.activityId,
        field: 'summary',
        reason: 'sensitive',
        before: null,
        after: { text: summary },
        evidenceExcerpt: evidenceExcerpt(summary),
      });
    } else {
      fact = {
        sourceId: args.sourceId,
        activityId: plan.activityId,
        field: 'summary',
        text: summary,
        evidenceExcerpt: evidenceExcerpt(text),
      };
    }
  }

  const opening = newExceptions(args.openExceptions, drafts);
  if (args.effects) {
    for (const row of opening) await args.effects.openException(row);
    if (fact && args.effects.applyActivityFact) await args.effects.applyActivityFact(fact);
  }
  await args.record(attempt({
    sourceId: args.sourceId,
    at: args.at,
    outcome: 'ok',
    httpStatus: 200,
    contentHash: args.hash,
  }), { lastAttemptedAt: args.at, lastVerifiedAt: args.at, lastContentHash: args.hash });
  return { modelCalls, modelNeeded: 0, exceptions: opening, verified: true };
}
