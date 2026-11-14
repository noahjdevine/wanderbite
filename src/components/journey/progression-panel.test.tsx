import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MemberProgressionPanel,
  MemberProgressionUnavailable,
} from '@/components/journey/progression-panel';
import {
  DRAWING_ENTRIES_HEADING,
  DRAWING_ENTRIES_NOTE,
  DRAWING_ENTRY_LABEL,
  LEVELS_REACHED_HEADING,
  MEMBER_PROGRESSION_HEADING,
  NO_DRAWING_ENTRIES_YET,
  NO_ENTRY_BEFORE_LABEL,
  NO_LEVELS_YET,
  PROGRESSION_UNAVAILABLE_MESSAGE,
  formatQuarterLabel,
} from '@/lib/progression/format';
import {
  summarizeMemberProgression,
  type MemberProgressionSummary,
} from '@/lib/progression/read-model';

/** 2026-12-31 23:30 America/Chicago. Stored quarter stays 2026-Q4. */
const EDGE = '2027-01-01T05:30:00.000Z';

function events(count: number): Record<string, string>[] {
  return Array.from({ length: count }, () => ({
    schedule_version: 'v1',
    source_kind: 'verified_visit',
  }));
}

function storedMilestone(level: number, reachedAt: string, quarterKey: string) {
  return {
    id: `m${level}`,
    milestone_key: `v1:level:${level}`,
    schedule_version: 'v1',
    level,
    reached_at: reachedAt,
    quarter_key: quarterKey,
  };
}

function legendSummary(): MemberProgressionSummary {
  return summarizeMemberProgression({
    events: events(36),
    milestones: [
      storedMilestone(1, '2026-02-03T18:00:00.000Z', '2026-Q1'),
      storedMilestone(2, '2026-05-10T17:00:00.000Z', '2026-Q2'),
      storedMilestone(3, '2026-08-15T17:00:00.000Z', '2026-Q3'),
      storedMilestone(4, EDGE, '2026-Q4'),
      storedMilestone(5, '2027-01-15T18:00:00.000Z', '2027-Q1'),
    ],
    entries: [{ milestone_id: 'm5', quarter_key: '2027-Q1', entry_source: 'level_milestone' }],
  });
}

function sectionOf(heading: HTMLElement): HTMLElement {
  const section = heading.closest('section');
  if (!(section instanceof HTMLElement)) throw new Error('missing section');
  return section;
}

beforeEach(() => {
  localStorage.clear();
  for (const id of ['m1', 'm2', 'm3', 'm4', 'm5', 'm-nov-1', 'm-nov-2', 'm-nov-5']) {
    localStorage.setItem(`wb:levelup-seen:${id}`, '1');
  }
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('member progression panel', () => {
  it('shows continuing level, stored dates, and an entry only where one is stored', () => {
    const summary = legendSummary();
    expect(summary).toMatchObject({
      xp: 3600,
      level: 5,
      name: 'The Local Legend II',
      nextLevel: { level: 6, name: 'The Local Legend III', xp: 4500 },
      progressPercent: 10,
      consistent: true,
    });

    render(<MemberProgressionPanel summary={summary} />);
    const region = sectionOf(screen.getByRole('heading', { name: MEMBER_PROGRESSION_HEADING }));
    expect(region.className).toContain('min-w-0');
    expect(region.className).not.toContain('fixed');
    expect(region.textContent).toContain('Level 5');
    expect(region.textContent).toContain('The Local Legend II');
    expect(region.textContent).toContain('3600 XP');
    expect(region.textContent).toContain('Next level: The Local Legend III at 4500 XP');

    const bar = screen.getByRole('progressbar', {
      name: '3600 of 4500 XP, 10% toward The Local Legend III',
    });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('10');
    expect(bar.querySelector('div')?.getAttribute('style')).toContain('width: 10%');

    const milestones = screen.getByRole('list', { name: LEVELS_REACHED_HEADING });
    const items = within(milestones).getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('data-level'))).toEqual(['1', '2', '3', '4', '5']);
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Feb 3, 2026'),
      expect.stringContaining('May 10, 2026'),
      expect.stringContaining('Aug 15, 2026'),
      expect.stringContaining('Dec 31, 2026'),
      expect.stringContaining('Jan 15, 2027'),
    ]);

    const edge = items[3];
    expect(edge?.getAttribute('data-quarter-key')).toBe('2026-Q4');
    expect(edge?.textContent).toContain(formatQuarterLabel('2026-Q4'));
    expect(edge?.textContent).toContain(NO_ENTRY_BEFORE_LABEL);
    expect(edge?.textContent).not.toContain(DRAWING_ENTRY_LABEL);
    expect(edge?.textContent).not.toContain(formatQuarterLabel('2027-Q1'));

    const earned = items[4];
    expect(earned?.getAttribute('data-quarter-key')).toBe('2027-Q1');
    expect(earned?.textContent).toContain(DRAWING_ENTRY_LABEL);
    expect(earned?.textContent).not.toContain(NO_ENTRY_BEFORE_LABEL);

    for (const item of items.slice(0, 4)) {
      expect(item.textContent).toContain(NO_ENTRY_BEFORE_LABEL);
      expect(item.textContent).not.toContain(DRAWING_ENTRY_LABEL);
    }

    const counts = within(screen.getByRole('list', { name: DRAWING_ENTRIES_HEADING })).getAllByRole(
      'listitem',
    );
    expect(counts).toHaveLength(1);
    expect(counts[0]?.getAttribute('data-quarter-key')).toBe('2027-Q1');
    expect(counts[0]?.textContent).toContain(formatQuarterLabel('2027-Q1'));
    expect(counts[0]?.textContent).toContain('1 drawing entry');
    expect(region.textContent).toContain(DRAWING_ENTRIES_NOTE);
    expect(region.textContent).not.toMatch(/prize|sweepstake|winner|giveaway|\$\d|live drawing|drawing date/i);
    expect(region.textContent).not.toMatch(/\b(review|recipe|checkmark|QR)\b/);
  });

  it('keeps a stored quarter when the UTC date is already next year', () => {
    const summary = legendSummary();
    summary.milestones = summary.milestones.map((milestone) =>
      milestone.level === 4 ? { ...milestone, hasEntry: true } : milestone,
    );
    summary.entriesByQuarter = [{ quarterKey: '2026-Q4', count: 2 }];
    render(<MemberProgressionPanel summary={summary} />);
    const milestones = screen.getByRole('list', { name: LEVELS_REACHED_HEADING });
    const edge = within(milestones).getAllByRole('listitem').find((item) => item.dataset.level === '4');
    if (!edge) throw new Error('missing level 4');
    expect(edge.getAttribute('data-quarter-key')).toBe('2026-Q4');
    expect(edge.textContent).toContain('Dec 31, 2026');
    expect(edge.textContent).toContain('Oct\u2013Dec 2026');
    expect(edge.textContent).toContain(DRAWING_ENTRY_LABEL);
    expect(edge.textContent).not.toContain('before entries began');
    const counts = screen.getByRole('list', { name: DRAWING_ENTRIES_HEADING });
    expect(within(counts).getByText('2 drawing entries')).toBeTruthy();
    expect(within(counts).getByText('Oct\u2013Dec 2026')).toBeTruthy();
  });

  it('formats a November fallback instant as Nov 1 and does not mark a later milestone', () => {
    const summary = legendSummary();
    summary.milestones = [
      {
        id: 'm-nov-1',
        level: 1,
        name: 'The Explorer',
        reachedAt: '2026-11-01T06:30:00.000Z',
        quarterKey: '2026-Q4',
        hasEntry: false,
      },
      {
        id: 'm-nov-2',
        level: 2,
        name: 'The Tastemaker',
        reachedAt: '2026-11-01T07:30:00.000Z',
        quarterKey: '2026-Q4',
        hasEntry: false,
      },
      {
        id: 'm-nov-5',
        level: 5,
        name: 'The Local Legend II',
        reachedAt: '2027-01-15T18:00:00.000Z',
        quarterKey: '2027-Q1',
        hasEntry: false,
      },
    ];
    render(<MemberProgressionPanel summary={summary} />);
    const items = within(screen.getByRole('list', { name: LEVELS_REACHED_HEADING })).getAllByRole(
      'listitem',
    );
    expect(items[0]?.textContent).toContain('Nov 1, 2026');
    expect(items[1]?.textContent).toContain('Nov 1, 2026');
    expect(items[0]?.textContent).toContain(NO_ENTRY_BEFORE_LABEL);
    expect(items[2]?.textContent).toContain('Jan 15, 2027');
    expect(items[2]?.textContent).not.toContain(DRAWING_ENTRY_LABEL);
    expect(items[2]?.textContent).not.toContain(NO_ENTRY_BEFORE_LABEL);
  });

  it('shows a friendly empty state for a member with no ledger rows', () => {
    const summary = summarizeMemberProgression({ events: [], milestones: [], entries: [] });
    render(<MemberProgressionPanel summary={summary} />);
    const region = sectionOf(screen.getByRole('heading', { name: MEMBER_PROGRESSION_HEADING }));
    expect(summary).toMatchObject({
      level: 0,
      name: 'Getting started',
      xp: 0,
      nextLevel: { level: 1, name: 'The Explorer', xp: 300 },
    });
    expect(region.textContent).toContain('Level 0');
    expect(region.textContent).toContain('Getting started');
    expect(region.textContent).toContain('0 XP');
    expect(region.textContent).toContain('Next level: The Explorer at 300 XP');
    expect(region.textContent).toContain(NO_LEVELS_YET);
    expect(region.textContent).toContain(NO_DRAWING_ENTRIES_YET);
    expect(region.textContent).toContain(DRAWING_ENTRIES_NOTE);
    expect(region.textContent).not.toContain(PROGRESSION_UNAVAILABLE_MESSAGE);
    expect(region.textContent).not.toMatch(/error/i);
    expect(screen.queryByRole('list', { name: LEVELS_REACHED_HEADING })).toBeNull();
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(bar.getAttribute('aria-label')).toBe('0 of 300 XP, 0% toward The Explorer');
  });

  it('still lists stored milestones when the summary is inconsistent', () => {
    const summary = legendSummary();
    summary.milestones = summary.milestones.filter((milestone) => milestone.level === 4);
    summary.consistent = false;
    summary.ignored = { events: 97, milestones: 98, entries: 99 };
    render(<MemberProgressionPanel summary={summary} />);
    const region = sectionOf(screen.getByRole('heading', { name: MEMBER_PROGRESSION_HEADING }));
    expect(region.textContent).toContain('The Local Legend');
    expect(region.textContent).toContain('Dec 31, 2026');
    expect(region.textContent).toContain('Oct\u2013Dec 2026');
    expect(region.textContent).not.toMatch(/consistent|ignored/i);
    expect(region.textContent).not.toContain('97');
    expect(region.textContent).not.toContain('98');
    expect(region.textContent).not.toContain('99');
  });

  it('shows the unavailable message without a level or an entry count', () => {
    render(<MemberProgressionUnavailable />);
    expect(screen.getByRole('heading', { name: MEMBER_PROGRESSION_HEADING })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(PROGRESSION_UNAVAILABLE_MESSAGE);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(NO_LEVELS_YET)).toBeNull();
    expect(document.body.textContent).not.toMatch(/prize|sweepstake/i);
  });

  it('does not recompute quarters or log', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/components/journey/progression-panel.tsx'), 'utf8');
    expect(source).not.toMatch(/chicagoQuarterKey|console\.|levelFromXp/);
  });
});

describe('member progression panel under TZ=UTC and TZ=America/Chicago', () => {
  it('renders the same dates for the year boundary and the November fallback', () => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const probe = 'src/components/journey/progression-panel.tz-probe.tsx';
    const run = (tz: string) => {
      const result = spawnSync(tsx, [probe], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, TZ: tz },
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as {
        edgeDate: string;
        novemberDate: string;
        octoberEvening: string;
        quarter: string;
        beforeEdge: boolean;
        level: number;
        name: string;
        xp: number;
        legend: string;
        fallback: string;
      };
    };

    const utc = run('UTC');
    const chicago = run('America/Chicago');
    expect(chicago).toEqual(utc);
    expect(utc.edgeDate).toBe('Dec 31, 2026');
    expect(utc.novemberDate).toBe('Nov 1, 2026');
    expect(utc.octoberEvening).toBe('Oct 31, 2026');
    expect(utc.quarter).toBe('Oct\u2013Dec 2026');
    expect(utc.beforeEdge).toBe(true);
    expect(utc).toMatchObject({ level: 5, name: 'The Local Legend II', xp: 3600 });
    expect(utc.legend).toContain('Dec 31, 2026');
    expect(utc.legend).toContain('Oct\u2013Dec 2026');
    expect(utc.legend).toContain('The Local Legend II');
    expect(utc.legend).toContain('data-quarter-key="2026-Q4"');
    expect(utc.fallback).toContain('Nov 1, 2026');
    expect(utc.fallback).not.toContain('Nov 2, 2026');
  }, 20000);
});
