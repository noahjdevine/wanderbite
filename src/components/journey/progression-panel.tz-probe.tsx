import { renderToStaticMarkup } from 'react-dom/server';
import { MemberProgressionPanel } from './progression-panel';
import {
  formatChicagoReachedDate,
  formatQuarterLabel,
  milestoneBeforeDrawingEntries,
} from '@/lib/progression/format';
import { summarizeMemberProgression } from '@/lib/progression/read-model';

/** 2026-12-31 23:30 America/Chicago, stored quarter 2026-Q4. */
const EDGE = '2027-01-01T05:30:00.000Z';
/** 2026-11-01 01:30 CST, the second time that hour occurs on the fallback morning. */
const NOVEMBER_FALLBACK = '2026-11-01T07:30:00.000Z';

function events(count: number): Record<string, string>[] {
  return Array.from({ length: count }, () => ({
    schedule_version: 'v1',
    source_kind: 'verified_visit',
  }));
}

function milestone(level: number, reachedAt: string, quarterKey: string) {
  return {
    id: `m${level}`,
    milestone_key: `v1:level:${level}`,
    schedule_version: 'v1',
    level,
    reached_at: reachedAt,
    quarter_key: quarterKey,
  };
}

const summary = summarizeMemberProgression({
  events: events(36),
  milestones: [
    milestone(1, '2026-02-03T18:00:00.000Z', '2026-Q1'),
    milestone(2, '2026-05-10T17:00:00.000Z', '2026-Q2'),
    milestone(3, '2026-08-15T17:00:00.000Z', '2026-Q3'),
    milestone(4, EDGE, '2026-Q4'),
    milestone(5, '2027-01-15T18:00:00.000Z', '2027-Q1'),
  ],
  entries: [{ milestone_id: 'm5', quarter_key: '2027-Q1', entry_source: 'level_milestone' }],
});

const november = {
  ...summary,
  milestones: [
    {
      id: 'm-nov',
      level: 1,
      name: 'The Explorer',
      reachedAt: NOVEMBER_FALLBACK,
      quarterKey: '2026-Q4',
      hasEntry: false,
    },
  ],
};

process.stdout.write(
  `${JSON.stringify({
    edgeDate: formatChicagoReachedDate(EDGE),
    novemberDate: formatChicagoReachedDate(NOVEMBER_FALLBACK),
    octoberEvening: formatChicagoReachedDate('2026-11-01T04:30:00.000Z'),
    quarter: formatQuarterLabel('2026-Q4'),
    beforeEdge: milestoneBeforeDrawingEntries(EDGE),
    level: summary.level,
    name: summary.name,
    xp: summary.xp,
    legend: renderToStaticMarkup(<MemberProgressionPanel summary={summary} />),
    fallback: renderToStaticMarkup(<MemberProgressionPanel summary={november} />),
  })}\n`,
);
