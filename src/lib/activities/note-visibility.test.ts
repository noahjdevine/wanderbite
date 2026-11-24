import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { approvedNotesToPause, noteCanShow, type NoteVisibleActivity } from '@/lib/activities/note-visibility';

const NOW = new Date('2026-11-04T18:00:00.000Z');
const VERIFIED = '2026-11-02T18:00:00.000Z';
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function activity(overrides: Partial<NoteVisibleActivity> = {}): NoteVisibleActivity {
  return {
    id: ID,
    status: 'active',
    is_sample: false,
    source_url: 'https://example.com/chestnut-square',
    valid_from: null,
    valid_until: null,
    last_verified_at: VERIFIED,
    ...overrides,
  };
}

function show(activityRow: NoteVisibleActivity | null, status = 'approved') {
  const activities = new Map<string, NoteVisibleActivity>();
  if (activityRow) activities.set(activityRow.id, activityRow);
  return noteCanShow({ status, isSample: false, activityIds: [ID] }, activities, NOW);
}

describe('activity note visibility', () => {
  it('shows an approved note only while every cited activity is showing', () => {
    expect(show(activity())).toBe(true);
    expect(show(activity(), 'draft')).toBe(false);
    expect(show(activity(), 'rejected')).toBe(false);
    expect(show(activity(), 'paused')).toBe(false);
    expect(show(activity({ status: 'paused' }))).toBe(false);
    expect(show(activity({ last_verified_at: '2026-09-01T18:00:00.000Z' }))).toBe(false);
    expect(show(activity({ is_sample: true }))).toBe(false);
    expect(show(null)).toBe(false);
  });

  it('selects an approved note for maintenance and leaves a paused note alone', () => {
    const note = { status: 'approved', isSample: false, activityIds: [ID] };
    const paused = { status: 'paused', isSample: false, activityIds: [ID] };
    const stale = new Map<string, NoteVisibleActivity>([
      [ID, activity({ status: 'paused' })],
    ]);
    expect(approvedNotesToPause([note, paused], stale, NOW)).toEqual([note]);
    expect(approvedNotesToPause([paused], stale, NOW)).toEqual([]);
  });
});

describe('activity note dates under TZ=UTC and TZ=America/Chicago', () => {
  it('keeps the Chicago boundary identical in both process time zones', () => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const run = (tz: string) => {
      const result = spawnSync(tsx, ['src/lib/activities/note-visibility.tz-probe.ts'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, TZ: tz },
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as { evening: boolean; morning: boolean };
    };
    const utc = run('UTC');
    const chicago = run('America/Chicago');
    expect(chicago).toEqual(utc);
    expect(utc).toEqual({ evening: true, morning: false });
  }, 20000);
});
