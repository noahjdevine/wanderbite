import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import { levelForXp, PROGRESSION_SCHEDULE_V1 } from '@/lib/progression/schedule';
import { loadMemberProgression } from '@/lib/progression/member-progression';

const USER_ID = 'member-a';
const ROOT = path.resolve(__dirname, '../../..');
const CHICAGO_EDGE = '2027-01-01T05:30:00.000Z';

const EVENT_COLUMNS = 'schedule_version, source_kind';
const MILESTONE_COLUMNS = 'id, milestone_key, schedule_version, level, reached_at, quarter_key';
const ENTRY_COLUMNS = 'milestone_id, quarter_key, entry_source';

type Call = {
  table: string;
  columns: string;
  eqColumn: string;
  userId: string;
  order: string;
  from: number;
  to: number;
};

type Tables = Record<string, unknown[]>;

function events(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, () => ({
    schedule_version: 'v1',
    source_kind: 'verified_visit',
  }));
}

function client(options: {
  userId?: string | null;
  throwOnAuth?: boolean;
  tables?: Tables;
  failTable?: string;
  failPage?: number;
}) {
  const calls: Call[] = [];
  const rpcCalls: string[] = [];
  const tables = options.tables ?? {};
  const pages = new Map<string, number>();
  const supabase = {
    auth: {
      async getUser() {
        if (options.throwOnAuth) throw new Error('auth down');
        return {
          data: { user: options.userId ? { id: options.userId } : null },
          error: options.userId ? null : { message: 'session missing' },
        };
      },
    },
    rpc(fn: string) {
      rpcCalls.push(fn);
      throw new Error(`rpc ${fn}`);
    },
    from(table: string) {
      return {
        select(columns: string) {
          return {
            eq(eqColumn: string, userId: string) {
              return {
                order(order: string) {
                  return {
                    async range(from: number, to: number) {
                      calls.push({ table, columns, eqColumn, userId, order, from, to });
                      const seen = pages.get(table) ?? 0;
                      pages.set(table, seen + 1);
                      if (options.failTable === table && seen === (options.failPage ?? 0)) {
                        return { data: null, error: { message: 'read failed' } };
                      }
                      const rows = tables[table] ?? [];
                      return { data: rows.slice(from, to + 1), error: null };
                    },
                  };
                },
              };
            },
          };
        },
        insert() {
          throw new Error('insert');
        },
        update() {
          throw new Error('update');
        },
        delete() {
          throw new Error('delete');
        },
      };
    },
  };
  return {
    supabase: supabase as unknown as SupabaseClient<Database>,
    calls,
    rpcCalls,
  };
}

const storedMilestones = [
  {
    id: 'm4',
    milestone_key: 'v1:level:4',
    schedule_version: 'v1',
    level: 4,
    reached_at: CHICAGO_EDGE,
    quarter_key: '2026-Q4',
  },
  {
    id: 'm1',
    milestone_key: 'v1:level:1',
    schedule_version: 'v1',
    level: 1,
    reached_at: '2026-02-03T18:00:00.000Z',
    quarter_key: '2026-Q1',
  },
];

describe('loadMemberProgression', () => {
  it('reads the session user through the authenticated client', async () => {
    const { supabase, calls, rpcCalls } = client({
      userId: USER_ID,
      tables: {
        progression_events: [
          ...events(3),
          { schedule_version: 'v2', source_kind: 'verified_visit' },
        ],
        progression_milestones: storedMilestones,
        progression_drawing_entries: [
          { milestone_id: 'm4', quarter_key: '2026-Q4', entry_source: 'level_milestone' },
        ],
      },
    });

    const result = await loadMemberProgression(supabase);
    expect(rpcCalls).toEqual([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const level = levelForXp(300, PROGRESSION_SCHEDULE_V1);
    expect(result.summary.xp).toBe(300);
    expect(result.summary.visits).toBe(3);
    expect(result.summary).toMatchObject({
      level: level.level,
      name: level.name,
      nextLevel: level.nextLevel,
      progressPercent: level.progressPercent,
      consistent: false,
      ignored: { events: 1, milestones: 0, entries: 0 },
    });
    expect(result.summary.milestones).toEqual([
      {
        level: 1,
        name: 'The Explorer',
        reachedAt: '2026-02-03T18:00:00.000Z',
        quarterKey: '2026-Q1',
        hasEntry: false,
      },
      {
        level: 4,
        name: 'The Local Legend',
        reachedAt: CHICAGO_EDGE,
        quarterKey: '2026-Q4',
        hasEntry: true,
      },
    ]);
    expect(result.summary.entriesByQuarter).toEqual([{ quarterKey: '2026-Q4', count: 1 }]);

    expect(calls.map((call) => call.table).sort()).toEqual([
      'progression_drawing_entries',
      'progression_events',
      'progression_milestones',
    ]);
    expect(calls.every((call) => call.eqColumn === 'user_id' && call.userId === USER_ID)).toBe(true);
    expect(calls.every((call) => call.order === 'id' && call.from === 0 && call.to === 999)).toBe(true);
    expect(calls.find((call) => call.table === 'progression_events')?.columns).toBe(EVENT_COLUMNS);
    expect(calls.find((call) => call.table === 'progression_milestones')?.columns).toBe(MILESTONE_COLUMNS);
    expect(calls.find((call) => call.table === 'progression_drawing_entries')?.columns).toBe(ENTRY_COLUMNS);
  });

  it('returns the empty summary when the member has no rows', async () => {
    const { supabase, calls } = client({
      userId: USER_ID,
      tables: {
        progression_events: [],
        progression_milestones: [],
        progression_drawing_entries: [],
      },
    });
    await expect(loadMemberProgression(supabase)).resolves.toEqual({
      ok: true,
      summary: {
        xp: 0,
        visits: 0,
        level: 0,
        name: 'Getting started',
        nextLevel: { level: 1, name: 'The Explorer', xp: 300 },
        progressPercent: 0,
        milestones: [],
        entriesByQuarter: [],
        consistent: true,
        ignored: { events: 0, milestones: 0, entries: 0 },
      },
    });
    expect(calls).toHaveLength(3);
  });

  it('does not query when the session has no user', async () => {
    const signedOut = client({ userId: null });
    await expect(loadMemberProgression(signedOut.supabase)).resolves.toEqual({
      ok: false,
      error: 'signed_out',
    });
    expect(signedOut.calls).toEqual([]);

    const thrown = client({ throwOnAuth: true });
    await expect(loadMemberProgression(thrown.supabase)).resolves.toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(thrown.calls).toEqual([]);
  });

  it('returns unavailable when a ledger read fails', async () => {
    const { supabase } = client({
      userId: USER_ID,
      tables: { progression_events: events(1) },
      failTable: 'progression_milestones',
    });
    await expect(loadMemberProgression(supabase)).resolves.toEqual({
      ok: false,
      error: 'unavailable',
    });
  });

  it('pages events past the first thousand rows', async () => {
    const { supabase, calls } = client({
      userId: USER_ID,
      tables: {
        progression_events: events(1001),
        progression_milestones: [],
        progression_drawing_entries: [],
      },
    });
    const result = await loadMemberProgression(supabase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.visits).toBe(1001);
    expect(result.summary.xp).toBe(100100);
    const eventCalls = calls.filter((call) => call.table === 'progression_events');
    expect(eventCalls.map((call) => [call.from, call.to])).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(eventCalls.every((call) => call.userId === USER_ID)).toBe(true);
  });
});

describe('member progression loader source', () => {
  it('is server-only and does not import the service-role client', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/progression/member-progression.ts'), 'utf8');
    expect(source.startsWith("import 'server-only';")).toBe(true);
    expect(source).not.toMatch(/supabase-admin|getSupabaseAdmin|SUPABASE_SERVICE_ROLE|service_role|serviceRole/);
    expect(source).not.toMatch(/^import\s.*\bcreateClient\b/m);
    expect(source).not.toMatch(/from '@\/lib\/supabase\/server'/);
    expect(source).toMatch(/loadMemberProgression/);
  });

  it('is called only from the flag-gated Progress panel', () => {
    const allowed = new Set([
      'src/lib/progression/member-progression.ts',
      'src/lib/progression/member-progression.test.ts',
      'src/lib/progression/read-model.ts',
      'src/lib/progression/read-model.test.ts',
      'src/lib/progression/read-model.tz-probe.ts',
      'src/components/journey/journey-content.tsx',
      'src/components/journey/journey-content.test.tsx',
      'src/components/journey/progression-panel.test.tsx',
      'src/components/journey/progression-panel.tz-probe.tsx',
    ]);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name === 'node_modules' || name === '.next') continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const rel = path.relative(ROOT, full).replaceAll('\\', '/');
        if (allowed.has(rel)) continue;
        const text = readFileSync(full, 'utf8');
        if (text.includes('loadMemberProgression') || text.includes('summarizeMemberProgression')) {
          hits.push(rel);
        }
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(hits).toEqual([]);
  });
});
