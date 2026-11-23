/** Exact string only. Unset, empty, and every other value stay off. */
export const SITE_PROBLEM_REPORTS_FLAG = 'SITE_PROBLEM_REPORTS_ENABLED';

export function siteProblemReportsEnabled(
  value: string | undefined = process.env.SITE_PROBLEM_REPORTS_ENABLED,
): boolean {
  return value === 'true';
}
