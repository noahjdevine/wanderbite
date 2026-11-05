// Cron-path expiry against the disposable database. Flag off must not touch activities.
import assert from 'node:assert/strict';
import { chicagoCalendarDate } from '../src/lib/activities/match';
import {
  prepareActivityMaintenance,
  type ActivityMaintenancePort,
} from '../src/lib/content-pipeline/activity-maintenance';
import { allocateRefreshSources } from '../src/lib/content-pipeline/registry';
import { CONTENT_MAX_SOURCES, type ContentSourceRecord } from '../src/lib/content-pipeline/refresh';

const YESTERDAY = 'e06b2000-0000-4000-8000-000000000001';
const TODAY = 'e06b2000-0000-4000-8000-000000000002';
const UNDATED = 'e06b2000-0000-4000-8000-000000000003';
const PAUSED = 'e06b2000-0000-4000-8000-000000000004';
const EVENT = 'e06b2000-0000-4000-8000-000000000011';
const VENUE_RECENT = 'e06b2000-0000-4000-8000-000000000012';
const VENUE_OLD = 'e06b2000-0000-4000-8000-000000000013';
const MENU = 'e06b2000-0000-4000-8000-000000000014';
const ACTIVITY_IDS = [YESTERDAY, TODAY, UNDATED, PAUSED];
const SOURCE_IDS = [EVENT, VENUE_RECENT, VENUE_OLD, MENU];

const NOW = new Date('2026-11-05T06:30:00.000Z');

function assertUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`refusing non-uuid ${value}`);
  }
  return value;
}

function assertDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`refusing non-date ${value}`);
  return value;
}

function lines(raw: string): string[] {
  return raw.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

export async function runE06B2ActivityMaintenanceDb(opts: {
  sql: (query: string) => string;
}): Promise<void> {
  const { sql } = opts;
  assert.equal(chicagoCalendarDate(NOW), '2026-11-05');
  const before = snapshot(sql);
  const eventVerified = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
  const venueRecent = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const venueOld = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
  try {
    sql(`
      insert into public.content_sources (id, kind, url, status, notes, last_verified_at) values
        ('${EVENT}', 'event_page', 'https://example.com/e06b2-event', 'active', 'E06-B2 event fixture.', '${eventVerified}'),
        ('${VENUE_RECENT}', 'venue_page', 'https://example.com/e06b2-venue-recent', 'active', 'E06-B2 recent venue fixture.', '${venueRecent}'),
        ('${VENUE_OLD}', 'venue_page', 'https://example.com/e06b2-venue-old', 'active', 'E06-B2 old venue fixture.', '${venueOld}'),
        ('${MENU}', 'public_menu', 'https://example.com/e06b2-menu', 'active', 'E06-B2 menu fixture.', null);
      insert into public.activities (
        id, name, category, source_url, content_source_id, zip, cost_category, hours_note, valid_until, status, is_sample
      ) values
        ('${YESTERDAY}', 'E06 B2 Yesterday', 'walk', 'https://example.com/e06b2-event', '${EVENT}', '75069', 'free', 'Afternoons on the sample listing', '2026-11-04', 'active', true),
        ('${TODAY}', 'E06 B2 Today', 'arts', 'https://example.com/e06b2-today', null, '75069', 'free', null, '2026-11-05', 'active', true),
        ('${UNDATED}', 'E06 B2 Undated', 'museum', 'https://example.com/e06b2-undated', null, '75069', 'free', null, null, 'active', true),
        ('${PAUSED}', 'E06 B2 Paused', 'sports', 'https://example.com/e06b2-paused', null, '75069', 'free', null, '2026-11-01', 'paused', true);
    `);

    const guardedCalls: string[] = [];
    const guarded = guardedPort(guardedCalls);
    const off = await prepareActivityMaintenance({ enabled: false, now: NOW, port: guarded });
    assert.deepEqual(off, { sources: [], expired: 0, skip: null });
    assert.deepEqual(guardedCalls, []);
    assert.equal(statusOf(sql, YESTERDAY), 'active');
    assert.equal(statusOf(sql, TODAY), 'active');
    assert.equal(statusOf(sql, UNDATED), 'active');
    assert.equal(statusOf(sql, PAUSED), 'paused');
    assert.equal(sql(`select count(*) from public.activities where id in (${idList(ACTIVITY_IDS)})`).trim(), '4');

    const on = await prepareActivityMaintenance({
      enabled: true,
      now: NOW,
      port: psqlPort(sql),
    });
    assert.equal(on.skip, null);
    assert.equal(on.expired, 1);
    assert.deepEqual(on.sources.map((row) => row.id), [VENUE_OLD, EVENT]);
    assert.equal(statusOf(sql, YESTERDAY), 'expired');
    assert.equal(statusOf(sql, TODAY), 'active');
    assert.equal(statusOf(sql, UNDATED), 'active');
    assert.equal(statusOf(sql, PAUSED), 'paused');
    assert.equal(sql(`select hours_note from public.activities where id = '${YESTERDAY}'`).trim(), 'Afternoons on the sample listing');
    assert.equal(sql(`select count(*) from public.activities where id in (${idList(ACTIVITY_IDS)})`).trim(), '4');
    assert.equal(sql(`select count(*) from public.source_fetch_attempts where source_id in (${idList(SOURCE_IDS)})`).trim(), '0');
    assert.equal(sql(`select count(*) from public.content_exceptions where source_id in (${idList(SOURCE_IDS)})`).trim(), '0');
    assert.equal(sql(`select count(*) from public.source_facts where source_id in (${idList(SOURCE_IDS)})`).trim(), '0');

    const menu = psqlPort(sql);
    const menus = (await menu.listActiveActivitySources()).filter((row) => row.kind === 'public_menu');
    assert.equal(menus.length, 0);
    const menuRow = readMenu(sql);
    const split = allocateRefreshSources([menuRow], on.sources, CONTENT_MAX_SOURCES);
    assert.deepEqual(split.selected.map((row) => row.id), [MENU, VENUE_OLD, EVENT]);
    assert.deepEqual(split.skipped, []);

    const after = snapshot(sql);
    assert.equal(after.challenges, before.challenges);
    assert.equal(after.redemptions, before.redemptions);
    assert.equal(after.offers, before.offers);
    assert.equal(after.credits, before.credits);
    assert.equal(after.activities - before.activities, 4);
  } finally {
    sql(`
      delete from public.activities where id in (${idList(ACTIVITY_IDS)});
      delete from public.content_sources where id in (${idList(SOURCE_IDS)});
    `);
  }
}

function idList(ids: readonly string[]): string {
  return ids.map((id) => `'${assertUuid(id)}'`).join(', ');
}

function statusOf(sql: (query: string) => string, id: string): string {
  return sql(`select status from public.activities where id = '${assertUuid(id)}'`).trim();
}

function snapshot(sql: (query: string) => string): {
  challenges: string;
  redemptions: string;
  offers: string;
  credits: string;
  activities: number;
} {
  const [challenges, redemptions, offers, credits, activities] = lines(sql(`
    select
      (select count(*) from public.challenge_items),
      (select count(*) from public.redemptions),
      (select count(*) from public.restaurant_offers),
      (select count(*) from public.entitlement_credits),
      (select count(*) from public.activities);
  `))[0]?.split('|') ?? [];
  return {
    challenges: challenges ?? '',
    redemptions: redemptions ?? '',
    offers: offers ?? '',
    credits: credits ?? '',
    activities: Number(activities),
  };
}

function readMenu(sql: (query: string) => string): ContentSourceRecord {
  const raw = sql(`
    select id || '|' || kind || '|' || url || '|' || status
    from public.content_sources
    where id = '${MENU}';
  `).trim();
  const [id, kind, url, status] = raw.split('|');
  if (!id || !kind || !url || !status) throw new Error('menu fixture missing');
  return {
    id,
    kind,
    url,
    status: status as ContentSourceRecord['status'],
    lastAttemptedAt: null,
    lastVerifiedAt: null,
    lastContentHash: null,
  };
}

function guardedPort(calls: string[]): ActivityMaintenancePort {
  const refuse = async (name: string): Promise<never> => {
    calls.push(name);
    throw new Error(`flag off called ${name}`);
  };
  return {
    probeSchema: () => refuse('probe'),
    listExpirable: () => refuse('list'),
    expireDated: () => refuse('expire'),
    listActiveActivitySources: () => refuse('sources'),
  };
}

function psqlPort(sql: (query: string) => string): ActivityMaintenancePort {
  return {
    async probeSchema() {
      sql(`select id, content_source_id, status, valid_until from public.activities limit 1`);
      return { ok: true };
    },
    async listExpirable() {
      const raw = sql(`
        select id || '|' || name || '|' || status || '|' || coalesce(valid_until::text, '')
        from public.activities
        where status = 'active'
        order by id;
      `);
      return lines(raw).map((line) => {
        const [id, name, status, validUntil] = line.split('|');
        if (!id || !name || !status) throw new Error(`bad activity row ${line}`);
        return {
          id: assertUuid(id),
          name,
          status,
          valid_until: validUntil ? assertDate(validUntil) : null,
        };
      });
    },
    async expireDated(today) {
      const count = sql(`select public.expire_dated_activities('${assertDate(today)}'::date)`).trim();
      const parsed = Number(count);
      if (!Number.isInteger(parsed)) throw new Error(`bad expire count ${count}`);
      return parsed;
    },
    async listActiveActivitySources() {
      const raw = sql(`
        select id || '|' || kind || '|' || url || '|' || status || '|' ||
          coalesce(to_char(last_verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '')
        from public.content_sources
        where status = 'active'
          and kind in ('venue_page', 'event_page')
        order by id;
      `);
      return lines(raw).map((line) => {
        const [id, kind, url, status, verified] = line.split('|');
        if (!id || !kind || !url || !status) throw new Error(`bad source row ${line}`);
        return {
          id: assertUuid(id),
          kind,
          url,
          status: status as ContentSourceRecord['status'],
          lastAttemptedAt: null,
          lastVerifiedAt: verified || null,
          lastContentHash: null,
        };
      });
    },
  };
}
