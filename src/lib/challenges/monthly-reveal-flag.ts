/** Exact string only. Unset, empty, and every other value stay off. */
export const MONTHLY_REVEAL_FLAG = 'E04_MONTHLY_REVEAL_ENABLED';

const UNAVAILABLE_LOG =
  '[challenges] monthly reveal unavailable; using the current challenges page';
const RETRY_LOG = '[challenges] monthly reveal read failed; ask the member to try again';
const PICK_READ_LOG = '[challenges] reveal pick reminder not sent; reveal read failed';

let unavailableLogged = false;
let retryLogged = false;
let pickReadLogged = false;

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

export function logRevealRetryOnce(): void {
  if (retryLogged) return;
  retryLogged = true;
  console.warn(RETRY_LOG);
}

export function logRevealPickReadFailedOnce(): void {
  if (pickReadLogged) return;
  pickReadLogged = true;
  console.warn(PICK_READ_LOG);
}

export function resetMonthlyRevealUnavailableLog(): void {
  unavailableLogged = false;
  retryLogged = false;
  pickReadLogged = false;
}
