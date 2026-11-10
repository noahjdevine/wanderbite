import { describe, expect, it } from 'vitest';
import { chicagoDateMidnight } from '@/lib/progression/entries-from';
import {
  DRAWING_ENTRIES_FROM_ISO,
  DRAWING_ENTRIES_NOTE,
  DRAWING_ENTRY_LABEL,
  NO_ENTRY_BEFORE_LABEL,
  clampedProgressPercent,
  drawingEntryMarker,
  formatChicagoReachedDate,
  formatQuarterLabel,
  milestoneBeforeDrawingEntries,
  nextLevelLine,
  progressionProgressLabel,
} from '@/lib/progression/format';

/** 2026-12-31 23:30 America/Chicago. The UTC calendar date is 2027-01-01. */
const CHICAGO_EDGE = '2027-01-01T05:30:00.000Z';

describe('formatChicagoReachedDate', () => {
  it('uses the America/Chicago calendar day, including the year boundary and the November fallback', () => {
    expect(formatChicagoReachedDate(CHICAGO_EDGE)).toBe('Dec 31, 2026');
    expect(formatChicagoReachedDate(DRAWING_ENTRIES_FROM_ISO)).toBe('Jan 1, 2027');
    // 2026-10-31 23:30 CDT, the evening before the fallback.
    expect(formatChicagoReachedDate('2026-11-01T04:30:00.000Z')).toBe('Oct 31, 2026');
    // 2026-11-01 00:30 CDT.
    expect(formatChicagoReachedDate('2026-11-01T05:30:00.000Z')).toBe('Nov 1, 2026');
    // 2026-11-01 01:30 CDT, the first time that clock hour occurs.
    expect(formatChicagoReachedDate('2026-11-01T06:30:00.000Z')).toBe('Nov 1, 2026');
    // 2026-11-01 01:30 CST, the second time that clock hour occurs.
    expect(formatChicagoReachedDate('2026-11-01T07:30:00.000Z')).toBe('Nov 1, 2026');
  });

  it('does not invent a date for an unparseable instant', () => {
    expect(formatChicagoReachedDate('not-a-date')).toBeNull();
    expect(formatChicagoReachedDate('')).toBeNull();
  });
});

describe('formatQuarterLabel', () => {
  it('labels a stored quarter key', () => {
    expect(formatQuarterLabel('2027-Q1')).toBe('Jan\u2013Mar 2027');
    expect(formatQuarterLabel('2026-Q2')).toBe('Apr\u2013Jun 2026');
    expect(formatQuarterLabel('2026-Q3')).toBe('Jul\u2013Sep 2026');
    expect(formatQuarterLabel('2026-Q4')).toBe('Oct\u2013Dec 2026');
  });

  it('leaves any other stored key unchanged', () => {
    expect(formatQuarterLabel('2027-Q1 ')).toBe('2027-Q1 ');
    expect(formatQuarterLabel('2026-q4')).toBe('2026-q4');
    expect(formatQuarterLabel('2026-Q5')).toBe('2026-Q5');
    expect(formatQuarterLabel('nope')).toBe('nope');
  });
});

describe('drawing entry start', () => {
  it('matches America/Chicago midnight on 2027-01-01', () => {
    expect(DRAWING_ENTRIES_FROM_ISO).toBe(chicagoDateMidnight('2027-01-01').toISOString());
    expect(DRAWING_ENTRIES_NOTE).toBe('Drawing entries count from Jan 1, 2027.');
  });

  it('is true only before that instant', () => {
    expect(milestoneBeforeDrawingEntries(CHICAGO_EDGE)).toBe(true);
    expect(milestoneBeforeDrawingEntries('2027-01-01T05:59:59.999Z')).toBe(true);
    expect(milestoneBeforeDrawingEntries(DRAWING_ENTRIES_FROM_ISO)).toBe(false);
    expect(milestoneBeforeDrawingEntries('2027-01-15T18:00:00.000Z')).toBe(false);
    expect(milestoneBeforeDrawingEntries('not-a-date')).toBe(false);
  });

  it('shows an entry marker only when the row has one', () => {
    expect(drawingEntryMarker({ hasEntry: true, reachedAt: CHICAGO_EDGE })).toBe(DRAWING_ENTRY_LABEL);
    expect(drawingEntryMarker({ hasEntry: false, reachedAt: CHICAGO_EDGE })).toBe(NO_ENTRY_BEFORE_LABEL);
    expect(drawingEntryMarker({ hasEntry: true, reachedAt: DRAWING_ENTRIES_FROM_ISO })).toBe(
      DRAWING_ENTRY_LABEL,
    );
    expect(drawingEntryMarker({ hasEntry: false, reachedAt: DRAWING_ENTRIES_FROM_ISO })).toBeNull();
    expect(drawingEntryMarker({ hasEntry: false, reachedAt: 'not-a-date' })).toBeNull();
  });
});

describe('progression progress label', () => {
  it('uses the summary percent toward the next level', () => {
    expect(clampedProgressPercent(10)).toBe(10);
    expect(clampedProgressPercent(Number.NaN)).toBe(0);
    expect(clampedProgressPercent(140)).toBe(100);
    expect(
      progressionProgressLabel({
        xp: 3600,
        progressPercent: 10,
        nextLevel: { name: 'The Local Legend III', xp: 4500 },
      }),
    ).toBe('3600 of 4500 XP, 10% toward The Local Legend III');
    expect(
      nextLevelLine({ name: 'The Local Legend III', xp: 4500 }),
    ).toBe('Next level: The Local Legend III at 4500 XP');
    expect(
      progressionProgressLabel({
        xp: 0,
        progressPercent: 0,
        nextLevel: { name: 'The Explorer', xp: 300 },
      }),
    ).toBe('0 of 300 XP, 0% toward The Explorer');
    expect(nextLevelLine(null)).toBeNull();
    expect(progressionProgressLabel({ xp: 2500, progressPercent: 100, nextLevel: null })).toBe(
      '2500 XP, 100% of this level',
    );
  });
});
