/** Exact string only. Unset, empty, and every other value stay off. */
export const ARRIVAL_SESSIONS_FLAG = 'E07_ARRIVAL_SESSIONS_ENABLED';

export function arrivalSessionsEnabled(
  value: string | undefined = process.env.E07_ARRIVAL_SESSIONS_ENABLED,
): boolean {
  return value === 'true';
}
