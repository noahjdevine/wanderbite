import { assignmentDeadline, versionCapacityBuckets, versionSelectable } from './version-capacity';

const HOURS_840 = 840 * 60 * 60 * 1000;

const assignedOct = '2026-10-20T15:00:00.000Z';
const assignedNovEve = '2026-11-01T03:00:00.000Z';
const chicagoNovStart = '2026-11-01T05:00:00.000Z';
const chicagoDecStart = '2026-12-01T06:00:00.000Z';

function plus840(iso: string): string {
  return new Date(Date.parse(iso) + HOURS_840).toISOString();
}

const bucketInputs = [
  { name: 'oct-20-chicago', assignedAt: assignedOct, deadline: plus840(assignedOct), capacityTimezone: 'America/Chicago' },
  { name: 'nov-1-03z-chicago', assignedAt: assignedNovEve, deadline: plus840(assignedNovEve), capacityTimezone: 'America/Chicago' },
  { name: 'deadline-1ms-before-chicago-nov', assignedAt: assignedOct, deadline: '2026-11-01T04:59:59.999Z', capacityTimezone: 'America/Chicago' },
  { name: 'deadline-at-chicago-nov', assignedAt: assignedOct, deadline: chicagoNovStart, capacityTimezone: 'America/Chicago' },
  { name: 'deadline-1ms-after-chicago-nov', assignedAt: assignedOct, deadline: '2026-11-01T05:00:00.001Z', capacityTimezone: 'America/Chicago' },
  { name: 'deadline-at-chicago-dec', assignedAt: assignedOct, deadline: chicagoDecStart, capacityTimezone: 'America/Chicago' },
  { name: 'deadline-1ms-after-chicago-dec', assignedAt: assignedOct, deadline: '2026-12-01T06:00:00.001Z', capacityTimezone: 'America/Chicago' },
  { name: 'nov-1-03z-utc', assignedAt: assignedNovEve, deadline: plus840(assignedNovEve), capacityTimezone: 'UTC' },
] as const;

const now = new Date(assignedOct);
const horizon = assignmentDeadline(now);
const openUntil = new Date(horizon.getTime() + 1).toISOString();
const version = {
  id: 'v1',
  restaurant_id: 'r1',
  valid_from: '2026-01-01T00:00:00.000Z',
  valid_until: openUntil,
  withdrawn_from_selection_at: null,
};
const restaurant = { id: 'r1', current_offer_version_id: 'v1' };

const report = {
  tz: process.env.TZ ?? '',
  buckets: bucketInputs.map((row) => ({
    name: row.name,
    buckets: versionCapacityBuckets(new Date(row.assignedAt), new Date(row.deadline), row.capacityTimezone),
  })),
  selectable: {
    open: versionSelectable(version, now, restaurant),
    untilEqualsHorizon: versionSelectable({ ...version, valid_until: horizon.toISOString() }, now, restaurant),
    untilPlus1ms: versionSelectable({ ...version, valid_until: openUntil }, now, restaurant),
    withdrawn: versionSelectable(
      { ...version, withdrawn_from_selection_at: now.toISOString() },
      now,
      restaurant,
    ),
    futureFrom: versionSelectable(
      { ...version, valid_from: new Date(now.getTime() + 1).toISOString() },
      now,
      restaurant,
    ),
  },
};

process.stdout.write(`${JSON.stringify(report)}\n`);
