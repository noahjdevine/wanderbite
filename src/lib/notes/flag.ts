/** Exact string only. Unset, empty, and every other value stay off. */
export const JOURNAL_REFLECTIONS_FLAG = 'E08_JOURNAL_REFLECTIONS_ENABLED';

export function journalReflectionsEnabled(
  value: string | undefined = process.env.E08_JOURNAL_REFLECTIONS_ENABLED,
): boolean {
  return value === 'true';
}
