import { activityClaimForbidden } from '@/lib/content-pipeline/activity-plan';
import {
  dietaryClaim,
  extractPrice,
  injectionSuspected,
} from '@/lib/content-pipeline/change-detect';
import type { ExceptionDraft } from '@/lib/content-pipeline/exceptions';
import { evidenceExcerpt } from '@/lib/content-pipeline/facts';
import { groundedInPage, type SupportedFact } from '@/lib/briefings/research';
import { isBriefingField, type BriefingField } from '@/lib/briefings/types';
import type { Json } from '@/types/database.types';

const SAFE_FOR_RE = /\bsafe\s+for\b/i;

export type StoredBriefing = {
  field: string;
  body: string;
  status: string;
};

export type BriefingDraft = {
  sourceId: string;
  restaurantId: string;
  field: BriefingField;
  text: string;
  before: string | null;
  evidenceExcerpt: string;
  changeSummary: string;
};

/** An open pending_review fact the refresh can match before inserting another. */
export type OpenPendingDraft = {
  subjectType: 'briefing' | 'activity';
  subjectId: string;
  field: string;
  text: string;
};

export const CHANGE_SUMMARY_MAX = 160;

export function briefingTextBlocked(text: string): 'injection_suspected' | 'sensitive' | null {
  if (injectionSuspected(text)) return 'injection_suspected';
  if (dietaryClaim(text) || extractPrice(text) || activityClaimForbidden(text) || SAFE_FOR_RE.test(text)) {
    return 'sensitive';
  }
  return null;
}

export function normalizeDraftText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function sameBriefingText(left: string, right: string): boolean {
  return normalizeDraftText(left) === normalizeDraftText(right);
}

export function capChangeSummary(text: string): string {
  const flat = normalizeDraftText(text);
  if (flat.length <= CHANGE_SUMMARY_MAX) return flat;
  return `${flat.slice(0, CHANGE_SUMMARY_MAX - 1).trimEnd()}…`;
}

/** One line from the previous text and the new text. Used when the model omits a grounded summary. */
export function deterministicChangeSummary(args: {
  field: string;
  before: string | null;
  after: string;
}): string {
  const label = normalizeDraftText(args.field.replace(/_/g, ' '));
  const after = normalizeDraftText(args.after);
  const before = args.before ? normalizeDraftText(args.before) : '';
  if (before && before !== after) return capChangeSummary(`${label}: "${before}" → "${after}"`);
  return capChangeSummary(`${label}: "${after}"`);
}

/**
 * Prefer a model summary that is short and supported by this page.
 * Otherwise use the deterministic line. The result is never empty when `after` has text.
 */
export function resolveChangeSummary(args: {
  field: string;
  before: string | null;
  after: string;
  pageText: string;
  modelSummary?: string | null;
  acceptModel?: (text: string) => boolean;
}): string {
  const model = args.modelSummary ? capChangeSummary(args.modelSummary) : '';
  const accepted = model.length > 0 && (args.acceptModel ? args.acceptModel(model) : briefingTextBlocked(model) == null);
  if (accepted && groundedInPage(model, args.pageText)) return model;
  const fallback = deterministicChangeSummary(args);
  return fallback || capChangeSummary(args.after);
}

export function pendingDraftIsDuplicate(
  open: readonly OpenPendingDraft[],
  candidate: OpenPendingDraft,
): boolean {
  const text = normalizeDraftText(candidate.text);
  if (!text) return false;
  return open.some((row) => (
    row.subjectType === candidate.subjectType
    && row.subjectId === candidate.subjectId
    && row.field === candidate.field
    && normalizeDraftText(row.text) === text
  ));
}

export function readOpenPendingDraft(row: {
  subject_type: string;
  subject_id: string | null;
  field: string;
  status: string;
  value: Json;
}): OpenPendingDraft | null {
  if (row.status !== 'pending_review' || !row.subject_id) return null;
  if (row.subject_type !== 'briefing' && row.subject_type !== 'activity') return null;
  if (!row.value || typeof row.value !== 'object' || Array.isArray(row.value)) return null;
  const text = typeof row.value.text === 'string' ? row.value.text : '';
  if (!normalizeDraftText(text)) return null;
  return {
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    field: row.field,
    text,
  };
}

export function readStoredChangeSummary(value: Json): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value.change_summary;
  if (typeof raw !== 'string') return null;
  const text = capChangeSummary(raw);
  return text || null;
}

function briefingException(args: {
  sourceId: string;
  restaurantId: string;
  field: string | null;
  reason: ExceptionDraft['reason'];
  before: string | null;
  after: string | null;
  evidence: string;
}): ExceptionDraft {
  return {
    sourceId: args.sourceId,
    subjectType: 'briefing',
    subjectId: args.restaurantId,
    field: args.field,
    reason: args.reason,
    before: args.before ? { text: args.before } : null,
    after: args.after ? { text: args.after } : null,
    evidenceExcerpt: evidenceExcerpt(args.evidence),
  };
}

/**
 * Page text only. A grounded difference from a paused or missing fact is a draft.
 * An active member fact is never rewritten here. Conflicts, removed evidence,
 * sensitive claims, and injection text become exceptions and are not drafts.
 */
export function planBriefingUpdate(args: {
  sourceId: string;
  restaurantId: string;
  pageText: string;
  grounded: readonly SupportedFact[];
  stored: readonly StoredBriefing[];
  pendingDrafts?: readonly OpenPendingDraft[];
}): { drafts: BriefingDraft[]; exceptions: ExceptionDraft[] } {
  if (injectionSuspected(args.pageText)) {
    return {
      drafts: [],
      exceptions: [
        briefingException({
          sourceId: args.sourceId,
          restaurantId: args.restaurantId,
          field: null,
          reason: 'injection_suspected',
          before: null,
          after: null,
          evidence: args.pageText,
        }),
      ],
    };
  }

  const storedByField = new Map<string, StoredBriefing>();
  for (const row of args.stored) {
    if (!isBriefingField(row.field) || storedByField.has(row.field)) continue;
    storedByField.set(row.field, row);
  }
  const drafts: BriefingDraft[] = [];
  const exceptions: ExceptionDraft[] = [];
  const proposed = new Set<string>();

  for (const fact of args.grounded) {
    if (!isBriefingField(fact.field) || proposed.has(fact.field)) continue;
    proposed.add(fact.field);
    const blocked = briefingTextBlocked(fact.text);
    if (blocked) {
      exceptions.push(briefingException({
        sourceId: args.sourceId,
        restaurantId: args.restaurantId,
        field: fact.field,
        reason: blocked,
        before: storedByField.get(fact.field)?.body ?? null,
        after: fact.text,
        evidence: fact.supportPassage || fact.text,
      }));
      continue;
    }
    const stored = storedByField.get(fact.field) ?? null;
    if (stored && sameBriefingText(stored.body, fact.text)) continue;
    const oldStillSupported = stored ? groundedInPage(stored.body, args.pageText) : false;
    if (stored && (stored.status === 'active' || oldStillSupported)) {
      exceptions.push(briefingException({
        sourceId: args.sourceId,
        restaurantId: args.restaurantId,
        field: fact.field,
        reason: 'conflict',
        before: stored.body,
        after: fact.text,
        evidence: fact.supportPassage,
      }));
      continue;
    }
    if (pendingDraftIsDuplicate(args.pendingDrafts ?? [], {
      subjectType: 'briefing',
      subjectId: args.restaurantId,
      field: fact.field,
      text: fact.text,
    })) continue;
    const text = fact.text.trim();
    drafts.push({
      sourceId: args.sourceId,
      restaurantId: args.restaurantId,
      field: fact.field,
      text,
      before: stored?.body ?? null,
      evidenceExcerpt: evidenceExcerpt(fact.supportPassage),
      changeSummary: resolveChangeSummary({
        field: fact.field,
        before: stored?.body ?? null,
        after: text,
        pageText: args.pageText,
        modelSummary: fact.changeSummary,
      }),
    });
  }

  for (const stored of storedByField.values()) {
    if (proposed.has(stored.field)) continue;
    if (groundedInPage(stored.body, args.pageText)) continue;
    exceptions.push(briefingException({
      sourceId: args.sourceId,
      restaurantId: args.restaurantId,
      field: stored.field,
      reason: 'missing_source',
      before: stored.body,
      after: null,
      evidence: stored.body,
    }));
  }

  return { drafts, exceptions };
}

export function briefingValue(draft: Pick<BriefingDraft, 'text' | 'before' | 'changeSummary'>): Json {
  const value: { text: string; before?: string; change_summary?: string } = { text: draft.text };
  if (draft.before) value.before = draft.before;
  if (draft.changeSummary) value.change_summary = draft.changeSummary;
  return value;
}
