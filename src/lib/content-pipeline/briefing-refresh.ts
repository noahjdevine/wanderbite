import {
  briefingValue,
  planBriefingUpdate,
  type BriefingDraft,
  type StoredBriefing,
} from '@/lib/content-pipeline/briefing-plan';
import { newExceptions, type ExceptionDraft, type OpenExceptionKey } from '@/lib/content-pipeline/exceptions';
import type { AttemptWrite, MaintenanceReservation, SourcePatch } from '@/lib/content-pipeline/refresh';
import {
  BRIEFING_PAGE_CHARS,
  briefingSystemPrompt,
  briefingUserPrompt,
  filterSupportedFacts,
  htmlToText,
  normalizeHttpsUrl,
  parseBriefingModelJson,
} from '@/lib/briefings/research';
import { estimateTokens } from '@/lib/recipes/menu-generate';
import type { MenuModelCaller } from '@/lib/recipes/menu-run';

export type BriefingRefreshOutcome = {
  modelCalls: number;
  modelNeeded: number;
  exceptions: ExceptionDraft[];
  drafts: BriefingDraft[];
  verified: boolean;
};

type BriefingEffects = {
  openException: (exception: ExceptionDraft) => Promise<void>;
  applyBriefingFact?: (row: BriefingDraft) => Promise<void>;
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
 * One maintenance call against the fetched page text. No web search and no Places call.
 * A dry-run does not call the model and does not write.
 */
export async function runBriefingRefresh(args: {
  sourceId: string;
  sourceUrl: string;
  restaurantId: string | null;
  restaurantName?: string;
  html: string;
  hash: string;
  at: string;
  apply: boolean;
  stored: readonly StoredBriefing[];
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
  effects?: BriefingEffects;
  record: (row: AttemptWrite, patch: SourcePatch) => Promise<void>;
}): Promise<BriefingRefreshOutcome> {
  const pageUrl = normalizeHttpsUrl(args.sourceUrl);
  const pageText = htmlToText(args.html).slice(0, BRIEFING_PAGE_CHARS);
  if (!args.restaurantId || !pageUrl || !pageText) {
    await args.record(attempt({
      sourceId: args.sourceId,
      at: args.at,
      outcome: 'parse_error',
      errorCode: 'parse_error',
      contentHash: args.hash,
    }), { lastAttemptedAt: args.at });
    return { modelCalls: 0, modelNeeded: 0, exceptions: [], drafts: [], verified: false };
  }

  const blocked = planBriefingUpdate({
    sourceId: args.sourceId,
    restaurantId: args.restaurantId,
    pageText,
    grounded: [],
    stored: args.stored,
  });
  if (blocked.exceptions.some((row) => row.reason === 'injection_suspected') && blocked.drafts.length === 0) {
    const exceptions = newExceptions(args.openExceptions, blocked.exceptions);
    if (!args.apply) {
      await args.record(attempt({
        sourceId: args.sourceId,
        at: args.at,
        outcome: 'ok',
        httpStatus: 200,
        contentHash: args.hash,
      }), { lastAttemptedAt: args.at });
      return { modelCalls: 0, modelNeeded: 0, exceptions, drafts: [], verified: false };
    }
    if (args.effects) {
      for (const row of exceptions) await args.effects.openException(row);
    }
    await args.record(attempt({
      sourceId: args.sourceId,
      at: args.at,
      outcome: 'ok',
      httpStatus: 200,
      contentHash: args.hash,
    }), { lastAttemptedAt: args.at, lastVerifiedAt: args.at, lastContentHash: args.hash });
    return { modelCalls: 0, modelNeeded: 0, exceptions, drafts: [], verified: true };
  }

  if (!args.apply) {
    await args.record(attempt({
      sourceId: args.sourceId,
      at: args.at,
      outcome: 'ok',
      httpStatus: 200,
      contentHash: args.hash,
    }), { lastAttemptedAt: args.at });
    return { modelCalls: 0, modelNeeded: 1, exceptions: [], drafts: [], verified: false };
  }

  const prompt = {
    system: briefingSystemPrompt(),
    user: briefingUserPrompt(
      { id: args.restaurantId, name: args.restaurantName?.trim() || 'Restaurant', address: null, lat: null, lon: null },
      [{ url: pageUrl, text: pageText }],
    ),
  };
  const used = args.modelCallsUsed ?? 0;
  if (!args.callModel || !args.reserveModel || used >= args.maxModelCalls) {
    await args.record(attempt({
      sourceId: args.sourceId,
      at: args.at,
      outcome: 'parse_error',
      errorCode: 'model_unavailable',
      contentHash: args.hash,
    }), { lastAttemptedAt: args.at });
    return { modelCalls: 0, modelNeeded: 1, exceptions: [], drafts: [], verified: false };
  }

  const estimatedInput = estimateTokens(prompt.system) + estimateTokens(prompt.user);
  const reservation = await args.reserveModel({
    sourceId: args.sourceId,
    contentHash: args.hash,
    estimatedInput,
    estimatedOutput: 400,
  });
  if (!reservation.ok) {
    await args.record(attempt({
      sourceId: args.sourceId,
      at: args.at,
      outcome: 'parse_error',
      errorCode: 'model_unavailable',
      contentHash: args.hash,
    }), { lastAttemptedAt: args.at });
    return { modelCalls: 0, modelNeeded: 1, exceptions: [], drafts: [], verified: false };
  }

  let modelText = '';
  try {
    const model = await args.callModel(prompt);
    if (model.usage) await reservation.settle(model.usage);
    else await reservation.release();
    modelText = model.text;
  } catch {
    await reservation.release();
    await args.record(attempt({
      sourceId: args.sourceId,
      at: args.at,
      outcome: 'parse_error',
      errorCode: 'model_unavailable',
      contentHash: args.hash,
    }), { lastAttemptedAt: args.at });
    return { modelCalls: 1, modelNeeded: 1, exceptions: [], drafts: [], verified: false };
  }

  const grounded = filterSupportedFacts({
    raw: parseBriefingModelJson(modelText),
    pages: [{ url: pageUrl, text: pageText }],
  }).kept;
  const plan = planBriefingUpdate({
    sourceId: args.sourceId,
    restaurantId: args.restaurantId,
    pageText,
    grounded,
    stored: args.stored,
  });
  const exceptions = newExceptions(args.openExceptions, plan.exceptions);
  if (args.effects) {
    for (const row of exceptions) await args.effects.openException(row);
    if (args.effects.applyBriefingFact) {
      for (const draft of plan.drafts) await args.effects.applyBriefingFact(draft);
    }
  }
  await args.record(attempt({
    sourceId: args.sourceId,
    at: args.at,
    outcome: 'ok',
    httpStatus: 200,
    contentHash: args.hash,
  }), { lastAttemptedAt: args.at, lastVerifiedAt: args.at, lastContentHash: args.hash });
  return {
    modelCalls: 1,
    modelNeeded: 0,
    exceptions,
    drafts: plan.drafts,
    verified: true,
  };
}

export { briefingValue };
