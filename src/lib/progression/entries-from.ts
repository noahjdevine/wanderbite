import { chicagoMidnight } from '@/lib/challenges/supply-simulation-lifecycle';

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * America/Chicago midnight of a calendar date, as an absolute instant.
 * Uses `chicagoMidnight` (the same conversion as `timestamp at time zone`).
 * There is no default date. The caller must pass YYYY-MM-DD.
 */
export function chicagoDateMidnight(yyyyMmDd: string): Date {
  const match = CALENDAR_DATE.exec(yyyyMmDd);
  if (!match) {
    throw new Error('entries-from must be YYYY-MM-DD');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year
    || utc.getUTCMonth() !== month - 1
    || utc.getUTCDate() !== day
  ) {
    throw new Error('entries-from must be a real calendar date');
  }
  return chicagoMidnight(yyyyMmDd);
}
