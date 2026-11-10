/**
 * Display labels for the member progression panel.
 *
 * A reached date is the America/Chicago calendar day of the stored instant.
 * A quarter label is the stored `quarterKey`. It is not computed again from
 * the timestamp. `2026-Q4` stays Oct–Dec 2026 even when the UTC date is
 * already in 2027.
 *
 * Drawing-entry copy is a count, plus the Jan 1, 2027 start. It does not
 * name a prize, a prize value, or a drawing date.
 */

/** 2027-01-01 00:00 America/Chicago. January is CST (UTC−6). */
export const DRAWING_ENTRIES_FROM_ISO = '2027-01-01T06:00:00.000Z';

export const MEMBER_PROGRESSION_HEADING = 'Levels and drawing entries';
export const LEVELS_REACHED_HEADING = 'Levels reached';
export const DRAWING_ENTRIES_HEADING = 'Drawing entries';
export const DRAWING_ENTRIES_NOTE = 'Drawing entries count from Jan 1, 2027.';
export const DRAWING_ENTRY_LABEL = 'Drawing entry';
export const NO_ENTRY_BEFORE_LABEL = 'No drawing entry (before entries began)';
export const PROGRESSION_UNAVAILABLE_MESSAGE = "Couldn't load your levels right now";
export const NO_LEVELS_YET = 'You have not reached a level yet.';
export const NO_DRAWING_ENTRIES_YET = 'No drawing entries yet.';

const QUARTER_KEY = /^(\d{4})-Q([1-4])$/;
const QUARTER_RANGES = ['Jan\u2013Mar', 'Apr\u2013Jun', 'Jul\u2013Sep', 'Oct\u2013Dec'] as const;

const chicagoReachedDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  calendar: 'gregory',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** America/Chicago calendar date, such as `Dec 31, 2026`. Unparseable input is null. */
export function formatChicagoReachedDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return chicagoReachedDate.format(date);
}

/**
 * `2027-Q1` becomes `Jan–Mar 2027`. Any other string is returned unchanged
 * so a stored key is never replaced with a guessed range.
 */
export function formatQuarterLabel(quarterKey: string): string {
  const match = QUARTER_KEY.exec(quarterKey);
  if (!match) return quarterKey;
  const year = match[1];
  const quarter = Number(match[2]);
  const range = QUARTER_RANGES[quarter - 1];
  if (!year || !range) return quarterKey;
  return `${range} ${year}`;
}

/** True when the stored instant is strictly before 2027-01-01 00:00 America/Chicago. */
export function milestoneBeforeDrawingEntries(reachedAt: string): boolean {
  const time = Date.parse(reachedAt);
  if (!Number.isFinite(time)) return false;
  return time < Date.parse(DRAWING_ENTRIES_FROM_ISO);
}

export function clampedProgressPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function progressionProgressLabel(summary: {
  xp: number;
  progressPercent: number;
  nextLevel: { name: string; xp: number } | null;
}): string {
  const percent = clampedProgressPercent(summary.progressPercent);
  const next = summary.nextLevel;
  if (!next) return `${summary.xp} XP, ${percent}% of this level`;
  return `${summary.xp} of ${next.xp} XP, ${percent}% toward ${next.name}`;
}

export function nextLevelLine(next: { name: string; xp: number } | null): string | null {
  if (!next) return null;
  return `Next level: ${next.name} at ${next.xp} XP`;
}

/** Entry marker from the stored `hasEntry` flag. The date only explains a missing entry. */
export function drawingEntryMarker(args: { hasEntry: boolean; reachedAt: string }): string | null {
  if (args.hasEntry) return DRAWING_ENTRY_LABEL;
  if (milestoneBeforeDrawingEntries(args.reachedAt)) return NO_ENTRY_BEFORE_LABEL;
  return null;
}
