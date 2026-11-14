/**
 * Partner-facing verified time. Vercel servers format in UTC unless a zone is set.
 * Chicago is the fallback. A zone already on the loaded row can be passed in.
 * This does not query a market or restaurant.
 */

export const PARTNER_VERIFIED_AT_FALLBACK_ZONE = 'America/Chicago';

const WALL_CLOCK: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
};

export function formatPartnerVerifiedAt(
  iso: string | null | undefined,
  timeZone?: string | null,
): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const zone = usableZone(timeZone) ?? PARTNER_VERIFIED_AT_FALLBACK_ZONE;
  try {
    return `${wallClock(date, zone)} ${zoneLabel(zone, date)}`;
  } catch {
    return `${wallClock(date, PARTNER_VERIFIED_AT_FALLBACK_ZONE)} CT`;
  }
}

function usableZone(timeZone: string | null | undefined): string | null {
  const zone = timeZone?.trim();
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date(0));
    return zone;
  } catch {
    return null;
  }
}

function wallClock(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { ...WALL_CLOCK, timeZone }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const month = value('month');
  const day = value('day');
  const year = value('year');
  const hour = value('hour');
  const minute = value('minute');
  const dayPeriod = value('dayPeriod').toUpperCase();
  return `${month} ${day}, ${year}, ${hour}:${minute} ${dayPeriod}`;
}

function zoneLabel(timeZone: string, date: Date): string {
  if (timeZone === PARTNER_VERIFIED_AT_FALLBACK_ZONE) return 'CT';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  }).formatToParts(date);
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
}
