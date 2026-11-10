import { chicagoDateMidnight } from '@/lib/progression/entries-from';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const HOSTED_PROJECT_REF = 'yiajoycgiyxjvznndjge';

export type ProgressionBackfillCounts = {
  members: number;
  events: number;
  milestones: number;
  entries: number;
  milestonesWithoutEntry: number;
};

export type ProgressionBackfillArgs = {
  help: false;
  apply: boolean;
  entriesFrom: string;
  userId: string | null;
};

const COUNT_KEYS = [
  'members',
  'events',
  'milestones',
  'entries',
  'milestones_without_entry',
] as const;

/** Refuses hosted. There is no one-run override. */
export function progressionBackfillAllowed(
  supabaseUrl: string,
): { ok: true } | { ok: false; reason: string } {
  const url = supabaseUrl.trim();
  if (!url) return { ok: false, reason: 'Refused. NEXT_PUBLIC_SUPABASE_URL is not set.' };
  if (url.includes(HOSTED_PROJECT_REF)) {
    return { ok: false, reason: 'Refused. This backfill does not run against hosted.' };
  }
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return { ok: false, reason: 'Refused. NEXT_PUBLIC_SUPABASE_URL is not a local URL.' };
  }
  if (
    host === 'supabase.co'
    || host.endsWith('.supabase.co')
    || host === 'supabase.com'
    || host.endsWith('.supabase.com')
  ) {
    return { ok: false, reason: 'Refused. This backfill does not run against hosted.' };
  }
  return { ok: true };
}

function readEntriesFrom(value: string | undefined): string | { error: string } {
  if (!value || value.startsWith('--')) {
    return { error: '--entries-from is required. Pass YYYY-MM-DD. There is no default.' };
  }
  try {
    return chicagoDateMidnight(value).toISOString();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'entries-from must be YYYY-MM-DD';
    return { error: message };
  }
}

/**
 * `--entries-from YYYY-MM-DD` is required. There is no default date.
 * The date is America/Chicago midnight. Omitting `--apply` is a dry run.
 */
export function parseProgressionBackfillArgs(
  argv: readonly string[],
): ProgressionBackfillArgs | { help: true } | { error: string } {
  let help = false;
  let apply = false;
  let dryRun = false;
  let entriesFrom: string | null = null;
  let userId: string | null = null;
  let sawEntriesFrom = false;
  let sawUser = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--entries-from' || arg.startsWith('--entries-from=')) {
      if (sawEntriesFrom) return { error: '--entries-from was passed more than once' };
      sawEntriesFrom = true;
      const value = arg.startsWith('--entries-from=')
        ? arg.slice('--entries-from='.length)
        : argv[index + 1];
      if (!arg.startsWith('--entries-from=')) index += 1;
      const parsed = readEntriesFrom(value);
      if (typeof parsed !== 'string') return parsed;
      entriesFrom = parsed;
      continue;
    }
    if (arg === '--user-id' || arg.startsWith('--user-id=')) {
      if (sawUser) return { error: '--user-id was passed more than once' };
      sawUser = true;
      const value = arg.startsWith('--user-id=')
        ? arg.slice('--user-id='.length)
        : argv[index + 1];
      if (!arg.startsWith('--user-id=')) index += 1;
      if (!value || value.startsWith('--')) return { error: '--user-id must be a uuid' };
      if (!UUID_RE.test(value)) return { error: '--user-id must be a uuid' };
      userId = value;
      continue;
    }
    return { error: `Unknown argument ${arg}` };
  }

  if (help) return { help: true };
  if (apply && dryRun) return { error: 'Choose one of --dry-run or --apply.' };
  if (!entriesFrom) {
    return { error: '--entries-from is required. Pass YYYY-MM-DD. There is no default.' };
  }
  return { help: false, apply, entriesFrom, userId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wholeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

/** Reads the five count fields. Does not return any other payload. */
export function readBackfillCounts(data: unknown): ProgressionBackfillCounts | null {
  let value = data;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  for (const key of COUNT_KEYS) {
    if (!(key in value)) return null;
  }
  const members = wholeNumber(value.members);
  const events = wholeNumber(value.events);
  const milestones = wholeNumber(value.milestones);
  const entries = wholeNumber(value.entries);
  const milestonesWithoutEntry = wholeNumber(value.milestones_without_entry);
  if (
    members === null
    || events === null
    || milestones === null
    || entries === null
    || milestonesWithoutEntry === null
  ) {
    return null;
  }
  return { members, events, milestones, entries, milestonesWithoutEntry };
}

/** Counts only. No ids, emails, or tokens. */
export function formatProgressionBackfillCounts(
  counts: ProgressionBackfillCounts,
  dryRun: boolean,
): string {
  return [
    `dry_run=${dryRun ? 'true' : 'false'}`,
    `members=${counts.members}`,
    `events=${counts.events}`,
    `milestones=${counts.milestones}`,
    `entries=${counts.entries}`,
    `milestones_without_entry=${counts.milestonesWithoutEntry}`,
    '',
  ].join('\n');
}
