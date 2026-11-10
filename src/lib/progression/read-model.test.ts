import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chicagoQuarterKey } from '@/lib/progression/quarter';
import {
  summarizeMemberProgression,
  type MemberProgressionRows,
} from '@/lib/progression/read-model';
import {
  levelForXp,
  PROGRESSION_SCHEDULE_V1,
  tierForLevel,
  type ProgressionSchedule,
} from '@/lib/progression/schedule';

/** 2026-12-31 23:30 America/Chicago. The UTC calendar date is 2027-01-01. */
const CHICAGO_EDGE = '2027-01-01T05:30:00.000Z';

const ROOT = path.resolve(__dirname, '../../..');

function events(count: number, extra: Record<string, unknown> = {}): Record<string, unknown>[] {
  return Array.from({ length: count }, () => ({
    schedule_version: 'v1',
    source_kind: 'verified_visit',
    ...extra,
  }));
}

function milestone(level: number, reachedAt: string, quarterKey: string): Record<string, unknown> {
  return {
    id: `milestone-${level}`,
    milestone_key: `v1:level:${level}`,
    schedule_version: 'v1',
    level,
    reached_at: reachedAt,
    quarter_key: quarterKey,
  };
}

function entry(level: number, quarterKey: string): Record<string, unknown> {
  return {
    milestone_id: `milestone-${level}`,
    quarter_key: quarterKey,
    entry_source: 'level_milestone',
  };
}

const thirtySix: MemberProgressionRows = {
  events: events(36),
  milestones: [
    milestone(5, '2027-01-15T18:00:00.000Z', '2027-Q1'),
    // February is stored as Q3 on purpose. A recomputed Chicago quarter would be Q1.
    milestone(1, '2026-02-03T18:00:00.000Z', '2026-Q3'),
    milestone(4, CHICAGO_EDGE, '2026-Q4'),
    milestone(2, '2026-04-10T18:00:00.000Z', '2026-Q2'),
    milestone(3, '2026-06-15T18:00:00.000Z', '2026-Q2'),
  ],
  entries: [
    entry(2, '2026-Q2'),
    entry(3, '2026-Q2'),
    entry(5, '2027-Q1'),
  ],
};

describe('summarizeMemberProgression', () => {
  it('reconstructs 36 visits as level 5 and keeps stored milestone fields', () => {
    const summary = summarizeMemberProgression(thirtySix);
    const level = levelForXp(3600, PROGRESSION_SCHEDULE_V1);
    expect(summary.xp).toBe(3600);
    expect(summary.visits).toBe(36);
    expect(summary.level).toBe(5);
    expect(summary.name).toBe('The Local Legend II');
    expect(summary.nextLevel).toEqual({ level: 6, name: 'The Local Legend III', xp: 4500 });
    expect(summary.progressPercent).toBe(level.progressPercent);
    expect(summary).toMatchObject({
      level: level.level,
      name: level.name,
      nextLevel: level.nextLevel,
      progressPercent: level.progressPercent,
    });
    expect(chicagoQuarterKey(CHICAGO_EDGE)).toBe('2026-Q4');
    expect(summary.milestones).toEqual([
      {
        level: 1,
        name: 'The Explorer',
        reachedAt: '2026-02-03T18:00:00.000Z',
        quarterKey: '2026-Q3',
        hasEntry: false,
      },
      {
        level: 2,
        name: 'The Tastemaker',
        reachedAt: '2026-04-10T18:00:00.000Z',
        quarterKey: '2026-Q2',
        hasEntry: true,
      },
      {
        level: 3,
        name: 'The Connoisseur',
        reachedAt: '2026-06-15T18:00:00.000Z',
        quarterKey: '2026-Q2',
        hasEntry: true,
      },
      {
        level: 4,
        name: 'The Local Legend',
        reachedAt: CHICAGO_EDGE,
        quarterKey: '2026-Q4',
        hasEntry: false,
      },
      {
        level: 5,
        name: 'The Local Legend II',
        reachedAt: '2027-01-15T18:00:00.000Z',
        quarterKey: '2027-Q1',
        hasEntry: true,
      },
    ]);
    expect(summary.milestones.map((row) => row.name)).toEqual(
      [1, 2, 3, 4, 5].map((levelNumber) => tierForLevel(levelNumber, PROGRESSION_SCHEDULE_V1)?.name),
    );
    expect(summary.entriesByQuarter).toEqual([
      { quarterKey: '2026-Q2', count: 2 },
      { quarterKey: '2027-Q1', count: 1 },
    ]);
    expect(summary.consistent).toBe(true);
    expect(summary.ignored).toEqual({ events: 0, milestones: 0, entries: 0 });
  });

  it('sets hasEntry only for milestones that have an entry row', () => {
    const summary = summarizeMemberProgression({
      events: events(15),
      milestones: [
        milestone(1, '2026-06-01T18:00:00.000Z', '2026-Q2'),
        milestone(2, '2026-12-31T23:30:00-06:00', '2026-Q4'),
        milestone(3, '2027-02-01T18:00:00.000Z', '2027-Q1'),
      ],
      entries: [entry(3, '2027-Q1')],
    });
    expect(summary.milestones.map((row) => [row.level, row.hasEntry, row.quarterKey])).toEqual([
      [1, false, '2026-Q2'],
      [2, false, '2026-Q4'],
      [3, true, '2027-Q1'],
    ]);
    expect(summary.milestones[1]?.reachedAt).toBe('2026-12-31T23:30:00-06:00');
    expect(summary.entriesByQuarter).toEqual([{ quarterKey: '2027-Q1', count: 1 }]);
    expect(summary.consistent).toBe(true);
  });

  it('returns the empty schedule state when the member has no rows', () => {
    const summary = summarizeMemberProgression({ events: [], milestones: [], entries: [] });
    const level = levelForXp(0, PROGRESSION_SCHEDULE_V1);
    expect(summary).toEqual({
      xp: 0,
      visits: 0,
      level: 0,
      name: level.name,
      nextLevel: { level: 1, name: 'The Explorer', xp: 300 },
      progressPercent: level.progressPercent,
      milestones: [],
      entriesByQuarter: [],
      consistent: true,
      ignored: { events: 0, milestones: 0, entries: 0 },
    });
    expect(summary.progressPercent).toBe(0);
  });

  it('reports a missing milestone as stored and marks the summary inconsistent', () => {
    const rows: MemberProgressionRows = {
      events: events(36),
      milestones: [
        milestone(1, '2026-02-03T18:00:00.000Z', '2026-Q1'),
        milestone(2, '2026-04-10T18:00:00.000Z', '2026-Q2'),
        milestone(4, CHICAGO_EDGE, '2026-Q4'),
        milestone(5, '2027-01-15T18:00:00.000Z', '2027-Q1'),
      ],
      entries: [],
    };
    const summary = summarizeMemberProgression(rows);
    expect(summary.xp).toBe(3600);
    expect(summary.visits).toBe(36);
    expect(summary.level).toBe(levelForXp(3600, PROGRESSION_SCHEDULE_V1).level);
    expect(summary.milestones.map((row) => row.level)).toEqual([1, 2, 4, 5]);
    expect(summary.milestones[2]).toMatchObject({
      reachedAt: CHICAGO_EDGE,
      quarterKey: '2026-Q4',
      hasEntry: false,
    });
    expect(summary.consistent).toBe(false);
    expect(rows.milestones).toHaveLength(4);
  });

  it('ignores an unknown milestone key or a schedule version other than v1', () => {
    const summary = summarizeMemberProgression({
      events: [
        ...events(3),
        { schedule_version: 'v2', source_kind: 'verified_visit' },
        { schedule_version: 'v1', source_kind: 'review' },
        null,
      ],
      milestones: [
        milestone(1, '2026-06-01T18:00:00.000Z', '2026-Q2'),
        { ...milestone(1, '2026-06-01T18:00:00.000Z', '2026-Q2'), id: 'dup' },
        { milestone_key: 'v1:level:nope', schedule_version: 'v1', level: 1, id: 'bad-key', reached_at: 'x', quarter_key: '2026-Q1' },
        { milestone_key: 'v2:level:1', schedule_version: 'v2', level: 1, id: 'other', reached_at: 'x', quarter_key: '2026-Q1' },
        { milestone_key: 'v1:level:2', schedule_version: 'v1', level: 9, id: 'mismatch', reached_at: 'x', quarter_key: '2026-Q1' },
      ],
      entries: [
        entry(1, '2026-Q2'),
        { milestone_id: 'milestone-1', quarter_key: '2026-Q2', entry_source: 'recipe' },
        { milestone_id: 'missing', quarter_key: '2026-Q4', entry_source: 'level_milestone' },
        { milestone_id: 'milestone-1', quarter_key: 4, entry_source: 'level_milestone' },
      ],
    });
    expect(summary.xp).toBe(300);
    expect(summary.visits).toBe(3);
    expect(summary.milestones).toEqual([
      {
        level: 1,
        name: 'The Explorer',
        reachedAt: '2026-06-01T18:00:00.000Z',
        quarterKey: '2026-Q2',
        hasEntry: true,
      },
    ]);
    expect(summary.entriesByQuarter).toEqual([
      { quarterKey: '2026-Q2', count: 1 },
      { quarterKey: '2026-Q4', count: 1 },
    ]);
    expect(summary.consistent).toBe(true);
    expect(summary.ignored).toEqual({ events: 3, milestones: 4, entries: 2 });
  });

  it('takes the level name from the schedule passed in', () => {
    const schedule: ProgressionSchedule = {
      version: 'v1',
      levels: [{ level: 1, minXp: 100, name: 'Scout' }],
      continuingStepXp: 100,
      continuingName: (level) => `Scout ${level}`,
    };
    const summary = summarizeMemberProgression(
      {
        events: events(2),
        milestones: [milestone(1, '2026-01-02T00:00:00.000Z', '2026-Q1')],
        entries: [],
      },
      schedule,
    );
    expect(summary).toMatchObject({
      xp: 200,
      visits: 2,
      level: 2,
      name: 'Scout 2',
      nextLevel: { level: 3, name: 'Scout 3', xp: 300 },
      consistent: false,
    });
    expect(summary.milestones[0]?.name).toBe('Scout');
  });
});

describe('stored quarters under TZ=UTC and TZ=America/Chicago', () => {
  it('returns the stored 2026-Q4 key in both process time zones', () => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const probe = 'src/lib/progression/read-model.tz-probe.ts';
    const run = (tz: string) => {
      const result = spawnSync(tsx, [probe], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, TZ: tz },
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as {
        quarterKey: string;
        reachedAt: string;
        xp: number;
        level: number;
      };
    };

    const utc = run('UTC');
    const chicago = run('America/Chicago');
    expect(chicago).toEqual(utc);
    expect(utc).toEqual({
      quarterKey: '2026-Q4',
      reachedAt: CHICAGO_EDGE,
      xp: 3600,
      level: 5,
    });
  });
});

describe('read model source', () => {
  it('does not recompute a quarter or touch the service-role client', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/progression/read-model.ts'), 'utf8');
    expect(source).not.toMatch(/chicagoQuarterKey|server-only|supabase-admin|getSupabaseAdmin|service_role|from 'next/);
    expect(source).not.toMatch(/\bDate\b/);
  });
});
