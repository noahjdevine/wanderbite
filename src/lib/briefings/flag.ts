/** Exact string only. Unset, empty, and every other value stay off. */
export const BRIEFINGS_FLAG = 'E06_BRIEFINGS_ENABLED';

const READ_FAILED_LOG = '[briefings] read failed';
const UNAVAILABLE_LOG = '[briefings] unavailable';

let readFailedLogged = false;
let unavailableLogged = false;

export function briefingsEnabled(
  value: string | undefined = process.env.E06_BRIEFINGS_ENABLED,
): boolean {
  return value === 'true';
}

export function briefingSchemaMissing(
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

export function logBriefingsUnavailableOnce(): void {
  if (unavailableLogged) return;
  unavailableLogged = true;
  console.warn(UNAVAILABLE_LOG);
}

export function logBriefingsReadFailedOnce(): void {
  if (readFailedLogged) return;
  readFailedLogged = true;
  console.warn(READ_FAILED_LOG);
}

export function resetBriefingsLogs(): void {
  readFailedLogged = false;
  unavailableLogged = false;
}
