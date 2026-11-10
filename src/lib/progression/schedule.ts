/**
 * Versioned continuing progression. Journey still uses `levelFromXp` in
 * `src/lib/progress/rules.ts`, which stops at The Local Legend. Nothing in
 * the app reads this module yet.
 */

import type { LevelSnapshot, NextLevel } from '@/lib/progress/rules';

/** Bump when the step size or the post-legend names change. */
export const PROGRESSION_SCHEDULE_VERSION = 'v1';

const BEFORE_FIRST_LEVEL = 'Getting started';

export type ProgressionLevel = {
  level: number;
  minXp: number;
  name: string;
};

export type ProgressionSchedule = {
  version: string;
  /**
   * Explicit levels with their thresholds. Level 0 is any XP below the first.
   * Listed in ascending `minXp`. v1 copies today's levels 1–4.
   */
  levels: readonly ProgressionLevel[];
  /**
   * XP between levels after the last explicit level.
   * Zero or negative caps the schedule: the last explicit level has no next level.
   */
  continuingStepXp: number;
  /** Name for a level past the last explicit level. */
  continuingName: (level: number) => string;
};

/**
 * Schedule v1. Levels 1–4 are today's Journey thresholds.
 * After The Local Legend (2500 XP), each new level is one step higher, with no cap.
 *
 * Naming and step size are provisional and will be revisited.
 */
export const PROGRESSION_SCHEDULE_V1: ProgressionSchedule = {
  version: PROGRESSION_SCHEDULE_VERSION,
  levels: [
    { level: 1, minXp: 300, name: 'The Explorer' },
    { level: 2, minXp: 1000, name: 'The Tastemaker' },
    { level: 3, minXp: 1500, name: 'The Connoisseur' },
    { level: 4, minXp: 2500, name: 'The Local Legend' },
  ],
  continuingStepXp: 1000,
  continuingName(level) {
    // Level 4 stays "The Local Legend". Level 5 is II, level 6 is III.
    return `The Local Legend ${romanNumeral(level - 3)}`;
  },
};

/** Non-finite or negative XP has not been earned. */
function finiteXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 0;
  return xp;
}

function orderedLevels(schedule: ProgressionSchedule): ProgressionLevel[] {
  return [...schedule.levels].sort((a, b) => a.minXp - b.minXp || a.level - b.level);
}

function continues(schedule: ProgressionSchedule): boolean {
  return Number.isFinite(schedule.continuingStepXp) && schedule.continuingStepXp > 0;
}

function continuingTier(
  last: ProgressionLevel,
  stepsPast: number,
  schedule: ProgressionSchedule,
): ProgressionLevel {
  const level = last.level + stepsPast;
  return {
    level,
    minXp: last.minXp + stepsPast * schedule.continuingStepXp,
    name: schedule.continuingName(level),
  };
}

/** Explicit level, or a post-legend level on this schedule. Missing levels are null. */
export function tierForLevel(
  level: number,
  schedule: ProgressionSchedule,
): ProgressionLevel | null {
  if (!Number.isInteger(level) || level < 1) return null;
  const levels = orderedLevels(schedule);
  const explicit = levels.find((tier) => tier.level === level);
  if (explicit) return { level: explicit.level, minXp: explicit.minXp, name: explicit.name };
  const last = levels[levels.length - 1];
  if (!last || level <= last.level || !continues(schedule)) return null;
  return continuingTier(last, level - last.level, schedule);
}

function currentTier(xp: number, schedule: ProgressionSchedule): ProgressionLevel | null {
  const levels = orderedLevels(schedule);
  let current: ProgressionLevel | null = null;
  for (const tier of levels) {
    if (xp >= tier.minXp) current = tier;
    else break;
  }
  if (!current) return null;
  const last = levels[levels.length - 1];
  if (
    !last ||
    current.level !== last.level ||
    current.minXp !== last.minXp ||
    !continues(schedule)
  ) {
    return current;
  }
  const stepsPast = Math.floor((xp - last.minXp) / schedule.continuingStepXp);
  if (stepsPast <= 0) return current;
  return continuingTier(last, stepsPast, schedule);
}

function nextTier(
  current: ProgressionLevel,
  schedule: ProgressionSchedule,
): ProgressionLevel | null {
  const levels = orderedLevels(schedule);
  const index = levels.findIndex(
    (tier) => tier.level === current.level && tier.minXp === current.minXp,
  );
  if (index >= 0 && index < levels.length - 1) {
    const next = levels[index + 1];
    if (next) return { level: next.level, name: next.name, minXp: next.minXp };
  }
  const last = levels[levels.length - 1];
  if (!last || current.level < last.level || !continues(schedule)) return null;
  return continuingTier(last, current.level - last.level + 1, schedule);
}

/**
 * Every tier whose threshold is already met, in ascending threshold order.
 * Continuing levels are included. This allocates one entry per earned level,
 * so callers that only need the current level should use `levelForXp`.
 */
export function tiersReachedByXp(xp: number, schedule: ProgressionSchedule): ProgressionLevel[] {
  const safeXp = finiteXp(xp);
  const levels = orderedLevels(schedule);
  const reached: ProgressionLevel[] = [];
  for (const tier of levels) {
    if (safeXp >= tier.minXp) {
      reached.push({ level: tier.level, minXp: tier.minXp, name: tier.name });
    } else {
      break;
    }
  }
  const last = levels[levels.length - 1];
  if (!last || safeXp < last.minXp || !continues(schedule)) return reached;
  const stepsPast = Math.floor((safeXp - last.minXp) / schedule.continuingStepXp);
  for (let step = 1; step <= stepsPast; step += 1) {
    reached.push(continuingTier(last, step, schedule));
  }
  return reached;
}

function percentBetween(xp: number, currentMin: number, nextMin: number): number {
  const range = nextMin - currentMin;
  if (range <= 0) return 100;
  const progressInLevel = Math.min(Math.max(0, xp - currentMin), range);
  return Math.min(100, Math.round((progressInLevel / range) * 100));
}

function toNextLevel(tier: ProgressionLevel): NextLevel {
  return { level: tier.level, name: tier.name, xp: tier.minXp };
}

/**
 * Level for any XP on `schedule`, including levels past the explicit list.
 * Under schedule v1, `nextLevel` is never null: the next threshold is always
 * one continuing step above the level just reached.
 */
export function levelForXp(xp: number, schedule: ProgressionSchedule): LevelSnapshot {
  const safeXp = finiteXp(xp);
  const levels = orderedLevels(schedule);
  const first = levels[0];
  if (!first || safeXp < first.minXp) {
    const nextLevel = first ? toNextLevel(first) : null;
    const progressPercent =
      first && first.minXp > 0 ? Math.min(100, Math.round((safeXp / first.minXp) * 100)) : 0;
    return {
      level: 0,
      name: BEFORE_FIRST_LEVEL,
      nextLevel,
      progressPercent,
    };
  }

  const current = currentTier(safeXp, schedule) ?? first;
  const next = nextTier(current, schedule);
  if (!next) {
    return {
      level: current.level,
      name: current.name,
      nextLevel: null,
      progressPercent: 100,
    };
  }
  return {
    level: current.level,
    name: current.name,
    nextLevel: toNextLevel(next),
    progressPercent: percentBetween(safeXp, current.minXp, next.minXp),
  };
}

const ROMAN: readonly [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

function romanNumeral(value: number): string {
  if (!Number.isInteger(value) || value < 1) return String(value);
  let rest = value;
  let out = '';
  for (const [amount, glyph] of ROMAN) {
    while (rest >= amount) {
      out += glyph;
      rest -= amount;
    }
  }
  return out;
}
