import { chicagoCalendarDate, shiftCalendarDate } from '@/lib/activities/match';
import { hostedSupabaseUrl } from '@/lib/recipes/menu-run';

/**
 * Read-only D00 measurement for the shared content refresh.
 *
 * Refresh cost: sum of ai_requests.settled_platform_microdollars for
 * feature_class maintenance, account_tier ops, and status settled or
 * assumed_spent. The Chicago day is day_key (the ledger day at reserve).
 * A missing day_key uses the Chicago calendar date of settled_at.
 * Dollars are microdollars / 1_000_000, shown to 6 decimal places with
 * integer arithmetic. No row in the window is 0, not null.
 *
 * Automatic updates: one per source_fetch_attempts row in the window with
 * outcome ok (changed page, verification advanced) or unchanged. A pipeline
 * draft counts only when no such attempt on the same source has attempted_at
 * at or before extracted_at within 15 minutes. Operator edits are not attempts.
 *
 * Operator corrections: admin_audit_log rows in the window whose action is
 * content.exception_edit (publish and other edits), content.exception_reject,
 * or content.recipe_rollback. Approve and source pause/resume are not corrections.
 * Publish is the edit subset whose metadata.published is true, counted once.
 *
 * Time per exception: closed rows (status other than open, with resolved_at)
 * whose Chicago resolve day is in the window. Opened time is the latest
 * ok or parse_error attempt on that source at or before resolved_at.
 * content_exceptions has no opened column. A later ok or parse_error before
 * resolve shortens the interval. No such attempt excludes the row from the
 * median and counts it as closedUnmatched. Still-open rows are open, not a duration.
 * Median of an even count is the mean of the two central millisecond values,
 * rounded to the nearest millisecond (halves away from zero). p90 is the
 * nearest rank: index ceil(0.90 * n) - 1 on the ascending list. Hours are
 * milliseconds / 3_600_000 rounded to 0.001 hour (halves away from zero).
 */

export const CONTENT_METRICS_TIME_ZONE = 'America/Chicago' as const;
export const CONTENT_METRICS_WINDOW_DAYS = 7;
export const DRAFT_ATTEMPT_MATCH_MS = 15 * 60 * 1000;

export const AUTOMATIC_UPDATE_OUTCOMES = ['ok', 'unchanged'] as const;
export const EXCEPTION_OPEN_OUTCOMES = ['ok', 'parse_error'] as const;
export const MAINTENANCE_FEATURE_CLASS = 'maintenance';
export const MAINTENANCE_ACCOUNT_TIER = 'ops';
export const MAINTENANCE_SPEND_STATUSES = ['settled', 'assumed_spent'] as const;
export const OPERATOR_CORRECTION_ACTIONS = [
  'content.exception_edit',
  'content.exception_reject',
  'content.recipe_rollback',
] as const;

export const CONTENT_METRICS_KINDS = [
  'public_menu',
  'venue_page',
  'event_page',
  'restaurant_page',
] as const;

export type ContentMetricsKind = (typeof CONTENT_METRICS_KINDS)[number];

export type ContentMetricsWindow = {
  from: string;
  to: string;
  timeZone: typeof CONTENT_METRICS_TIME_ZONE;
};

export type ContentMetricsSource = {
  id: string;
  kind: string;
};

export type ContentMetricsAttempt = {
  sourceId: string;
  attemptedAt: string;
  outcome: string;
};

export type ContentMetricsDraft = {
  sourceId: string;
  subjectType: string;
  status: string;
  extractedAt: string;
  changeSummary?: string | null;
};

export type ContentMetricsLedgerRow = {
  featureClass: string;
  accountTier: string;
  status: string;
  dayKey: string | null;
  settledAt: string | null;
  settledPlatformMicrodollars: number;
};

export type ContentMetricsAudit = {
  action: string;
  createdAt: string;
  published?: boolean | null;
};

export type ContentMetricsException = {
  sourceId: string;
  status: string;
  resolvedAt: string | null;
};

export type ContentMetricsInput = {
  sources: readonly ContentMetricsSource[];
  attempts: readonly ContentMetricsAttempt[];
  drafts: readonly ContentMetricsDraft[];
  ledger: readonly ContentMetricsLedgerRow[];
  audits: readonly ContentMetricsAudit[];
  exceptions: readonly ContentMetricsException[];
};

export type ContentMetricsKindCounts = Record<ContentMetricsKind | 'other', number>;

export type ContentMetricsReport = {
  window: ContentMetricsWindow;
  refreshCost: {
    microdollars: number;
    usd: string;
    byDay: { day: string; microdollars: number }[];
  };
  automaticUpdates: {
    total: number;
    byKind: ContentMetricsKindCounts;
  };
  operatorCorrections: {
    total: number;
    publish: number;
    edit: number;
    reject: number;
    rollback: number;
  };
  timePerException: {
    medianMs: number | null;
    p90Ms: number | null;
    medianHours: string | null;
    p90Hours: string | null;
    sampleSize: number;
    open: number;
    closedUnmatched: number;
  };
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const automaticOutcomes = new Set<string>(AUTOMATIC_UPDATE_OUTCOMES);
const openingOutcomes = new Set<string>(EXCEPTION_OPEN_OUTCOMES);
const spendStatuses = new Set<string>(MAINTENANCE_SPEND_STATUSES);

const chicagoWall = new Intl.DateTimeFormat('en-US', {
  timeZone: CONTENT_METRICS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function isCalendarDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

function wallAsUtc(instant: Date): number {
  const parts = chicagoWall.formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  let year = pick('year');
  let month = pick('month');
  let day = pick('day');
  let hour = pick('hour');
  const minute = pick('minute');
  const second = pick('second');
  if (hour === 24) {
    hour = 0;
    const next = new Date(Date.UTC(year, month - 1, day));
    next.setUTCDate(next.getUTCDate() + 1);
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  }
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** America/Chicago midnight for a YYYY-MM-DD date, as a UTC instant. */
export function chicagoDayStartUtc(isoDate: string): Date {
  if (!isCalendarDate(isoDate)) throw new Error('Chicago day is not a calendar date');
  const match = DATE_RE.exec(isoDate);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const desired = Date.UTC(year, month - 1, day, 0, 0, 0);
  let utc = desired;
  for (let i = 0; i < 4; i += 1) {
    const next = utc - (wallAsUtc(new Date(utc)) - desired);
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc);
}

export function defaultContentMetricsWindow(now = new Date()): ContentMetricsWindow {
  const to = chicagoCalendarDate(now);
  const from = shiftCalendarDate(to, -(CONTENT_METRICS_WINDOW_DAYS - 1));
  return { from, to, timeZone: CONTENT_METRICS_TIME_ZONE };
}

export function contentMetricsWindow(from: string, to: string): ContentMetricsWindow | null {
  if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) return null;
  return { from, to, timeZone: CONTENT_METRICS_TIME_ZONE };
}

export function instantInContentMetricsWindow(iso: string, window: ContentMetricsWindow): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const day = chicagoCalendarDate(date);
  return day >= window.from && day <= window.to;
}

export function formatMetricUsd(microdollars: number): string {
  const negative = microdollars < 0;
  const abs = Math.abs(microdollars);
  const whole = Math.floor(abs / 1_000_000);
  const frac = abs % 1_000_000;
  return `${negative ? '-' : ''}${whole}.${String(frac).padStart(6, '0')}`;
}

/** Nearest 0.001 hour. Positive halves round away from zero. */
export function formatMetricHours(milliseconds: number): string {
  const thousandths = Math.round(milliseconds / 3_600);
  const negative = thousandths < 0;
  const abs = Math.abs(thousandths);
  const whole = Math.floor(abs / 1000);
  const frac = abs % 1000;
  return `${negative ? '-' : ''}${whole}.${String(frac).padStart(3, '0')}`;
}

export function medianMilliseconds(durations: readonly number[]): number | null {
  if (durations.length === 0) return null;
  const sorted = [...durations].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (lower === undefined || upper === undefined) return null;
  return Math.round((lower + upper) / 2);
}

/** Nearest rank. Index is ceil(0.90 * n) - 1 on the ascending list. */
export function p90Milliseconds(durations: readonly number[]): number | null {
  if (durations.length === 0) return null;
  const sorted = [...durations].sort((left, right) => left - right);
  const index = Math.ceil(0.9 * sorted.length) - 1;
  return sorted[index] ?? null;
}

function emptyKinds(): ContentMetricsKindCounts {
  return {
    public_menu: 0,
    venue_page: 0,
    event_page: 0,
    restaurant_page: 0,
    other: 0,
  };
}

function addKind(counts: ContentMetricsKindCounts, kind: string): void {
  if (kind === 'public_menu' || kind === 'venue_page' || kind === 'event_page' || kind === 'restaurant_page') {
    counts[kind] += 1;
    return;
  }
  counts.other += 1;
}

function instantMs(iso: string): number | null {
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? null : value;
}

function pipelineDraft(draft: ContentMetricsDraft): boolean {
  if (draft.subjectType !== 'activity' && draft.subjectType !== 'briefing') return false;
  if (draft.status === 'pending_review' || draft.status === 'reviewed') return true;
  return typeof draft.changeSummary === 'string' && draft.changeSummary.trim().length > 0;
}

function draftHasVerification(draft: ContentMetricsDraft, attempts: readonly ContentMetricsAttempt[]): boolean {
  const extracted = instantMs(draft.extractedAt);
  if (extracted === null) return false;
  return attempts.some((attempt) => {
    if (attempt.sourceId !== draft.sourceId || !automaticOutcomes.has(attempt.outcome)) return false;
    const attempted = instantMs(attempt.attemptedAt);
    if (attempted === null || attempted > extracted) return false;
    return extracted - attempted <= DRAFT_ATTEMPT_MATCH_MS;
  });
}

function openedAtMs(exception: ContentMetricsException, attempts: readonly ContentMetricsAttempt[]): number | null {
  if (!exception.resolvedAt) return null;
  const resolved = instantMs(exception.resolvedAt);
  if (resolved === null) return null;
  let best: number | null = null;
  for (const attempt of attempts) {
    if (attempt.sourceId !== exception.sourceId || !openingOutcomes.has(attempt.outcome)) continue;
    const attempted = instantMs(attempt.attemptedAt);
    if (attempted === null || attempted > resolved) continue;
    if (best === null || attempted > best) best = attempted;
  }
  return best;
}

function ledgerDay(row: ContentMetricsLedgerRow): string | null {
  if (row.dayKey && isCalendarDate(row.dayKey)) return row.dayKey;
  if (!row.settledAt) return null;
  const settled = instantMs(row.settledAt);
  if (settled === null) return null;
  const day = chicagoCalendarDate(new Date(settled));
  return isCalendarDate(day) ? day : null;
}

function spendMicrodollars(row: ContentMetricsLedgerRow): number | null {
  if (row.featureClass !== MAINTENANCE_FEATURE_CLASS) return null;
  if (row.accountTier !== MAINTENANCE_ACCOUNT_TIER) return null;
  if (!spendStatuses.has(row.status)) return null;
  if (!Number.isSafeInteger(row.settledPlatformMicrodollars) || row.settledPlatformMicrodollars < 0) return null;
  return row.settledPlatformMicrodollars;
}

export function contentMetricsReport(input: ContentMetricsInput, window: ContentMetricsWindow): ContentMetricsReport {
  const kinds = new Map(input.sources.map((source) => [source.id, source.kind]));
  const byDay = new Map<string, number>();
  let microdollars = 0;
  for (const row of input.ledger) {
    const spent = spendMicrodollars(row);
    const day = ledgerDay(row);
    if (spent === null || !day || day < window.from || day > window.to) continue;
    microdollars += spent;
    byDay.set(day, (byDay.get(day) ?? 0) + spent);
  }

  const byKind = emptyKinds();
  for (const attempt of input.attempts) {
    if (!automaticOutcomes.has(attempt.outcome)) continue;
    if (!instantInContentMetricsWindow(attempt.attemptedAt, window)) continue;
    addKind(byKind, kinds.get(attempt.sourceId) ?? 'other');
  }
  for (const draft of input.drafts) {
    if (!pipelineDraft(draft)) continue;
    if (!instantInContentMetricsWindow(draft.extractedAt, window)) continue;
    if (draftHasVerification(draft, input.attempts)) continue;
    addKind(byKind, kinds.get(draft.sourceId) ?? 'other');
  }

  const corrections = { total: 0, publish: 0, edit: 0, reject: 0, rollback: 0 };
  for (const audit of input.audits) {
    if (!instantInContentMetricsWindow(audit.createdAt, window)) continue;
    if (audit.action === 'content.exception_edit') {
      corrections.edit += 1;
      corrections.total += 1;
      if (audit.published === true) corrections.publish += 1;
    } else if (audit.action === 'content.exception_reject') {
      corrections.reject += 1;
      corrections.total += 1;
    } else if (audit.action === 'content.recipe_rollback') {
      corrections.rollback += 1;
      corrections.total += 1;
    }
  }

  const durations: number[] = [];
  let open = 0;
  let closedUnmatched = 0;
  for (const exception of input.exceptions) {
    if (exception.status === 'open' || exception.resolvedAt == null || exception.resolvedAt === '') {
      open += 1;
      continue;
    }
    if (!instantInContentMetricsWindow(exception.resolvedAt, window)) continue;
    const opened = openedAtMs(exception, input.attempts);
    const resolved = instantMs(exception.resolvedAt);
    if (opened === null || resolved === null || resolved < opened) {
      closedUnmatched += 1;
      continue;
    }
    durations.push(resolved - opened);
  }

  const medianMs = medianMilliseconds(durations);
  const p90Ms = p90Milliseconds(durations);
  return {
    window,
    refreshCost: {
      microdollars,
      usd: formatMetricUsd(microdollars),
      byDay: [...byDay.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([day, spent]) => ({ day, microdollars: spent })),
    },
    automaticUpdates: {
      total: byKind.public_menu + byKind.venue_page + byKind.event_page + byKind.restaurant_page + byKind.other,
      byKind,
    },
    operatorCorrections: corrections,
    timePerException: {
      medianMs,
      p90Ms,
      medianHours: medianMs === null ? null : formatMetricHours(medianMs),
      p90Hours: p90Ms === null ? null : formatMetricHours(p90Ms),
      sampleSize: durations.length,
      open,
      closedUnmatched,
    },
  };
}

export function contentMetricsAllowed(
  supabaseUrl: string,
  env: Record<string, string | undefined> = process.env,
): { ok: true } | { ok: false; reason: string } {
  if (hostedSupabaseUrl(supabaseUrl) && env.WANDERBITE_CONTENT_METRICS_HOSTED_OK !== '1') {
    return {
      ok: false,
      reason:
        'Refused. This report is read-only. Hosted reads need Noah\'s separate OK, then WANDERBITE_CONTENT_METRICS_HOSTED_OK=1 for that run only. Do not point this at hosted.',
    };
  }
  return { ok: true };
}

export type ContentMetricsArgs =
  | { help: true }
  | { error: string }
  | { help: false; fixture: string | null; from: string | null; to: string | null };

export function parseContentMetricsArgs(argv: readonly string[]): ContentMetricsArgs {
  let help = false;
  let fixture: string | null = null;
  let from: string | null = null;
  let to: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--fixture' || arg === '--from' || arg === '--to') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) return { error: `${arg} needs a value` };
      i += 1;
      if (arg === '--fixture') fixture = value;
      if (arg === '--from') from = value;
      if (arg === '--to') to = value;
      continue;
    }
    return { error: `Unknown argument ${arg}` };
  }
  if (help) return { help: true };
  if ((from == null) !== (to == null)) return { error: 'Pass both --from and --to, or neither' };
  if (from != null && to != null && !contentMetricsWindow(from, to)) {
    return { error: '--from and --to must be YYYY-MM-DD Chicago dates, with --from on or before --to' };
  }
  return { help: false, fixture, from, to };
}

export function readContentMetricsFixture(value: unknown): ContentMetricsInput | { error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Fixture must be an object' };
  const record = value as Record<string, unknown>;
  const sources = readSources(record.sources);
  const attempts = readAttempts(record.attempts);
  const drafts = readDrafts(record.drafts);
  const ledger = readLedger(record.ledger);
  const audits = readAudits(record.audits);
  const exceptions = readExceptions(record.exceptions);
  if (typeof sources === 'string') return { error: sources };
  if (typeof attempts === 'string') return { error: attempts };
  if (typeof drafts === 'string') return { error: drafts };
  if (typeof ledger === 'string') return { error: ledger };
  if (typeof audits === 'string') return { error: audits };
  if (typeof exceptions === 'string') return { error: exceptions };
  return { sources, attempts, drafts, ledger, audits, exceptions };
}

function readSources(value: unknown): ContentMetricsSource[] | string {
  if (!Array.isArray(value)) return 'Fixture sources must be an array';
  const rows: ContentMetricsSource[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Fixture source is not an object';
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.kind !== 'string') return 'Fixture source needs id and kind';
    rows.push({ id: row.id, kind: row.kind });
  }
  return rows;
}

function readAttempts(value: unknown): ContentMetricsAttempt[] | string {
  if (!Array.isArray(value)) return 'Fixture attempts must be an array';
  const rows: ContentMetricsAttempt[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Fixture attempt is not an object';
    const row = item as Record<string, unknown>;
    if (typeof row.sourceId !== 'string' || typeof row.attemptedAt !== 'string' || typeof row.outcome !== 'string') {
      return 'Fixture attempt needs sourceId, attemptedAt, and outcome';
    }
    rows.push({ sourceId: row.sourceId, attemptedAt: row.attemptedAt, outcome: row.outcome });
  }
  return rows;
}

function readDrafts(value: unknown): ContentMetricsDraft[] | string {
  if (!Array.isArray(value)) return 'Fixture drafts must be an array';
  const rows: ContentMetricsDraft[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Fixture draft is not an object';
    const row = item as Record<string, unknown>;
    if (
      typeof row.sourceId !== 'string'
      || typeof row.subjectType !== 'string'
      || typeof row.status !== 'string'
      || typeof row.extractedAt !== 'string'
    ) {
      return 'Fixture draft needs sourceId, subjectType, status, and extractedAt';
    }
    const changeSummary = row.changeSummary;
    if (changeSummary != null && typeof changeSummary !== 'string') return 'Fixture changeSummary must be a string or null';
    rows.push({
      sourceId: row.sourceId,
      subjectType: row.subjectType,
      status: row.status,
      extractedAt: row.extractedAt,
      changeSummary: typeof changeSummary === 'string' ? changeSummary : null,
    });
  }
  return rows;
}

function readLedger(value: unknown): ContentMetricsLedgerRow[] | string {
  if (!Array.isArray(value)) return 'Fixture ledger must be an array';
  const rows: ContentMetricsLedgerRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Fixture ledger row is not an object';
    const row = item as Record<string, unknown>;
    if (typeof row.featureClass !== 'string' || typeof row.accountTier !== 'string' || typeof row.status !== 'string') {
      return 'Fixture ledger row needs featureClass, accountTier, and status';
    }
    if (typeof row.settledPlatformMicrodollars !== 'number') return 'Fixture settledPlatformMicrodollars must be a number';
    if (row.dayKey != null && typeof row.dayKey !== 'string') return 'Fixture dayKey must be a string or null';
    if (row.settledAt != null && typeof row.settledAt !== 'string') return 'Fixture settledAt must be a string or null';
    rows.push({
      featureClass: row.featureClass,
      accountTier: row.accountTier,
      status: row.status,
      dayKey: typeof row.dayKey === 'string' ? row.dayKey : null,
      settledAt: typeof row.settledAt === 'string' ? row.settledAt : null,
      settledPlatformMicrodollars: row.settledPlatformMicrodollars,
    });
  }
  return rows;
}

function readAudits(value: unknown): ContentMetricsAudit[] | string {
  if (!Array.isArray(value)) return 'Fixture audits must be an array';
  const rows: ContentMetricsAudit[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Fixture audit is not an object';
    const row = item as Record<string, unknown>;
    if (typeof row.action !== 'string' || typeof row.createdAt !== 'string') return 'Fixture audit needs action and createdAt';
    if (row.published != null && typeof row.published !== 'boolean') return 'Fixture published must be a boolean or null';
    rows.push({
      action: row.action,
      createdAt: row.createdAt,
      published: typeof row.published === 'boolean' ? row.published : null,
    });
  }
  return rows;
}

function readExceptions(value: unknown): ContentMetricsException[] | string {
  if (!Array.isArray(value)) return 'Fixture exceptions must be an array';
  const rows: ContentMetricsException[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Fixture exception is not an object';
    const row = item as Record<string, unknown>;
    if (typeof row.sourceId !== 'string' || typeof row.status !== 'string') {
      return 'Fixture exception needs sourceId and status';
    }
    if (row.resolvedAt != null && typeof row.resolvedAt !== 'string') return 'Fixture resolvedAt must be a string or null';
    rows.push({
      sourceId: row.sourceId,
      status: row.status,
      resolvedAt: typeof row.resolvedAt === 'string' ? row.resolvedAt : null,
    });
  }
  return rows;
}
