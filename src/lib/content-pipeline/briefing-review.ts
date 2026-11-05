import { briefingTextBlocked } from '@/lib/content-pipeline/briefing-plan';
import { normalizeOperatorText } from '@/lib/content-pipeline/activity-review';
import { isBriefingField } from '@/lib/briefings/types';
import type { Json } from '@/types/database.types';

export const BRIEFING_FACT_MAX = 400;

export type BriefingMemberRow = {
  restaurantId: string;
  field: string;
  body: string;
  status: string;
  version: number;
};

export type BriefingDraftSnapshot = {
  id: string;
  sourceId: string;
  restaurantId: string;
  field: string;
  version: number;
  status: string;
  text: string;
  before: string | null;
  evidenceExcerpt: string;
};

const DRAFT_STATUSES = new Set(['current', 'superseded', 'pending_review', 'reviewed', 'rejected']);

export function readBriefingDraft(row: {
  id: string;
  source_id: string;
  subject_id: string | null;
  field: string;
  version: number;
  status: string;
  value: Json;
  evidence_excerpt: string;
}): BriefingDraftSnapshot | null {
  if (!row.subject_id || !isBriefingField(row.field) || !DRAFT_STATUSES.has(row.status)) return null;
  if (!row.value || typeof row.value !== 'object' || Array.isArray(row.value)) return null;
  const text = typeof row.value.text === 'string' ? row.value.text.trim() : '';
  if (!text) return null;
  const before = typeof row.value.before === 'string' && row.value.before.trim() ? row.value.before.trim() : null;
  return {
    id: row.id,
    sourceId: row.source_id,
    restaurantId: row.subject_id,
    field: row.field,
    version: row.version,
    status: row.status,
    text,
    before,
    evidenceExcerpt: row.evidence_excerpt,
  };
}

export function briefingPublishError(text: string): string | null {
  const body = normalizeOperatorText(text);
  if (!body) return 'Fact text is required.';
  if (body.length > BRIEFING_FACT_MAX) return `Fact text must be ${BRIEFING_FACT_MAX} characters or fewer.`;
  if (briefingTextBlocked(body)) return 'That text is not a publishable briefing fact.';
  return null;
}

/**
 * A new or paused fact stays paused.
 * An already-active fact stays active only when the operator keeps it visible.
 */
export function briefingPublishKeepsActive(storedStatus: string | null | undefined, keepActive: boolean): boolean {
  return storedStatus === 'active' && keepActive;
}
