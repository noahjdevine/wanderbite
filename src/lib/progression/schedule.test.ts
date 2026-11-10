import { describe, expect, it } from 'vitest';
import { levelFromXp, XP_LEVELS, XP_PER_VERIFIED_VISIT } from '@/lib/progress/rules';
import {
  levelForXp,
  PROGRESSION_SCHEDULE_V1,
  PROGRESSION_SCHEDULE_VERSION,
  tierForLevel,
  tiersReachedByXp,
  type ProgressionSchedule,
} from '@/lib/progression/schedule';

const V1 = PROGRESSION_SCHEDULE_V1;

function xpForVisits(visits: number): number {
  return visits * XP_PER_VERIFIED_VISIT;
}

describe('schedule v1', () => {
  it('keeps levels 1–4 on today\'s thresholds and a 1000 XP step after them', () => {
    expect(PROGRESSION_SCHEDULE_VERSION).toBe('v1');
    expect(V1.version).toBe('v1');
    expect(V1.levels).toEqual(XP_LEVELS.map((tier) => ({ ...tier })));
    expect(V1.continuingStepXp).toBe(1000);
    expect(V1.continuingName(5)).toBe('The Local Legend II');
    expect(V1.continuingName(6)).toBe('The Local Legend III');
  });

  it('matches levelFromXp for 0, 2, 3, 10, and 15 verified visits', () => {
    for (const visits of [0, 2, 3, 10, 15]) {
      const xp = xpForVisits(visits);
      expect(levelForXp(xp, V1)).toEqual(levelFromXp(xp));
    }
    for (let xp = 0; xp < 2500; xp += 25) {
      expect(levelForXp(xp, V1)).toEqual(levelFromXp(xp));
    }
  });

  it('matches level and name at 25 visits, then keeps a next level', () => {
    const xp = xpForVisits(25);
    const today = levelFromXp(xp);
    const next = levelForXp(xp, V1);
    expect(today).toMatchObject({ level: 4, name: 'The Local Legend', nextLevel: null, progressPercent: 100 });
    expect(next.level).toBe(today.level);
    expect(next.name).toBe(today.name);
    expect(next.nextLevel).toEqual({ level: 5, name: 'The Local Legend II', xp: 3500 });
    expect(next.progressPercent).toBe(0);
  });

  it('stays on Local Legend at 30 visits, with level 5 at 3500 XP', () => {
    expect(levelForXp(xpForVisits(30), V1)).toMatchObject({
      level: 4,
      name: 'The Local Legend',
      nextLevel: { level: 5, name: 'The Local Legend II', xp: 3500 },
      progressPercent: 50,
    });
    expect(levelForXp(3499, V1).level).toBe(4);
  });

  it('reaches The Local Legend II at 35 and 44 visits', () => {
    const expected = {
      level: 5,
      name: 'The Local Legend II',
      nextLevel: { level: 6, name: 'The Local Legend III', xp: 4500 },
    };
    expect(levelForXp(xpForVisits(35), V1)).toMatchObject({ ...expected, progressPercent: 0 });
    expect(levelForXp(xpForVisits(44), V1)).toMatchObject({ ...expected, progressPercent: 90 });
  });

  it('reaches level 6 at 45 visits', () => {
    expect(levelForXp(xpForVisits(45), V1)).toMatchObject({
      level: 6,
      name: 'The Local Legend III',
      nextLevel: { level: 7, name: 'The Local Legend IV', xp: 5500 },
      progressPercent: 0,
    });
  });

  it('never returns a null next level', () => {
    for (let xp = 0; xp <= 20000; xp += 25) {
      const snapshot = levelForXp(xp, V1);
      expect(snapshot.nextLevel).not.toBeNull();
      expect(snapshot.nextLevel?.xp).toBeGreaterThan(xp);
    }
    expect(levelForXp(12500, V1)).toMatchObject({
      level: 14,
      name: 'The Local Legend XI',
      nextLevel: { level: 15, name: 'The Local Legend XII', xp: 13500 },
    });
  });

  it('agrees with the tier list on earned levels', () => {
    expect(tiersReachedByXp(0, V1)).toEqual([]);
    expect(tiersReachedByXp(xpForVisits(45), V1).map((tier) => tier.level)).toEqual([1, 2, 3, 4, 5, 6]);
    for (let xp = 0; xp <= 12000; xp += 100) {
      const tiers = tiersReachedByXp(xp, V1);
      const snapshot = levelForXp(xp, V1);
      expect(new Set(tiers.map((tier) => tier.level)).size).toBe(tiers.length);
      expect(tiers.map((tier) => tier.level)).toEqual([...tiers.map((tier) => tier.level)].sort((a, b) => a - b));
      if (snapshot.level === 0) {
        expect(tiers).toEqual([]);
      } else {
        expect(tiers.at(-1)?.level).toBe(snapshot.level);
        expect(tiers.at(-1)?.name).toBe(snapshot.name);
      }
    }
  });

  it('leaves today\'s Local Legend cap in place', () => {
    expect(levelFromXp(2500).nextLevel).toBeNull();
    expect(levelFromXp(xpForVisits(45)).level).toBe(4);
    expect(tierForLevel(4, V1)).toEqual({ level: 4, minXp: 2500, name: 'The Local Legend' });
    expect(tierForLevel(5, V1)).toEqual({ level: 5, minXp: 3500, name: 'The Local Legend II' });
    expect(tierForLevel(0, V1)).toBeNull();
  });
});

describe('levelForXp on other schedules', () => {
  it('reads any explicit level count, including a cap', () => {
    const six: ProgressionSchedule = {
      version: 'six',
      levels: [1, 2, 3, 4, 5, 6].map((level) => ({
        level,
        minXp: level * 100,
        name: `L${level}`,
      })),
      continuingStepXp: 0,
      continuingName: () => 'unused',
    };
    expect(levelForXp(500, six)).toMatchObject({
      level: 5,
      name: 'L5',
      nextLevel: { level: 6, name: 'L6', xp: 600 },
    });
    expect(levelForXp(600, six)).toMatchObject({
      level: 6,
      name: 'L6',
      nextLevel: null,
      progressPercent: 100,
    });
    expect(levelForXp(50, six)).toMatchObject({
      level: 0,
      name: 'Getting started',
      nextLevel: { level: 1, name: 'L1', xp: 100 },
    });
  });

  it('continues past a short explicit list using that schedule\'s step and names', () => {
    const short: ProgressionSchedule = {
      version: 'short',
      levels: [
        { level: 1, minXp: 100, name: 'Base' },
        { level: 2, minXp: 500, name: 'Second' },
      ],
      continuingStepXp: 200,
      continuingName: (level) => `Second ${level}`,
    };
    expect(levelForXp(500, short)).toMatchObject({
      level: 2,
      name: 'Second',
      nextLevel: { level: 3, name: 'Second 3', xp: 700 },
    });
    expect(levelForXp(700, short)).toMatchObject({
      level: 3,
      name: 'Second 3',
      nextLevel: { level: 4, name: 'Second 4', xp: 900 },
    });
  });

  it('treats non-finite XP as no progress', () => {
    expect(levelForXp(Number.NaN, V1).level).toBe(0);
    expect(levelForXp(Number.POSITIVE_INFINITY, V1).level).toBe(0);
    expect(levelForXp(-100, V1)).toEqual(levelForXp(0, V1));
  });
});
