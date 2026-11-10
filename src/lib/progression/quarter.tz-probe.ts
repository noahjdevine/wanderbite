import { milestonesFromVerifiedVisits } from './milestones';
import { chicagoQuarterKey } from './quarter';
import { PROGRESSION_SCHEDULE_V1 } from './schedule';

const samples = [
  '2027-01-01T05:30:00.000Z',
  '2027-01-01T06:30:00.000Z',
  '2026-04-01T04:30:00.000Z',
  '2026-04-01T05:30:00.000Z',
  '2026-03-08T07:30:00.000Z',
  '2026-03-08T08:30:00.000Z',
  '2026-11-01T06:30:00.000Z',
  '2026-11-01T07:30:00.000Z',
];

const quarters = Object.fromEntries(samples.map((iso) => [iso, chicagoQuarterKey(iso)]));

const milestones = milestonesFromVerifiedVisits({
  verifiedAtAsc: [
    '2026-03-08T07:30:00.000Z',
    '2026-11-01T07:30:00.000Z',
    '2027-01-01T05:30:00.000Z',
  ],
  schedule: PROGRESSION_SCHEDULE_V1,
}).map((row) => ({
  level: row.level,
  reachedAt: row.reachedAt,
  quarterKey: row.quarterKey,
  milestoneKey: row.milestoneKey,
}));

process.stdout.write(`${JSON.stringify({ quarters, milestones })}\n`);
