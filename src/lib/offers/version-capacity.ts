import { offerVersionCoversDeadline } from '@/lib/challenges/challenge-deadline';

/**
 * Mirrors the latest `version_selection_ok` / `reserve_version_buckets`
 * (`supabase/migrations/20260925175518_e02_capacity_binding.sql`).
 * Later migrations call those functions and do not replace them.
 * Assignment horizon is 840 hours, the same interval the RPCs pass in.
 */
export const ASSIGNMENT_WINDOW_MS = 840 * 60 * 60 * 1000;

const MAX_BUCKET_STEPS = 48;

export type VersionCapacityFields = {
  id: string;
  restaurant_id: string;
  valid_from: string;
  valid_until: string;
  withdrawn_from_selection_at: string | null;
  capacity_timezone: string;
  capacity_max_redemptions: number;
};

export type VersionSelectionRestaurant = {
  id: string;
  current_offer_version_id: string | null;
};

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let format = zoneFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    zoneFormatters.set(timeZone, format);
  }
  return format;
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zoneFormatter(timeZone).formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  let hour = pick('hour');
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(
    pick('year'),
    pick('month') - 1,
    pick('day'),
    hour,
    pick('minute'),
    pick('second'),
  );
  return asUtc - instant.getTime();
}

/** `date_trunc('month', instant at time zone tz)::date`. */
function monthKey(instant: Date, timeZone: string): string {
  const parts = zoneFormatter(timeZone).formatToParts(instant);
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  return `${year}-${month}-01`;
}

function shiftMonthKey(yyyyMmDd: string, delta: number): string {
  const year = Number(yyyyMmDd.slice(0, 4));
  const monthIndex = Number(yyyyMmDd.slice(5, 7)) - 1;
  const shifted = year * 12 + monthIndex + delta;
  const shiftedYear = Math.floor(shifted / 12);
  const shiftedMonth = shifted - shiftedYear * 12 + 1;
  return `${String(shiftedYear).padStart(4, '0')}-${String(shiftedMonth).padStart(2, '0')}-01`;
}

/** Wall-clock midnight as a UTC instant. Matches `timestamp at time zone tz`. */
function zonedMidnight(yyyyMmDd: string, timeZone: string): Date {
  const [year, month, day] = yyyyMmDd.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offset = zoneOffsetMs(new Date(guess), timeZone);
  let utc = guess - offset;
  const corrected = zoneOffsetMs(new Date(utc), timeZone);
  if (corrected !== offset) utc = guess - corrected;
  return new Date(utc);
}

export function assignmentDeadline(assignedAt: Date): Date {
  return new Date(assignedAt.getTime() + ASSIGNMENT_WINDOW_MS);
}

/**
 * `bucket_start` dates `reserve_version_buckets` would consider.
 * Starts at `date_trunc('month', assigned at capacity_timezone)`.
 * A bucket is included only when its month start (at tz) is before `deadline`
 * and its month end (at tz) is after `assignedAt`.
 */
export function versionCapacityBuckets(
  assignedAt: Date,
  deadline: Date,
  capacityTimezone: string,
): string[] {
  let month = monthKey(assignedAt, capacityTimezone);
  const buckets: string[] = [];
  for (let step = 0; step < MAX_BUCKET_STEPS; step += 1) {
    if (zonedMidnight(month, capacityTimezone).getTime() >= deadline.getTime()) return buckets;
    const next = shiftMonthKey(month, 1);
    if (zonedMidnight(next, capacityTimezone).getTime() > assignedAt.getTime()) buckets.push(month);
    month = next;
  }
  throw new Error('version capacity bucket loop exceeded 48 months');
}

/** True only when every bucket's reserved+consumed count is strictly below `cap`. */
export function versionHasCapacity(
  buckets: readonly string[],
  countsByBucket: ReadonlyMap<string, number>,
  cap: number,
): boolean {
  return buckets.every((bucket) => (countsByBucket.get(bucket) ?? 0) < cap);
}

/**
 * `version_selection_ok`: current offer version, not withdrawn,
 * `valid_from <= now < valid_until`, and `valid_until > now + 840 hours`.
 */
export function versionSelectable(
  version: {
    id: string;
    restaurant_id: string;
    valid_from: string;
    valid_until: string;
    withdrawn_from_selection_at: string | null;
  },
  now: Date,
  restaurant: VersionSelectionRestaurant,
): boolean {
  if (restaurant.current_offer_version_id !== version.id) return false;
  if (version.restaurant_id !== restaurant.id) return false;
  return offerVersionCoversDeadline(version, now, assignmentDeadline(now));
}

/**
 * Version-bound restaurants must be selectable and have room in every bucket.
 * A null current offer version is legacy: this pre-filter does not apply.
 */
export function passesVersionCapacityPrefilter(args: {
  restaurantId: string;
  currentOfferVersionId: string | null;
  version: VersionCapacityFields | null;
  now: Date;
  countsByBucket: ReadonlyMap<string, number>;
}): boolean {
  if (!args.currentOfferVersionId) return true;
  if (!args.version) return false;
  if (
    !versionSelectable(args.version, args.now, {
      id: args.restaurantId,
      current_offer_version_id: args.currentOfferVersionId,
    })
  ) {
    return false;
  }
  const buckets = versionCapacityBuckets(
    args.now,
    assignmentDeadline(args.now),
    args.version.capacity_timezone,
  );
  return versionHasCapacity(buckets, args.countsByBucket, args.version.capacity_max_redemptions);
}
