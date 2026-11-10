import { describe, expect, it } from 'vitest';
import { XP_PER_VERIFIED_VISIT } from '@/lib/progress/rules';
import { milestonesFromVerifiedVisits } from '@/lib/progression/milestones';
import { chicagoQuarterKey } from '@/lib/progression/quarter';
import {
  PROGRESSION_SCHEDULE_V1,
  type ProgressionSchedule,
} from '@/lib/progression/schedule';

const V1 = PROGRESSION_SCHEDULE_V1;

/** 2026-12-31 23:30 America/Chicago. The UTC calendar day is already 2027. */
const DEC_31_CHICAGO = '2027-01-01T05:30:00.000Z';
/** 2027-01-01 00:30 America/Chicago. */
const JAN_1_CHICAGO = '2027-01-01T06:30:00.000Z';

function visitAt(index: number): string {
  return new Date(Date.parse('2026-01-15T18:00:00.000Z') + index * 86_400_000).toISOString();
}

function visits(count: number): string[] {
  return Array.from({ length: count }, (_, index) => visitAt(index));
}

function milestones(verifiedAtAsc: readonly string[], schedule: ProgressionSchedule = V1) {
  return milestonesFromVerifiedVisits({ verifiedAtAsc, schedule });
}

describe('milestonesFromVerifiedVisits', () => {
  it('returns nothing when no visit has crossed a level', () => {
    expect(milestones([])).toEqual([]);
    expect(milestones(visits(2))).toEqual([]);
    expect(milestones(['not-a-date', '', '2026-11-01T99:00:00.000Z'])).toEqual([]);
    expect(() => milestones([null as unknown as string, undefined as unknown as string])).not.toThrow();
    expect(milestones([null as unknown as string])).toEqual([]);
  });

  it('uses the visit that first met each threshold, once, in level order', () => {
    const earned = milestones(visits(45));
    expect(earned.map((row) => row.level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(earned.map((row) => row.name)).toEqual([
      'The Explorer',
      'The Tastemaker',
      'The Connoisseur',
      'The Local Legend',
      'The Local Legend II',
      'The Local Legend III',
    ]);
    const visitsNeeded = [3, 10, 15, 25, 35, 45];
    const minXp = [300, 1000, 1500, 2500, 3500, 4500];
    earned.forEach((row, index) => {
      const needed = visitsNeeded[index] ?? 0;
      expect(row.minXp).toBe(minXp[index]);
      expect(row.reachedAt).toBe(visitAt(needed - 1));
      expect(row.quarterKey).toBe(chicagoQuarterKey(row.reachedAt));
      expect(row.milestoneKey).toBe(`v1:level:${row.level}`);
      expect(needed * XP_PER_VERIFIED_VISIT).toBeGreaterThanOrEqual(row.minXp);
      expect((needed - 1) * XP_PER_VERIFIED_VISIT).toBeLessThan(row.minXp);
    });
    expect(milestones(visits(30)).map((row) => row.level)).toEqual([1, 2, 3, 4]);
    expect(milestones(visits(35)).map((row) => row.level)).toEqual([1, 2, 3, 4, 5]);
    expect(milestones(visits(44)).at(-1)?.level).toBe(5);
    expect(milestones(visits(45)).at(-1)).toMatchObject({ level: 6, minXp: 4500 });
  });

  it('attributes the crossing visit\'s Chicago quarter, including New Year\'s Eve', () => {
    const explorer = milestones([
      '2026-03-08T07:30:00.000Z',
      '2026-11-01T06:30:00.000Z',
      DEC_31_CHICAGO,
    ]);
    expect(explorer).toEqual([
      {
        level: 1,
        name: 'The Explorer',
        minXp: 300,
        reachedAt: DEC_31_CHICAGO,
        quarterKey: '2026-Q4',
        milestoneKey: 'v1:level:1',
      },
    ]);

    const newYear = milestones([
      '2026-03-08T08:30:00.000Z',
      '2026-11-01T07:30:00.000Z',
      JAN_1_CHICAGO,
    ]);
    expect(newYear[0]?.quarterKey).toBe('2027-Q1');
    expect(newYear[0]?.reachedAt).toBe(JAN_1_CHICAGO);
  });

  it('is stable for the same input, duplicates, and unsorted or invalid timestamps', () => {
    const ordered = visits(10);
    const messy = [
      ordered[9],
      'nope',
      ordered[2],
      ordered[0],
      '',
      ordered[5],
      ordered[1],
      '2026-02-31T99:99:99Z',
      ordered[8],
      ordered[3],
      ordered[7],
      ordered[4],
      ordered[6],
    ];
    const first = milestones(messy);
    const second = milestones(messy);
    expect(second).toEqual(first);
    expect(first).toEqual(milestones(ordered));
    expect(messy).toEqual([
      ordered[9],
      'nope',
      ordered[2],
      ordered[0],
      '',
      ordered[5],
      ordered[1],
      '2026-02-31T99:99:99Z',
      ordered[8],
      ordered[3],
      ordered[7],
      ordered[4],
      ordered[6],
    ]);

    const repeated = Array.from({ length: 10 }, () => ordered[0]);
    const fromRepeats = milestones(repeated);
    expect(fromRepeats.map((row) => row.level)).toEqual([1, 2]);
    expect(fromRepeats.map((row) => row.reachedAt)).toEqual([ordered[0], ordered[0]]);
    expect(milestones(repeated)).toEqual(fromRepeats);

    const keys = [...first, ...fromRepeats].map((row) => row.milestoneKey);
    expect(new Set(first.map((row) => row.milestoneKey)).size).toBe(first.length);
    expect(new Set(fromRepeats.map((row) => row.milestoneKey)).size).toBe(fromRepeats.length);
    expect(first[0]?.milestoneKey).toBe('v1:level:1');
    expect(keys.filter((key) => key === 'v1:level:1').length).toBe(2);
  });

  it('counts every valid timestamp, and does not invent a date for a partial threshold', () => {
    const partial: ProgressionSchedule = {
      version: 'partial',
      levels: [{ level: 1, minXp: 250, name: 'Partial' }],
      continuingStepXp: 0,
      continuingName: () => 'unused',
    };
    const [first, second, third] = ['2026-05-01T15:00:00.000Z', '2026-05-02T15:00:00.000Z', '2026-05-03T15:00:00.000Z'];
    expect(milestones([first, second], partial)).toEqual([]);
    expect(milestones([third, 'bad', first, second], partial)).toEqual([
      {
        level: 1,
        name: 'Partial',
        minXp: 250,
        reachedAt: third,
        quarterKey: '2026-Q2',
        milestoneKey: 'partial:level:1',
      },
    ]);
  });
});
