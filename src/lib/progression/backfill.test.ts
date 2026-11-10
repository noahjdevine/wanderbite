import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  formatProgressionBackfillCounts,
  parseProgressionBackfillArgs,
  progressionBackfillAllowed,
  readBackfillCounts,
} from '@/lib/progression/backfill';
import { chicagoDateMidnight } from '@/lib/progression/entries-from';

describe('chicagoDateMidnight', () => {
  it('parses Chicago midnights across CDT and CST', () => {
    expect(chicagoDateMidnight('2026-11-01').toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(chicagoDateMidnight('2026-10-01').toISOString()).toBe('2026-10-01T05:00:00.000Z');
    expect(chicagoDateMidnight('2027-01-01').toISOString()).toBe('2027-01-01T06:00:00.000Z');
  });

  it('rejects a missing day, a rollover day, and a non-date', () => {
    expect(() => chicagoDateMidnight('2026-11-1')).toThrow(/YYYY-MM-DD/);
    expect(() => chicagoDateMidnight('2026-02-31')).toThrow(/real calendar date/);
    expect(() => chicagoDateMidnight('November 1, 2026')).toThrow(/YYYY-MM-DD/);
  });
});

describe('parseProgressionBackfillArgs', () => {
  it('refuses to run without --entries-from and defaults to a dry run', () => {
    expect(parseProgressionBackfillArgs([])).toEqual({
      error: '--entries-from is required. Pass YYYY-MM-DD. There is no default.',
    });
    expect(parseProgressionBackfillArgs(['--apply'])).toEqual({
      error: '--entries-from is required. Pass YYYY-MM-DD. There is no default.',
    });
    expect(parseProgressionBackfillArgs(['--entries-from', '2026-11-01'])).toEqual({
      help: false,
      apply: false,
      entriesFrom: '2026-11-01T05:00:00.000Z',
      userId: null,
    });
    expect(parseProgressionBackfillArgs(['--entries-from', '2026-10-01'])).toMatchObject({
      apply: false,
      entriesFrom: '2026-10-01T05:00:00.000Z',
    });
    expect(parseProgressionBackfillArgs(['--entries-from', '2027-01-01'])).toMatchObject({
      apply: false,
      entriesFrom: '2027-01-01T06:00:00.000Z',
    });
  });

  it('writes only when --apply is set', () => {
    expect(parseProgressionBackfillArgs(['--entries-from', '2026-11-01', '--apply'])).toMatchObject({
      apply: true,
      entriesFrom: '2026-11-01T05:00:00.000Z',
    });
    expect(parseProgressionBackfillArgs(['--apply', '--entries-from=2026-11-01'])).toMatchObject({
      apply: true,
    });
    expect(parseProgressionBackfillArgs(['--entries-from', '2026-11-01', '--dry-run'])).toMatchObject({
      apply: false,
    });
    expect(parseProgressionBackfillArgs(['--entries-from', '2026-11-01', '--apply', '--dry-run'])).toEqual({
      error: 'Choose one of --dry-run or --apply.',
    });
  });

  it('accepts one member id and rejects anything else', () => {
    expect(parseProgressionBackfillArgs([
      '--entries-from',
      '2026-11-01',
      '--user-id',
      'e09a4000-0000-4000-8000-000000000001',
    ])).toMatchObject({
      userId: 'e09a4000-0000-4000-8000-000000000001',
    });
    expect(parseProgressionBackfillArgs(['--entries-from', '2026-11-01', '--user-id', 'member'])).toEqual({
      error: '--user-id must be a uuid',
    });
    expect(parseProgressionBackfillArgs(['--entries-from', '2026-11-01', '--hosted'])).toEqual({
      error: 'Unknown argument --hosted',
    });
  });
});

describe('progression backfill output', () => {
  it('prints counts only', () => {
    const counts = readBackfillCounts({
      members: 1,
      events: 36,
      milestones: 5,
      entries: 2,
      milestones_without_entry: 3,
      user_id: 'e09a4000-0000-4000-8000-000000000001',
      email: 'member@example.com',
    });
    expect(counts).toEqual({
      members: 1,
      events: 36,
      milestones: 5,
      entries: 2,
      milestonesWithoutEntry: 3,
    });
    const text = formatProgressionBackfillCounts(counts!, true);
    expect(text).toBe([
      'dry_run=true',
      'members=1',
      'events=36',
      'milestones=5',
      'entries=2',
      'milestones_without_entry=3',
      '',
    ].join('\n'));
    expect(text).not.toMatch(/e09a4000|example.com/i);
    expect(readBackfillCounts({ members: 1, events: 1, milestones: 1, entries: 1 })).toBeNull();
  });

  it('refuses hosted and allows a local URL', () => {
    expect(progressionBackfillAllowed('').ok).toBe(false);
    expect(progressionBackfillAllowed('https://yiajoycgiyxjvznndjge.supabase.co').ok).toBe(false);
    expect(progressionBackfillAllowed('https://example.supabase.co').ok).toBe(false);
    expect(progressionBackfillAllowed('http://127.0.0.1:54321').ok).toBe(true);
    expect(progressionBackfillAllowed('http://localhost:54321').ok).toBe(true);
  });

  it('does not bake a start date into the function, helper, or script', () => {
    const files = [
      'src/lib/progression/entries-from.ts',
      'src/lib/progression/backfill.ts',
      'scripts/progression-backfill.ts',
      'supabase/migrations/20261110183232_e09_a4_progression_backfill.sql',
    ];
    for (const file of files) {
      expect(readFileSync(path.join(process.cwd(), file), 'utf8'), file).not.toContain('2027-01-01');
    }
  });
});

describe('Chicago entry instants under TZ=UTC and TZ=America/Chicago', () => {
  it('parses the same instants in both process time zones', () => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const probe = 'src/lib/progression/entries-from.tz-probe.ts';
    const run = (tz: string) => {
      const result = spawnSync(tsx, [probe], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, TZ: tz },
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as {
        instants: Record<string, string>;
        apply: boolean;
        entriesFrom: string;
      };
    };

    const utc = run('UTC');
    const chicago = run('America/Chicago');
    expect(chicago).toEqual(utc);
    expect(utc.instants['2026-11-01']).toBe('2026-11-01T05:00:00.000Z');
    expect(utc.instants['2026-10-01']).toBe('2026-10-01T05:00:00.000Z');
    expect(utc.instants['2027-01-01']).toBe('2027-01-01T06:00:00.000Z');
    expect(utc.apply).toBe(false);
    expect(utc.entriesFrom).toBe('2027-01-01T06:00:00.000Z');
  }, 20000);
});
