import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  chicagoDayStartUtc,
  contentMetricsAllowed,
  contentMetricsReport,
  defaultContentMetricsWindow,
  instantInContentMetricsWindow,
  parseContentMetricsArgs,
  readContentMetricsFixture,
  type ContentMetricsInput,
  type ContentMetricsReport,
  type ContentMetricsWindow,
} from '@/lib/content-pipeline/metrics';

const WINDOW: ContentMetricsWindow = { from: '2026-11-05', to: '2026-11-05', timeZone: 'America/Chicago' };
const FIXTURE_PATH = path.join(process.cwd(), 'scripts/fixtures/e06-content-metrics.json');

function fixtureInput(): ContentMetricsInput {
  const parsed = readContentMetricsFixture(JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as unknown);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed;
}

function expectFiniteReport(report: ContentMetricsReport): void {
  expect(Number.isFinite(report.refreshCost.microdollars)).toBe(true);
  expect(Number.isFinite(report.automaticUpdates.total)).toBe(true);
  expect(Number.isFinite(report.operatorCorrections.total)).toBe(true);
  expect(report.timePerException.medianMs).not.toBeNull();
  expect(report.timePerException.p90Ms).not.toBeNull();
  expect(Number.isFinite(report.timePerException.medianMs)).toBe(true);
  expect(Number.isFinite(report.timePerException.p90Ms)).toBe(true);
}

describe('content metrics', () => {
  it('matches the fixture math for one Chicago day', () => {
    const report = contentMetricsReport(fixtureInput(), WINDOW);
    expectFiniteReport(report);
    expect(report.refreshCost.microdollars).toBe(250000);
    expect(report.refreshCost.usd).toBe('0.250000');
    expect(report.refreshCost.byDay).toEqual([{ day: '2026-11-05', microdollars: 250000 }]);
    expect(report.automaticUpdates.total).toBe(3);
    expect(report.automaticUpdates.byKind).toEqual({
      public_menu: 1,
      venue_page: 1,
      event_page: 0,
      restaurant_page: 1,
      other: 0,
    });
    expect(report.operatorCorrections).toEqual({ total: 1, publish: 1, edit: 1, reject: 0, rollback: 0 });
    expect(report.timePerException).toEqual({
      medianMs: 5_400_000,
      p90Ms: 5_400_000,
      medianHours: '1.500',
      p90Hours: '1.500',
      sampleSize: 1,
      open: 1,
      closedUnmatched: 0,
    });
  });

  it('reports refresh cost 0 when the window has no maintenance spend', () => {
    const input = fixtureInput();
    const report = contentMetricsReport({ ...input, ledger: [] }, WINDOW);
    expect(report.refreshCost.microdollars).toBe(0);
    expect(report.refreshCost.usd).toBe('0.000000');
    expect(report.refreshCost.byDay).toEqual([]);
    expect(report.automaticUpdates.total).toBe(3);
    expect(report.operatorCorrections.total).toBe(1);
    expect(report.timePerException.medianMs).toBe(5_400_000);
    expect(report.timePerException.open).toBe(1);
  });

  it('excludes an open exception with no resolve time from the duration', () => {
    const input = fixtureInput();
    const openOnly = contentMetricsReport({
      ...input,
      exceptions: [{ sourceId: 'event', status: 'open', resolvedAt: null }],
    }, WINDOW);
    expect(openOnly.timePerException.sampleSize).toBe(0);
    expect(openOnly.timePerException.medianMs).toBeNull();
    expect(openOnly.timePerException.p90Ms).toBeNull();
    expect(openOnly.timePerException.medianHours).toBeNull();
    expect(openOnly.timePerException.open).toBe(1);
    expect(openOnly.timePerException.closedUnmatched).toBe(0);
  });

  it('uses day_key when settled_at falls on the next Chicago day', () => {
    const report = contentMetricsReport({
      sources: [],
      attempts: [],
      drafts: [],
      audits: [],
      exceptions: [],
      ledger: [{
        featureClass: 'maintenance',
        accountTier: 'ops',
        status: 'assumed_spent',
        dayKey: '2026-11-05',
        settledAt: '2026-11-06T06:30:00.000Z',
        settledPlatformMicrodollars: 12,
      }],
    }, WINDOW);
    expect(report.refreshCost.microdollars).toBe(12);
    expect(report.refreshCost.usd).toBe('0.000012');
    const nextDay = contentMetricsReport({
      sources: [],
      attempts: [],
      drafts: [],
      audits: [],
      exceptions: [],
      ledger: [{
        featureClass: 'maintenance',
        accountTier: 'ops',
        status: 'settled',
        dayKey: '2026-11-06',
        settledAt: '2026-11-06T05:30:00.000Z',
        settledPlatformMicrodollars: 12,
      }],
    }, WINDOW);
    expect(nextDay.refreshCost.microdollars).toBe(0);
  });

  it('does not double-count a draft written with its verification attempt', () => {
    const report = contentMetricsReport({
      sources: [{ id: 'venue', kind: 'venue_page' }],
      attempts: [{ sourceId: 'venue', attemptedAt: '2026-11-05T18:00:00.000Z', outcome: 'ok' }],
      drafts: [{
        sourceId: 'venue',
        subjectType: 'activity',
        status: 'pending_review',
        extractedAt: '2026-11-05T18:00:02.000Z',
        changeSummary: 'Summary updated.',
      }],
      ledger: [],
      audits: [],
      exceptions: [],
    }, WINDOW);
    expect(report.automaticUpdates.total).toBe(1);
    expect(report.automaticUpdates.byKind.venue_page).toBe(1);
  });

  it('counts a rejected draft that kept its change summary and ignores recipe baselines', () => {
    const report = contentMetricsReport({
      sources: [{ id: 'restaurant', kind: 'restaurant_page' }, { id: 'menu', kind: 'public_menu' }],
      attempts: [],
      drafts: [
        {
          sourceId: 'restaurant',
          subjectType: 'briefing',
          status: 'rejected',
          extractedAt: '2026-11-05T16:00:00.000Z',
          changeSummary: 'Attire note changed.',
        },
        {
          sourceId: 'menu',
          subjectType: 'recipe',
          status: 'current',
          extractedAt: '2026-11-05T16:00:00.000Z',
          changeSummary: null,
        },
      ],
      ledger: [],
      audits: [],
      exceptions: [],
    }, WINDOW);
    expect(report.automaticUpdates.total).toBe(1);
    expect(report.automaticUpdates.byKind.restaurant_page).toBe(1);
    expect(report.automaticUpdates.byKind.public_menu).toBe(0);
  });

  it('measures a closed exception from the latest opening attempt and leaves a later unchanged fetch out of the clock', () => {
    const report = contentMetricsReport({
      sources: [{ id: 'menu', kind: 'public_menu' }],
      attempts: [
        { sourceId: 'menu', attemptedAt: '2026-11-05T12:00:00.000Z', outcome: 'parse_error' },
        { sourceId: 'menu', attemptedAt: '2026-11-05T18:00:00.000Z', outcome: 'unchanged' },
      ],
      drafts: [],
      ledger: [],
      audits: [
        { action: 'content.exception_reject', createdAt: '2026-11-05T19:00:00.000Z', published: false },
        { action: 'content.recipe_rollback', createdAt: '2026-11-05T19:05:00.000Z', published: null },
        { action: 'content.source_pause', createdAt: '2026-11-05T19:06:00.000Z', published: null },
      ],
      exceptions: [
        { sourceId: 'menu', status: 'rejected', resolvedAt: '2026-11-05T13:00:00.000Z' },
        { sourceId: 'menu', status: 'approved', resolvedAt: '2026-11-04T13:00:00.000Z' },
      ],
    }, WINDOW);
    expect(report.timePerException.medianMs).toBe(3_600_000);
    expect(report.timePerException.sampleSize).toBe(1);
    expect(report.timePerException.open).toBe(0);
    expect(report.automaticUpdates.byKind.public_menu).toBe(1);
    expect(report.operatorCorrections).toEqual({ total: 2, publish: 0, edit: 0, reject: 1, rollback: 1 });
  });

  it('averages an even median and uses nearest-rank p90', () => {
    const durations = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((hour) => ({
      sourceId: `s${hour}`,
      status: 'edited',
      resolvedAt: '2026-11-05T18:00:00.000Z',
    }));
    const attempts = durations.map((exception, index) => ({
      sourceId: exception.sourceId,
      attemptedAt: new Date(Date.parse('2026-11-05T18:00:00.000Z') - (index + 1) * 3_600_000).toISOString(),
      outcome: 'ok',
    }));
    const report = contentMetricsReport({
      sources: [],
      attempts,
      drafts: [],
      ledger: [],
      audits: [],
      exceptions: durations,
    }, WINDOW);
    expect(report.timePerException.sampleSize).toBe(10);
    expect(report.timePerException.medianMs).toBe(Math.round((5 * 3_600_000 + 6 * 3_600_000) / 2));
    expect(report.timePerException.p90Ms).toBe(9 * 3_600_000);
    expect(report.timePerException.medianHours).toBe('5.500');
    expect(report.timePerException.p90Hours).toBe('9.000');
  });

  it('keeps a late-evening Chicago instant on the previous calendar day under UTC and America/Chicago', () => {
    const evening = '2026-11-06T05:30:00.000Z';
    const nextMidnight = '2026-11-06T06:00:00.000Z';
    expect(instantInContentMetricsWindow(evening, WINDOW)).toBe(true);
    expect(instantInContentMetricsWindow(nextMidnight, WINDOW)).toBe(false);
    expect(defaultContentMetricsWindow(new Date(evening))).toEqual({
      from: '2026-10-30',
      to: '2026-11-05',
      timeZone: 'America/Chicago',
    });
    expect(chicagoDayStartUtc('2026-11-05').toISOString()).toBe('2026-11-05T06:00:00.000Z');
    expect(chicagoDayStartUtc('2026-07-15').toISOString()).toBe('2026-07-15T05:00:00.000Z');
    expect(chicagoDayStartUtc('2026-11-01').toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(chicagoDayStartUtc('2026-11-02').toISOString()).toBe('2026-11-02T06:00:00.000Z');
    const julyWindow: ContentMetricsWindow = { from: '2026-07-15', to: '2026-07-15', timeZone: 'America/Chicago' };
    expect(instantInContentMetricsWindow('2026-07-16T04:30:00.000Z', julyWindow)).toBe(true);
    expect(instantInContentMetricsWindow('2026-07-16T05:00:00.000Z', julyWindow)).toBe(false);

    const expression = `
      import { defaultContentMetricsWindow, instantInContentMetricsWindow } from './src/lib/content-pipeline/metrics.ts';
      const window = defaultContentMetricsWindow(new Date('2026-11-06T05:30:00.000Z'));
      const fixed = { from: '2026-11-05', to: '2026-11-05', timeZone: 'America/Chicago' };
      process.stdout.write(JSON.stringify({
        from: window.from,
        to: window.to,
        evening: instantInContentMetricsWindow('2026-11-06T05:30:00.000Z', fixed),
        next: instantInContentMetricsWindow('2026-11-06T06:00:00.000Z', fixed),
      }));
    `;
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    for (const tz of ['UTC', 'America/Chicago']) {
      const result = spawnSync(tsx, ['-e', expression], {
        cwd: process.cwd(),
        env: { ...process.env, TZ: tz },
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        from: '2026-10-30',
        to: '2026-11-05',
        evening: true,
        next: false,
      });
    }
  });

  it('prints the fixture report from the CLI', () => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const result = spawnSync(tsx, [
      'scripts/content-metrics.ts',
      '--fixture',
      'scripts/fixtures/e06-content-metrics.json',
      '--from',
      '2026-11-05',
      '--to',
      '2026-11-05',
    ], {
      cwd: process.cwd(),
      env: { ...process.env, TZ: 'UTC' },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as ContentMetricsReport;
    expectFiniteReport(report);
    expect(report.refreshCost.microdollars).toBe(250000);
    expect(report.automaticUpdates.total).toBe(3);
    expect(report.operatorCorrections.total).toBe(1);
    expect(report.timePerException.medianMs).toBe(5_400_000);
    expect(report.timePerException.open).toBe(1);
  });

  it('parses the window flags and refuses a hosted URL by default', () => {
    expect(parseContentMetricsArgs(['--help'])).toEqual({ help: true });
    expect(parseContentMetricsArgs(['--from', '2026-11-05'])).toEqual({ error: 'Pass both --from and --to, or neither' });
    expect(parseContentMetricsArgs(['--from', '2026-11-06', '--to', '2026-11-05'])).toEqual({
      error: '--from and --to must be YYYY-MM-DD Chicago dates, with --from on or before --to',
    });
    expect(parseContentMetricsArgs(['--fixture', 'scripts/fixtures/e06-content-metrics.json'])).toEqual({
      help: false,
      fixture: 'scripts/fixtures/e06-content-metrics.json',
      from: null,
      to: null,
    });
    expect(contentMetricsAllowed('http://127.0.0.1:54321', {}).ok).toBe(true);
    expect(contentMetricsAllowed('https://yiajoycgiyxjvznndjge.supabase.co', {}).ok).toBe(false);
    expect(contentMetricsAllowed('https://yiajoycgiyxjvznndjge.supabase.co', {
      WANDERBITE_CONTENT_METRICS_HOSTED_OK: '1',
    }).ok).toBe(true);
  });
});
