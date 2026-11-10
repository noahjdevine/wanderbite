/**
 * America/Chicago calendar quarter of an event instant.
 * Same time zone as `chicagoCalendarDate` in `src/lib/activities/match.ts`.
 * The process time zone is not consulted. Quarter follows the event time,
 * not the time the caller runs.
 */

const chicagoYearMonth = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  calendar: 'gregory',
  year: 'numeric',
  month: 'numeric',
});

/** `2026-Q4` for the America/Chicago calendar quarter that contains `iso`. */
export function chicagoQuarterKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error('chicagoQuarterKey requires a parseable timestamp');
  }
  const parts = chicagoYearMonth.formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('chicagoQuarterKey could not read an America/Chicago month');
  }
  const quarter = Math.ceil(month / 3);
  return `${year}-Q${quarter}`;
}
