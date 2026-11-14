/**
 * Read-only summary of one member's progression ledger.
 *
 * Rows in, summary out. This does not read the database and it does not write.
 * `reachedAt` and `quarterKey` are the stored strings. They are not parsed
 * and they are not turned into a new quarter. XP is the count of v1
 * verified-visit events times `XP_PER_VERIFIED_VISIT`, which is how the
 * ledger itself decides a level. A missing or extra milestone is reported
 * with `consistent: false` and left as stored.
 */

import { XP_PER_VERIFIED_VISIT, type NextLevel } from '@/lib/progress/rules';
import {
  levelForXp,
  tierForLevel,
  tiersReachedByXp,
  PROGRESSION_SCHEDULE_V1,
  type ProgressionSchedule,
} from '@/lib/progression/schedule';

const ENTRY_SOURCE = 'level_milestone';

export type MemberProgressionMilestone = {
  id: string;
  level: number;
  name: string;
  reachedAt: string;
  quarterKey: string;
  hasEntry: boolean;
};

export type MemberProgressionQuarterCount = {
  quarterKey: string;
  count: number;
};

export type MemberProgressionIgnored = {
  events: number;
  milestones: number;
  entries: number;
};

export type MemberProgressionSummary = {
  xp: number;
  visits: number;
  level: number;
  name: string;
  nextLevel: NextLevel | null;
  progressPercent: number;
  milestones: MemberProgressionMilestone[];
  entriesByQuarter: MemberProgressionQuarterCount[];
  /** Stored v1 milestone keys match the keys `levelForXp` expects for `xp`. */
  consistent: boolean;
  /** Rows left out because the schedule version or the key was not v1. */
  ignored: MemberProgressionIgnored;
};

export type MemberProgressionRows = {
  events: readonly unknown[];
  milestones: readonly unknown[];
  entries: readonly unknown[];
};

type KeptMilestone = {
  id: string;
  level: number;
  name: string;
  milestoneKey: string;
  reachedAt: string;
  quarterKey: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function milestoneLevel(key: string, version: string): number | null {
  const prefix = `${version}:level:`;
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  if (!/^[1-9][0-9]*$/.test(rest)) return null;
  const level = Number(rest);
  if (!Number.isSafeInteger(level)) return null;
  return level;
}

function keptMilestone(row: unknown, schedule: ProgressionSchedule): KeptMilestone | null {
  if (!isRecord(row)) return null;
  if (row.schedule_version !== schedule.version) return null;
  if (typeof row.milestone_key !== 'string' || typeof row.id !== 'string' || row.id.length === 0) {
    return null;
  }
  if (typeof row.reached_at !== 'string' || typeof row.quarter_key !== 'string') return null;
  const level = milestoneLevel(row.milestone_key, schedule.version);
  if (level === null || row.level !== level) return null;
  const tier = tierForLevel(level, schedule);
  if (!tier || tier.level !== level) return null;
  return {
    id: row.id,
    level,
    name: tier.name,
    milestoneKey: row.milestone_key,
    reachedAt: row.reached_at,
    quarterKey: row.quarter_key,
  };
}

function keptEntry(row: unknown): { milestoneId: string; quarterKey: string } | null {
  if (!isRecord(row)) return null;
  if (row.entry_source !== ENTRY_SOURCE) return null;
  if (typeof row.milestone_id !== 'string' || row.milestone_id.length === 0) return null;
  if (typeof row.quarter_key !== 'string') return null;
  return { milestoneId: row.milestone_id, quarterKey: row.quarter_key };
}

function sameKeys(expected: readonly string[], stored: readonly string[]): boolean {
  if (expected.length !== stored.length) return false;
  const seen = new Set(stored);
  if (seen.size !== stored.length) return false;
  return expected.every((key) => seen.has(key));
}

/**
 * Summarize ledger rows for one member on `schedule` (v1 when omitted).
 * An empty input is xp 0, level 0, and empty lists. It does not throw.
 */
export function summarizeMemberProgression(
  rows: MemberProgressionRows,
  schedule: ProgressionSchedule = PROGRESSION_SCHEDULE_V1,
): MemberProgressionSummary {
  let visits = 0;
  let ignoredEvents = 0;
  for (const row of rows.events) {
    if (
      isRecord(row)
      && row.schedule_version === schedule.version
      && row.source_kind === 'verified_visit'
    ) {
      visits += 1;
    } else {
      ignoredEvents += 1;
    }
  }

  const xp = visits * XP_PER_VERIFIED_VISIT;
  const kept: KeptMilestone[] = [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  let ignoredMilestones = 0;
  for (const row of rows.milestones) {
    const milestone = keptMilestone(row, schedule);
    if (!milestone || seenIds.has(milestone.id) || seenKeys.has(milestone.milestoneKey)) {
      ignoredMilestones += 1;
      continue;
    }
    seenIds.add(milestone.id);
    seenKeys.add(milestone.milestoneKey);
    kept.push(milestone);
  }
  kept.sort((a, b) => a.level - b.level);

  const entryIds = new Set<string>();
  const quarterCounts = new Map<string, number>();
  let ignoredEntries = 0;
  for (const row of rows.entries) {
    const entry = keptEntry(row);
    if (!entry) {
      ignoredEntries += 1;
      continue;
    }
    quarterCounts.set(entry.quarterKey, (quarterCounts.get(entry.quarterKey) ?? 0) + 1);
    if (seenIds.has(entry.milestoneId)) entryIds.add(entry.milestoneId);
  }

  const level = levelForXp(xp, schedule);
  const expected = tiersReachedByXp(xp, schedule).map(
    (tier) => `${schedule.version}:level:${tier.level}`,
  );

  return {
    xp,
    visits,
    level: level.level,
    name: level.name,
    nextLevel: level.nextLevel,
    progressPercent: level.progressPercent,
    milestones: kept.map((milestone) => ({
      id: milestone.id,
      level: milestone.level,
      name: milestone.name,
      reachedAt: milestone.reachedAt,
      quarterKey: milestone.quarterKey,
      hasEntry: entryIds.has(milestone.id),
    })),
    entriesByQuarter: [...quarterCounts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([quarterKey, count]) => ({ quarterKey, count })),
    consistent: sameKeys(expected, kept.map((milestone) => milestone.milestoneKey)),
    ignored: {
      events: ignoredEvents,
      milestones: ignoredMilestones,
      entries: ignoredEntries,
    },
  };
}
