import type { Json } from '@/types/database.types';

export const EXCEPTION_REASONS = [
  'conflict',
  'sensitive',
  'missing_source',
  'validation_failed',
  'injection_suspected',
] as const;

export type ExceptionReason = (typeof EXCEPTION_REASONS)[number];

export function isExceptionReason(value: string): value is ExceptionReason {
  return (EXCEPTION_REASONS as readonly string[]).includes(value);
}

export type ExceptionDraft = {
  sourceId: string;
  subjectType: 'recipe';
  subjectId: string | null;
  field: string | null;
  reason: ExceptionReason;
  before: Json | null;
  after: Json | null;
  evidenceExcerpt: string;
};

export type OpenExceptionKey = {
  subjectId: string | null;
  field: string | null;
  reason: ExceptionReason;
};

export function exceptionIdentity(row: OpenExceptionKey): string {
  return `${row.subjectId ?? ''}\n${row.field ?? ''}\n${row.reason}`;
}

/** One open row per source, subject, field, and reason. A re-run does not insert another. */
export function newExceptions(existing: readonly OpenExceptionKey[], drafts: readonly ExceptionDraft[]): ExceptionDraft[] {
  const open = new Set(existing.map((row) => exceptionIdentity(row)));
  const fresh: ExceptionDraft[] = [];
  for (const draft of drafts) {
    const key = exceptionIdentity(draft);
    if (open.has(key)) continue;
    open.add(key);
    fresh.push(draft);
  }
  return fresh;
}
