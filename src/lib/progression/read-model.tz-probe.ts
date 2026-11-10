import { summarizeMemberProgression } from './read-model';

/** 2026-12-31 23:30 America/Chicago, stored quarter 2026-Q4. */
const REACHED_AT = '2027-01-01T05:30:00.000Z';

const summary = summarizeMemberProgression({
  events: Array.from({ length: 36 }, () => ({
    schedule_version: 'v1',
    source_kind: 'verified_visit',
  })),
  milestones: [
    {
      id: 'm1',
      milestone_key: 'v1:level:1',
      schedule_version: 'v1',
      level: 1,
      reached_at: '2026-02-03T18:00:00.000Z',
      quarter_key: '2026-Q1',
    },
    {
      id: 'm2',
      milestone_key: 'v1:level:2',
      schedule_version: 'v1',
      level: 2,
      reached_at: '2026-04-10T18:00:00.000Z',
      quarter_key: '2026-Q2',
    },
    {
      id: 'm3',
      milestone_key: 'v1:level:3',
      schedule_version: 'v1',
      level: 3,
      reached_at: '2026-06-15T18:00:00.000Z',
      quarter_key: '2026-Q2',
    },
    {
      id: 'm4',
      milestone_key: 'v1:level:4',
      schedule_version: 'v1',
      level: 4,
      reached_at: REACHED_AT,
      quarter_key: '2026-Q4',
    },
    {
      id: 'm5',
      milestone_key: 'v1:level:5',
      schedule_version: 'v1',
      level: 5,
      reached_at: '2027-01-15T18:00:00.000Z',
      quarter_key: '2027-Q1',
    },
  ],
  entries: [],
});

const edge = summary.milestones.find((row) => row.level === 4);

process.stdout.write(
  `${JSON.stringify({
    quarterKey: edge?.quarterKey ?? null,
    reachedAt: edge?.reachedAt ?? null,
    xp: summary.xp,
    level: summary.level,
  })}\n`,
);
