import { describe, expect, it } from 'vitest';
import { activitiesToExpire, type ExpirableActivity } from '@/lib/activities/expire';
import { chicagoCalendarDate, shiftCalendarDate } from '@/lib/activities/match';
import {
  ACTIVITY_MAINTENANCE_SKIP_REASON,
  prepareActivityMaintenance,
  type ActivityMaintenancePort,
} from '@/lib/content-pipeline/activity-maintenance';
import {
  EVENT_PAGE_REFRESH_AFTER_MS,
  VENUE_PAGE_REFRESH_AFTER_MS,
  activitySourceDue,
} from '@/lib/content-pipeline/activity-schedule';
import { allocateRefreshSources, selectDueActivitySources } from '@/lib/content-pipeline/registry';
import {
  CONTENT_MAX_ATTEMPTS,
  CONTENT_MAX_MODEL_CALLS,
  CONTENT_MAX_SOURCES,
  refreshContentSources,
  type ContentSourceRecord,
} from '@/lib/content-pipeline/refresh';
import { activityMaintenanceCronEnabled } from '@/lib/content-pipeline/review';

const QUIET = '<html><body><p>A fountain sits on the sample square near the restaurant.</p></body></html>';

const NOV_EVENING = new Date('2026-11-05T05:30:00.000Z');
const NOV_HALF_PAST = new Date('2026-11-05T06:30:00.000Z');
const SPRING_BEFORE = new Date('2026-03-08T05:30:00.000Z');
const SPRING_AFTER = new Date('2026-03-08T06:30:00.000Z');
const FALL_BEFORE = new Date('2026-11-01T04:30:00.000Z');
const FALL_HALF_PAST = new Date('2026-11-01T05:30:00.000Z');
const FALL_REPEATED = new Date('2026-11-01T07:30:00.000Z');

function dated(id: string, validUntil: string | null, status = 'active'): ExpirableActivity {
  return { id, name: id, status, valid_until: validUntil };
}

function source(id: string, kind: string, lastVerifiedAt: string | null, status = 'active'): ContentSourceRecord {
  return {
    id,
    kind,
    url: `https://example.com/${id}`,
    status: status as ContentSourceRecord['status'],
    lastAttemptedAt: null,
    lastVerifiedAt,
    lastContentHash: null,
  };
}

describe('activity maintenance flag', () => {
  it('is on only for the exact string true', () => {
    expect(activityMaintenanceCronEnabled('true')).toBe(true);
    for (const value of [undefined, '', 'TRUE', '1', 'true ', 'false']) {
      expect(activityMaintenanceCronEnabled(value)).toBe(false);
    }
  });
});

describe('activity source cadence', () => {
  const now = NOV_HALF_PAST;

  it('refreshes an event older than one day and a venue older than seven days', () => {
    const eventDue = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
    const eventExact = new Date(now.getTime() - EVENT_PAGE_REFRESH_AFTER_MS).toISOString();
    const eventJustOver = new Date(now.getTime() - EVENT_PAGE_REFRESH_AFTER_MS - 1).toISOString();
    const venueRecent = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const venueExact = new Date(now.getTime() - VENUE_PAGE_REFRESH_AFTER_MS).toISOString();
    const venueDue = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(activitySourceDue({ kind: 'event_page', lastVerifiedAt: eventDue }, now)).toBe(true);
    expect(activitySourceDue({ kind: 'event_page', lastVerifiedAt: eventExact }, now)).toBe(false);
    expect(activitySourceDue({ kind: 'event_page', lastVerifiedAt: eventJustOver }, now)).toBe(true);
    expect(activitySourceDue({ kind: 'event_page', lastVerifiedAt: null }, now)).toBe(true);
    expect(activitySourceDue({ kind: 'venue_page', lastVerifiedAt: venueRecent }, now)).toBe(false);
    expect(activitySourceDue({ kind: 'venue_page', lastVerifiedAt: venueExact }, now)).toBe(false);
    expect(activitySourceDue({ kind: 'venue_page', lastVerifiedAt: venueDue }, now)).toBe(true);
    expect(activitySourceDue({ kind: 'venue_page', lastVerifiedAt: null }, now)).toBe(true);
    expect(activitySourceDue({ kind: 'public_menu', lastVerifiedAt: null }, now)).toBe(false);
  });

  it('uses elapsed time across the spring-forward boundary', () => {
    const now = new Date('2026-03-09T06:30:00.000Z');
    const sameCalendarDayBut22h = '2026-03-08T08:30:00.000Z';
    const olderThanOneDay = '2026-03-08T05:00:00.000Z';
    expect(chicagoCalendarDate(new Date(sameCalendarDayBut22h))).toBe('2026-03-08');
    expect(chicagoCalendarDate(now)).toBe('2026-03-09');
    expect(activitySourceDue({ kind: 'event_page', lastVerifiedAt: sameCalendarDayBut22h }, now)).toBe(false);
    expect(activitySourceDue({ kind: 'event_page', lastVerifiedAt: olderThanOneDay }, now)).toBe(true);
  });

  it('orders nulls first, then oldest verification, then id', () => {
    const older = new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000).toISOString();
    const newer = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const rows = [
      source('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'venue_page', older),
      source('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'event_page', null),
      source('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'venue_page', older),
      source('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'event_page', newer),
      source('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'venue_page', new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()),
      source('ffffffff-ffff-4fff-8fff-ffffffffffff', 'venue_page', null, 'paused'),
    ];
    expect(selectDueActivitySources(rows, now).map((row) => row.id)).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    ]);
  });
});

describe('Chicago date boundaries for dated expiry', () => {
  it('expires yesterday at 12:30 AM Chicago and keeps today at 11:30 PM', () => {
    expect(chicagoCalendarDate(NOV_EVENING)).toBe('2026-11-04');
    expect(chicagoCalendarDate(NOV_HALF_PAST)).toBe('2026-11-05');
    const rows = [
      dated('yesterday', '2026-11-04'),
      dated('today', '2026-11-05'),
      dated('open', null),
      dated('paused', '2026-11-01', 'paused'),
    ];
    expect(activitiesToExpire(rows, NOV_EVENING).map((row) => row.id)).toEqual([]);
    expect(activitiesToExpire(rows, NOV_HALF_PAST).map((row) => row.id)).toEqual(['yesterday']);
  });

  it('keeps the Chicago date across the 2026 spring-forward and fall-back hours', () => {
    expect(chicagoCalendarDate(SPRING_BEFORE)).toBe('2026-03-07');
    expect(chicagoCalendarDate(SPRING_AFTER)).toBe('2026-03-08');
    expect(activitiesToExpire([dated('before', '2026-03-07')], SPRING_BEFORE)).toEqual([]);
    expect(activitiesToExpire([dated('before', '2026-03-07')], SPRING_AFTER).map((row) => row.id)).toEqual(['before']);
    expect(chicagoCalendarDate(FALL_BEFORE)).toBe('2026-10-31');
    expect(chicagoCalendarDate(FALL_HALF_PAST)).toBe('2026-11-01');
    expect(chicagoCalendarDate(FALL_REPEATED)).toBe('2026-11-01');
    expect(activitiesToExpire([dated('fall', '2026-10-31')], FALL_BEFORE)).toEqual([]);
    expect(activitiesToExpire([dated('fall', '2026-10-31')], FALL_HALF_PAST).map((row) => row.id)).toEqual(['fall']);
    expect(activitiesToExpire([dated('fall', '2026-11-01')], FALL_REPEATED)).toEqual([]);
  });

  it('shifts a calendar date without using the process time zone', () => {
    expect(shiftCalendarDate('2026-03-08', -1)).toBe('2026-03-07');
    expect(shiftCalendarDate('2026-11-01', -1)).toBe('2026-10-31');
  });
});

describe('shared refresh cap', () => {
  it('keeps the five-source, fifteen-attempt, and one-call limits', () => {
    expect(CONTENT_MAX_SOURCES).toBe(5);
    expect(CONTENT_MAX_ATTEMPTS).toBe(15);
    expect(CONTENT_MAX_MODEL_CALLS).toBe(5);
  });

  it('gives menus every slot they already use and fills the rest with due activities', () => {
    const menus = [source('menu-b', 'public_menu', null), source('menu-a', 'public_menu', null)];
    const due = [
      source('event-1', 'event_page', null),
      source('event-2', 'event_page', null),
      source('event-3', 'event_page', null),
      source('event-4', 'event_page', null),
    ];
    const split = allocateRefreshSources(menus, due, CONTENT_MAX_SOURCES);
    expect(split.selected.map((row) => row.id)).toEqual(['menu-b', 'menu-a', 'event-1', 'event-2', 'event-3']);
    expect(split.skipped.map((row) => row.id)).toEqual(['event-4']);

    const full = allocateRefreshSources(
      ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'],
      ['event'],
      CONTENT_MAX_SOURCES,
    );
    expect(full.selected).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(full.skipped).toEqual(['m6', 'event']);
  });

  it('starts at most five sources when more activities are due', async () => {
    const menus = [source('menu-1', 'public_menu', null)];
    const events = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map((id) => source(id, 'event_page', null));
    const due = selectDueActivitySources(events, NOV_HALF_PAST);
    const allocated = allocateRefreshSources(menus, due, CONTENT_MAX_SOURCES);
    const summary = await refreshContentSources({
      sources: [...allocated.selected, ...allocated.skipped],
      load: async () => ({ facts: [], recipes: [], openExceptions: [], activities: [], activityFacts: [] }),
      apply: false,
      htmlBySourceId: new Map(
        [...allocated.selected, ...allocated.skipped].map((row) => [row.id, QUIET]),
      ),
      maxRetries: 0,
      now: () => NOV_HALF_PAST,
    });
    expect(summary.results.map((row) => row.sourceId)).toEqual(['menu-1', 'e1', 'e2', 'e3', 'e4']);
    expect(summary.skips).toEqual(['e5: source cap', 'e6: source cap']);
    expect(summary.results.reduce((total, row) => total + row.modelCalls, 0)).toBe(0);
  });
});

describe('activity maintenance preparation', () => {
  const now = NOV_HALF_PAST;

  function port(calls: string[]): ActivityMaintenancePort {
    return {
      async probeSchema() {
        calls.push('probe');
        return { ok: true };
      },
      async listExpirable() {
        calls.push('list');
        return [
          dated('yesterday', '2026-11-04'),
          dated('today', '2026-11-05'),
          dated('open', null),
        ];
      },
      async expireDated(today) {
        calls.push(`expire:${today}`);
        return 1;
      },
      async listActiveActivitySources() {
        calls.push('sources');
        return [
          source('event', 'event_page', new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString()),
          source('venue-recent', 'venue_page', new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()),
          source('venue-old', 'venue_page', new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString()),
        ];
      },
    };
  }

  it('does not call the port when the flag is off', async () => {
    const calls: string[] = [];
    const result = await prepareActivityMaintenance({ enabled: false, now, port: port(calls) });
    expect(calls).toEqual([]);
    expect(result).toEqual({ sources: [], expired: 0, skip: null });
  });

  it('expires yesterday at 00:30 Chicago and returns only due activity sources', async () => {
    const calls: string[] = [];
    const result = await prepareActivityMaintenance({ enabled: true, now, port: port(calls) });
    expect(calls).toEqual(['probe', 'list', 'expire:2026-11-05', 'sources']);
    expect(result.expired).toBe(1);
    expect(result.skip).toBeNull();
    expect(result.sources.map((row) => row.id)).toEqual(['venue-old', 'event']);
  });

  it('logs one skip and returns no sources when the activities schema is missing', async () => {
    const warnings: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      for (const code of ['42P01', '42703', '42883', 'PGRST204', 'PGRST205']) {
        warnings.length = 0;
        const calls: string[] = [];
        const result = await prepareActivityMaintenance({
          enabled: true,
          now,
          port: {
            async probeSchema() {
              calls.push('probe');
              return { ok: false, error: { code, message: 'relation or column does not exist' } };
            },
            async listExpirable() {
              calls.push('list');
              return [];
            },
            async expireDated() {
              calls.push('expire');
              return 0;
            },
            async listActiveActivitySources() {
              calls.push('sources');
              return [];
            },
          },
        });
        expect(calls).toEqual(['probe']);
        expect(result.sources).toEqual([]);
        expect(result.skip).toBe(ACTIVITY_MAINTENANCE_SKIP_REASON);
        expect(warnings).toEqual([[`[content-refresh] ${ACTIVITY_MAINTENANCE_SKIP_REASON}`]]);
      }
    } finally {
      console.warn = original;
    }
  });
});
