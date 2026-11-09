/** Exact string only. Unset, empty, and every other value stay off. */
export const ARRIVAL_SESSIONS_FLAG = 'E07_ARRIVAL_SESSIONS_ENABLED';

export function arrivalSessionsEnabled(
  value: string | undefined = process.env.E07_ARRIVAL_SESSIONS_ENABLED,
): boolean {
  return value === 'true';
}

/** Exact string only. Unset, empty, and every other value stay off. */
export const VISIT_PROBLEMS_FLAG = 'E07_VISIT_PROBLEMS_ENABLED';

export function visitProblemsEnabled(
  value: string | undefined = process.env.E07_VISIT_PROBLEMS_ENABLED,
): boolean {
  return value === 'true';
}
