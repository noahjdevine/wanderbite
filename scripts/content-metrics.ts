import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  chicagoDayStartUtc,
  contentMetricsAllowed,
  contentMetricsReport,
  contentMetricsWindow,
  defaultContentMetricsWindow,
  parseContentMetricsArgs,
  readContentMetricsFixture,
  type ContentMetricsAttempt,
  type ContentMetricsAudit,
  type ContentMetricsDraft,
  type ContentMetricsException,
  type ContentMetricsInput,
  type ContentMetricsLedgerRow,
  type ContentMetricsSource,
  type ContentMetricsWindow,
} from '../src/lib/content-pipeline/metrics';
import { shiftCalendarDate } from '../src/lib/activities/match';
import { containedRepoPath } from '../src/lib/recipes/menu-run';
import type { Database, Json } from '../src/types/database.types';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });

const HELP = `Read-only content refresh measurement. No model call, no web search, no Places call, and no writes.

  npm run content:metrics
  npm run content:metrics -- --from 2026-11-01 --to 2026-11-05
  npm run content:metrics -- --fixture scripts/fixtures/e06-content-metrics.json --from 2026-11-05 --to 2026-11-05

The default window is the last 7 America/Chicago calendar days, including today.
--from and --to are inclusive Chicago dates (YYYY-MM-DD). Pass both or neither.

Refresh cost is settled or assumed-spent G13-A maintenance (ops tier), attributed
to ai_requests.day_key. Automatic updates are ok and unchanged fetch attempts,
plus a pending activity or briefing draft that has no matching verification
attempt within 15 minutes. Operator corrections are publish/edit, reject, and
rollback audit rows. Time per exception is the Chicago elapsed time from the
latest ok or parse_error attempt to resolved_at. Open exceptions are counted
separately and are not in the median.

Stdout is JSON. This command does not write credits, offers, challenges,
redemptions, bookings, partnerships, or restaurant_briefing_facts.

Hosted reads need Noah's separate OK, then WANDERBITE_CONTENT_METRICS_HOSTED_OK=1
for that run. Do not point this at hosted.
`;

const PAGE = 1000;
const PAGE_CAP = 50;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function client(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  if (!url || !key) fail('content metrics needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  const allowed = contentMetricsAllowed(url);
  if (!allowed.ok) fail(allowed.reason);
  return createClient<Database>(url, key);
}

async function eachPage<T>(
  load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const from = page * PAGE;
    const { data, error } = await load(from, from + PAGE - 1);
    if (error) fail(`content metrics ${label} read failed`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
  fail(`content metrics ${label} read exceeded ${PAGE_CAP * PAGE} rows`);
}

function changeSummary(value: Json): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const summary = value.change_summary;
  return typeof summary === 'string' ? summary : null;
}

function publishedFlag(metadata: Json | null): boolean | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  return metadata.published === true;
}

async function loadInput(supabase: SupabaseClient<Database>, window: ContentMetricsWindow): Promise<ContentMetricsInput> {
  const start = chicagoDayStartUtc(window.from).toISOString();
  const end = chicagoDayStartUtc(shiftCalendarDate(window.to, 1)).toISOString();
  const [sources, attempts, drafts, ledger, audits, exceptions] = await Promise.all([
    eachPage<ContentMetricsSource>(async (from, to) => {
      const result = await supabase.from('content_sources').select('id, kind').order('id').range(from, to);
      return { data: result.data, error: result.error };
    }, 'sources'),
    eachPage<ContentMetricsAttempt>(async (from, to) => {
      const result = await supabase
        .from('source_fetch_attempts')
        .select('source_id, attempted_at, outcome')
        .order('id')
        .range(from, to);
      return {
        data: (result.data ?? []).map((row) => ({
          sourceId: row.source_id,
          attemptedAt: row.attempted_at,
          outcome: row.outcome,
        })),
        error: result.error,
      };
    }, 'attempts'),
    eachPage<ContentMetricsDraft>(async (from, to) => {
      const result = await supabase
        .from('source_facts')
        .select('source_id, subject_type, status, extracted_at, value')
        .gte('extracted_at', start)
        .lt('extracted_at', end)
        .order('id')
        .range(from, to);
      return {
        data: (result.data ?? []).map((row) => ({
          sourceId: row.source_id,
          subjectType: row.subject_type,
          status: row.status,
          extractedAt: row.extracted_at,
          changeSummary: changeSummary(row.value),
        })),
        error: result.error,
      };
    }, 'drafts'),
    eachPage<ContentMetricsLedgerRow>(async (from, to) => {
      const result = await supabase
        .from('ai_requests')
        .select('feature_class, account_tier, status, day_key, settled_at, settled_platform_microdollars')
        .eq('feature_class', 'maintenance')
        .eq('account_tier', 'ops')
        .in('status', ['settled', 'assumed_spent'])
        .gte('day_key', window.from)
        .lte('day_key', window.to)
        .order('id')
        .range(from, to);
      return {
        data: (result.data ?? []).map((row) => ({
          featureClass: row.feature_class,
          accountTier: row.account_tier,
          status: row.status,
          dayKey: row.day_key,
          settledAt: row.settled_at,
          settledPlatformMicrodollars: row.settled_platform_microdollars,
        })),
        error: result.error,
      };
    }, 'ledger'),
    eachPage<ContentMetricsAudit>(async (from, to) => {
      const result = await supabase
        .from('admin_audit_log')
        .select('action, created_at, metadata')
        .in('action', ['content.exception_edit', 'content.exception_reject', 'content.recipe_rollback'])
        .gte('created_at', start)
        .lt('created_at', end)
        .order('id')
        .range(from, to);
      return {
        data: (result.data ?? []).map((row) => ({
          action: row.action,
          createdAt: row.created_at,
          published: publishedFlag(row.metadata),
        })),
        error: result.error,
      };
    }, 'audits'),
    eachPage<ContentMetricsException>(async (from, to) => {
      const result = await supabase
        .from('content_exceptions')
        .select('source_id, status, resolved_at')
        .order('id')
        .range(from, to);
      return {
        data: (result.data ?? []).map((row) => ({
          sourceId: row.source_id,
          status: row.status,
          resolvedAt: row.resolved_at,
        })),
        error: result.error,
      };
    }, 'exceptions'),
  ]);
  return { sources, attempts, drafts, ledger, audits, exceptions };
}

function windowFromArgs(from: string | null, to: string | null): ContentMetricsWindow {
  if (from == null || to == null) return defaultContentMetricsWindow(new Date());
  const window = contentMetricsWindow(from, to);
  if (!window) fail('--from and --to must be YYYY-MM-DD Chicago dates, with --from on or before --to');
  return window;
}

async function main(): Promise<void> {
  const parsed = parseContentMetricsArgs(process.argv.slice(2));
  if ('error' in parsed) fail(parsed.error);
  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }
  const window = windowFromArgs(parsed.from, parsed.to);
  if (parsed.fixture) {
    const fullPath = containedRepoPath(parsed.fixture, process.cwd());
    if (!fullPath) fail('fixture path must stay inside the repo');
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(readFileSync(fullPath, 'utf8')) as unknown;
    } catch {
      fail('fixture was not readable JSON');
    }
    const fixture = readContentMetricsFixture(parsedJson);
    if ('error' in fixture) fail(fixture.error);
    process.stdout.write(`${JSON.stringify(contentMetricsReport(fixture, window), null, 2)}\n`);
    return;
  }
  const report = contentMetricsReport(await loadInput(client(), window), window);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'content metrics failed';
  fail(message);
});
