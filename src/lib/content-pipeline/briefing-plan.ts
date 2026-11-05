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
};

export function briefingTextBlocked(text: string): 'injection_suspected' | 'sensitive' | null {
  if (injectionSuspected(text)) return 'injection_suspected';
  if (dietaryClaim(text) || extractPrice(text) || activityClaimForbidden(text) || SAFE_FOR_RE.test(text)) {
    return 'sensitive';
  }
  return null;
}

export function sameBriefingText(left: string, right: string): boolean {
  return left.replace(/\s+/g, ' ').trim() === right.replace(/\s+/g, ' ').trim();
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
    drafts.push({
      sourceId: args.sourceId,
      restaurantId: args.restaurantId,
      field: fact.field,
      text: fact.text.trim(),
      before: stored?.body ?? null,
      evidenceExcerpt: evidenceExcerpt(fact.supportPassage),
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

export function briefingValue(draft: Pick<BriefingDraft, 'text' | 'before'>): Json {
  return draft.before ? { text: draft.text, before: draft.before } : { text: draft.text };
}
