import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chicagoCalendarDate } from '@/lib/activities/match';
import { chicagoQuarterKey } from '@/lib/progression/quarter';

/**
 * Instants below are America/Chicago wall times, written in UTC so the
 * assertion does not depend on the process time zone.
 * CST is UTC-6. CDT is UTC-5.
 */
const QUARTERS: [string, string][] = [
  // 2026-12-31 23:30 CST. The UTC date is already 2027-01-01.
  ['2027-01-01T05:30:00.000Z', '2026-Q4'],
  ['2026-12-31T23:30:00-06:00', '2026-Q4'],
  // 2027-01-01 00:30 CST.
  ['2027-01-01T06:30:00.000Z', '2027-Q1'],
  ['2027-01-01T00:30:00-06:00', '2027-Q1'],
  // Quarter boundaries while Chicago is on CDT.
  ['2026-03-31T23:30:00-05:00', '2026-Q1'],
  ['2026-04-01T00:30:00-05:00', '2026-Q2'],
  ['2026-06-30T23:30:00-05:00', '2026-Q2'],
  ['2026-07-01T00:30:00-05:00', '2026-Q3'],
  ['2026-09-30T23:30:00-05:00', '2026-Q3'],
  ['2026-10-01T00:30:00-05:00', '2026-Q4'],
  // Spring forward, Sunday 2026-03-08. 02:00 CST becomes 03:00 CDT.
  ['2026-03-08T07:30:00.000Z', '2026-Q1'], // 01:30 CST
  ['2026-03-08T08:30:00.000Z', '2026-Q1'], // 03:30 CDT
  // Fall back, Sunday 2026-11-01. 02:00 CDT becomes 01:00 CST.
  ['2026-11-01T06:30:00.000Z', '2026-Q4'], // 01:30 CDT, first time
  ['2026-11-01T07:30:00.000Z', '2026-Q4'], // 01:30 CST, second time
  ['2026-11-01T04:30:00.000Z', '2026-Q4'], // 2026-10-31 23:30 CDT
  ['2026-11-01T05:30:00.000Z', '2026-Q4'], // 2026-11-01 00:30 CDT
];

describe('chicagoQuarterKey', () => {
  it('uses the America/Chicago calendar quarter of the event', () => {
    for (const [iso, quarter] of QUARTERS) {
      expect(chicagoQuarterKey(iso), iso).toBe(quarter);
    }
  });

  it('rejects a timestamp that does not parse', () => {
    expect(() => chicagoQuarterKey('not-a-date')).toThrow(/parseable timestamp/);
  });

  it('uses the same America/Chicago calendar date as activities', () => {
    for (const [iso, quarter] of QUARTERS) {
      const [year, month] = chicagoCalendarDate(new Date(iso)).split('-').map(Number);
      expect(`${year}-Q${Math.ceil((month ?? 0) / 3)}`, iso).toBe(quarter);
    }
  });
});

describe('Chicago quarters under TZ=UTC and TZ=America/Chicago', () => {
  it('returns the same keys in both process time zones', () => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const probe = 'src/lib/progression/quarter.tz-probe.ts';
    const run = (tz: string) => {
      const result = spawnSync(tsx, [probe], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, TZ: tz },
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as {
        quarters: Record<string, string>;
        milestones: { level: number; reachedAt: string; quarterKey: string; milestoneKey: string }[];
      };
    };

    const utc = run('UTC');
    const chicago = run('America/Chicago');
    expect(chicago).toEqual(utc);
    expect(utc.quarters['2027-01-01T05:30:00.000Z']).toBe('2026-Q4');
    expect(utc.quarters['2027-01-01T06:30:00.000Z']).toBe('2027-Q1');
    expect(utc.quarters['2026-03-08T07:30:00.000Z']).toBe('2026-Q1');
    expect(utc.quarters['2026-03-08T08:30:00.000Z']).toBe('2026-Q1');
    expect(utc.quarters['2026-11-01T06:30:00.000Z']).toBe('2026-Q4');
    expect(utc.quarters['2026-11-01T07:30:00.000Z']).toBe('2026-Q4');
    expect(utc.milestones).toEqual([
      {
        level: 1,
        reachedAt: '2027-01-01T05:30:00.000Z',
        quarterKey: '2026-Q4',
        milestoneKey: 'v1:level:1',
      },
    ]);
  }, 20000);
});
