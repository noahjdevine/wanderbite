/** Exact string only. Unset, empty, and every other value stay off. */
export const MONTHLY_REVEAL_FLAG = 'E04_MONTHLY_REVEAL_ENABLED';

const UNAVAILABLE_LOG =
  '[challenges] monthly reveal unavailable; using the current challenges page';

let unavailableLogged = false;

export function monthlyRevealEnabled(
  value: string | undefined = process.env.E04_MONTHLY_REVEAL_ENABLED,
): boolean {
  return value === 'true';
}

/**
 * PostgREST / Postgres errors when challenge_reveals or reveal_monthly_challenge
 * is not in the database the app is talking to.
 */
export function revealSchemaMissing(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  if (code === '42P01' || code === '42883' || code === 'PGRST202' || code === 'PGRST205') {
    return true;
  }
  const message = error.message ?? '';
  return (
    message.includes('does not exist') ||
    message.includes('Could not find the function') ||
    message.includes('Could not find the table') ||
    message.includes('schema cache')
  );
}

export function logRevealUnavailableOnce(): void {
  if (unavailableLogged) return;
  unavailableLogged = true;
  console.warn(UNAVAILABLE_LOG);
}

export function resetMonthlyRevealUnavailableLog(): void {
  unavailableLogged = false;
}
