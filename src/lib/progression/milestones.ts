/**
 * Milestones earned by verified-visit timestamps.
 *
 * Each valid timestamp is one verified visit, including a make-up visit.
 * Ordinary QR issuance, recipes, activity checkmarks, and reviews are not
 * inputs here, so they add no XP. This function does not write a ledger row.
 *
 * Timestamp choice: a value is kept when `Date.parse` returns a finite instant.
 * Anything else (blank, unparseable, non-string) is ignored and does not throw.
 * Strings are not trimmed and are not rewritten. Valid instants are sorted
 * ascending. Equal instants keep their original input order, so duplicate
 * timestamps still count as separate visits. `reachedAt` is that original
 * string, not a normalized ISO form. The same input always returns the same
 * milestones, in level order, one row per level. No visit means no milestone:
 * dates are not invented.
 */

import { XP_PER_VERIFIED_VISIT } from '@/lib/progress/rules';
import { chicagoQuarterKey } from '@/lib/progression/quarter';
import { tiersReachedByXp, type ProgressionSchedule } from '@/lib/progression/schedule';

export type ProgressionMilestone = {
  level: number;
  name: string;
  minXp: number;
  reachedAt: string;
  quarterKey: string;
  milestoneKey: string;
};

export function milestonesFromVerifiedVisits(args: {
  verifiedAtAsc: readonly string[];
  schedule: ProgressionSchedule;
}): ProgressionMilestone[] {
  const valid = validTimestamps(args.verifiedAtAsc);
  if (valid.length === 0) return [];

  const xp = valid.length * XP_PER_VERIFIED_VISIT;
  const milestones: ProgressionMilestone[] = [];
  for (const tier of tiersReachedByXp(xp, args.schedule)) {
    if (tier.minXp <= 0) continue;
    const needed = Math.ceil(tier.minXp / XP_PER_VERIFIED_VISIT);
    if (!Number.isFinite(needed) || needed < 1 || needed > valid.length) continue;
    const reachedAt = valid[needed - 1];
    if (!reachedAt) continue;
    milestones.push({
      level: tier.level,
      name: tier.name,
      minXp: tier.minXp,
      reachedAt,
      quarterKey: chicagoQuarterKey(reachedAt),
      milestoneKey: `${args.schedule.version}:level:${tier.level}`,
    });
  }
  milestones.sort((a, b) => a.level - b.level || a.minXp - b.minXp);
  return milestones;
}

function validTimestamps(values: readonly string[]): string[] {
  const rows: { iso: string; index: number; time: number }[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const iso = values[index];
    if (typeof iso !== 'string') continue;
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) continue;
    rows.push({ iso, index, time });
  }
  rows.sort((a, b) => a.time - b.time || a.index - b.index);
  return rows.map((row) => row.iso);
}
