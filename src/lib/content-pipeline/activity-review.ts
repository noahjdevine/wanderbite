import { activityClaimForbidden, activitySummaryPublishable } from '@/lib/content-pipeline/activity-plan';
import {
  dietaryClaim,
  extractPrice,
  injectionSuspected,
} from '@/lib/content-pipeline/change-detect';
import { formatContentInstant } from '@/lib/content-pipeline/facts';
import type { Json } from '@/types/database.types';

export const ACTIVITY_SUMMARY_MAX = 400;
export const ACTIVITY_HOURS_NOTE_MAX = 240;
export const ACTIVITY_RESOLUTION_NOTE_MAX = 400;

export type ActivityQueueRow = {
  id: string;
  name: string;
  hoursNote: string | null;
  version: number;
};

export type ActivityGuard = ActivityQueueRow & {
  status: string;
  category: string;
  costCategory: string;
  bookingRequired: boolean;
  sourceUrl: string | null;
  contentSourceId: string | null;
  isSample: boolean;
  weatherDependent: boolean;
  lat: number | null;
  lon: number | null;
  zip: string | null;
  typicalDurationMinutes: number | null;
  validFrom: string | null;
  validUntil: string | null;
  lastVerifiedAt: string | null;
};

export type ActivitySummarySnapshot = {
  id: string;
  sourceId: string;
  subjectId: string;
  version: number;
  status: string;
  text: string;
  evidenceExcerpt: string;
};

const SUMMARY_STATUSES = new Set(['current', 'superseded', 'pending_review', 'reviewed', 'rejected']);

export function normalizeOperatorText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function activityCheckedLabel(verifiedAt: string | null | undefined, attemptedAt: string | null | undefined): string {
  return formatContentInstant(verifiedAt ?? attemptedAt ?? null);
}

export function activityEditKind(field: string | null): 'hours_note' | 'summary' | 'note' {
  if (field === 'hours_note') return 'hours_note';
  if (field === 'summary') return 'summary';
  return 'note';
}

export function readActivitySummary(row: {
  id: string;
  source_id: string;
  subject_id: string | null;
  version: number;
  status: string;
  value: Json;
  evidence_excerpt: string;
}): ActivitySummarySnapshot | null {
  if (!row.subject_id || !SUMMARY_STATUSES.has(row.status)) return null;
  if (!row.value || typeof row.value !== 'object' || Array.isArray(row.value)) return null;
  const text = typeof row.value.text === 'string' ? row.value.text.trim() : '';
  if (!text) return null;
  return {
    id: row.id,
    sourceId: row.source_id,
    subjectId: row.subject_id,
    version: row.version,
    status: row.status,
    text,
    evidenceExcerpt: row.evidence_excerpt,
  };
}

export function summaryPublishError(text: string): string | null {
  const summary = normalizeOperatorText(text);
  if (!summary) return 'Summary is required.';
  if (summary.length > ACTIVITY_SUMMARY_MAX) return `Summary must be ${ACTIVITY_SUMMARY_MAX} characters or fewer.`;
  if (!activitySummaryPublishable(summary)) return 'That text is not a publishable summary.';
  return null;
}

export function hoursNotePublishError(text: string): string | null {
  const note = normalizeOperatorText(text);
  if (!note) return 'Hours note is required.';
  if (note.length > ACTIVITY_HOURS_NOTE_MAX) {
    return `Hours note must be ${ACTIVITY_HOURS_NOTE_MAX} characters or fewer.`;
  }
  if (activityClaimForbidden(note) || injectionSuspected(note) || dietaryClaim(note) || extractPrice(note)) {
    return 'That text is not a publishable hours note.';
  }
  return null;
}

/**
 * Price and allergen rows record this note on the audit row only.
 * The note is not a source fact and is not written onto the activity.
 */
export function resolutionNoteError(text: string): string | null {
  const note = normalizeOperatorText(text);
  if (!note) return 'A note is required.';
  if (note.length > ACTIVITY_RESOLUTION_NOTE_MAX) {
    return `Note must be ${ACTIVITY_RESOLUTION_NOTE_MAX} characters or fewer.`;
  }
  return null;
}
