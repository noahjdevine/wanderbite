/** Exact string only. Unset, empty, and every other value stay off. */
export const ACTIVITIES_FLAG = 'E06_ACTIVITIES_ENABLED';

/** Exact string only. Does not turn on the nearby fact boxes by itself. */
export const ACTIVITY_NOTES_FLAG = 'E06_ACTIVITY_NOTES_ENABLED';

const READ_FAILED_LOG = '[activities] read failed';
const UNAVAILABLE_LOG = '[activities] unavailable';
const NOTES_READ_FAILED_LOG = '[activity-notes] read failed';
const NOTES_UNAVAILABLE_LOG = '[activity-notes] unavailable';

let readFailedLogged = false;
let unavailableLogged = false;
let notesReadFailedLogged = false;
let notesUnavailableLogged = false;

export function activitiesEnabled(
  value: string | undefined = process.env.E06_ACTIVITIES_ENABLED,
): boolean {
  return value === 'true';
}

export function activityNotesEnabled(
  value: string | undefined = process.env.E06_ACTIVITY_NOTES_ENABLED,
): boolean {
  return value === 'true';
}

export function activitySchemaMissing(
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

export function logActivitiesUnavailableOnce(): void {
  if (unavailableLogged) return;
  unavailableLogged = true;
  console.warn(UNAVAILABLE_LOG);
}

export function logActivitiesReadFailedOnce(): void {
  if (readFailedLogged) return;
  readFailedLogged = true;
  console.warn(READ_FAILED_LOG);
}

export function logActivityNotesUnavailableOnce(): void {
  if (notesUnavailableLogged) return;
  notesUnavailableLogged = true;
  console.warn(NOTES_UNAVAILABLE_LOG);
}

export function logActivityNotesReadFailedOnce(): void {
  if (notesReadFailedLogged) return;
  notesReadFailedLogged = true;
  console.warn(NOTES_READ_FAILED_LOG);
}

export function resetActivitiesLogs(): void {
  readFailedLogged = false;
  unavailableLogged = false;
  notesReadFailedLogged = false;
  notesUnavailableLogged = false;
}
