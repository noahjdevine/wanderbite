import { subMonths } from 'date-fns';
import { chicagoMonthStart } from '@/lib/cron-period';
import { getDietaryConflict, hasAllergyConflict } from '@/lib/dietary-utils';
import { restaurantHasExcludedCuisine } from '@/lib/cuisines';

export type CooldownRedemption = {
  restaurant_id: string | null;
  status: string | null;
  verified_at: string | null;
  created_at: string | null;
};

/**
 * Inclusive start of the rolling 12-month window.
 * This is the date-fns instant, not a Chicago month key and not `startOfMonth`.
 */
export function rollingTwelveMonthStart(now: Date): Date {
  return subMonths(now, 12);
}

/**
 * Inclusive `cycle_month` lower bound for a variety lookback of `months`
 * full Chicago calendar months.
 *
 * Chicago month start of `chicagoMonthStart(now)` minus `months` months.
 * With `now` in Chicago month M, cycles from M−`months` through M−1 match
 * `cycle_month >=` this value and `cycle_month < chicagoMonthStart(now)`.
 * The current Chicago month is outside that window. The day of the month
 * and the server clock do not move the bound.
 *
 * Six-month and twelve-month variety both use this helper. The redemption
 * cooldown is still a rolling instant, measured on the America/Chicago
 * wall clock so the process timezone cannot move the cutoff.
 */
export function varietyCycleMonthLowerBound(now: Date, months: number): string {
  const current = chicagoMonthStart(now);
  const year = Number(current.slice(0, 4));
  const monthIndex = Number(current.slice(5, 7)) - 1;
  const shifted = year * 12 + monthIndex - months;
  const shiftedYear = Math.floor(shifted / 12);
  const shiftedMonth = shifted - shiftedYear * 12 + 1;
  return `${String(shiftedYear).padStart(4, '0')}-${String(shiftedMonth).padStart(2, '0')}-01`;
}

export type CooldownBlockReason = 'recent_visit_6m' | 'two_in_12m';

const CHICAGO = 'America/Chicago';

const chicagoWallFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: CHICAGO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function chicagoWallClock(instant: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
} {
  const parts = chicagoWallFormat.formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  let hour = pick('hour');
  if (hour === 24) hour = 0;
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour,
    minute: pick('minute'),
    second: pick('second'),
    ms: instant.getUTCMilliseconds(),
  };
}

/** Milliseconds to add to a UTC instant to get the Chicago wall clock read as UTC. */
function chicagoOffsetMs(instant: Date): number {
  const wall = chicagoWallClock(instant);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second, wall.ms);
  return asUtc - instant.getTime();
}

/** America/Chicago is CST (UTC−6) or CDT (UTC−5). Intl confirms which one applies. */
const CHICAGO_STANDARD_OFFSET_MS = -6 * 60 * 60 * 1000;
const CHICAGO_DAYLIGHT_OFFSET_MS = -5 * 60 * 60 * 1000;

function wallMatchesInstant(
  instantMs: number,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
): boolean {
  const wall = chicagoWallClock(new Date(instantMs));
  return (
    wall.year === year &&
    wall.month === month &&
    wall.day === day &&
    wall.hour === hour &&
    wall.minute === minute &&
    wall.second === second &&
    wall.ms === ms
  );
}

/**
 * First valid Chicago instant after the spring-forward gap on this civil date.
 * US Chicago springs forward at 02:00, so the transition is 03:00 CDT.
 */
function chicagoSpringTransitionMs(year: number, month: number, day: number): number {
  const start = Date.UTC(year, month - 1, day, 6, 0, 0, 0);
  let lo = start;
  let hi = start + 6 * 60 * 60 * 1000;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (chicagoOffsetMs(new Date(mid)) === CHICAGO_DAYLIGHT_OFFSET_MS) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Chicago wall clock to UTC. A nonexistent spring-forward time resolves to
 * the transition instant. An ambiguous fall-back time resolves to the
 * earlier occurrence. The process timezone is not consulted.
 */
function chicagoWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
): Date {
  const wallMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const matches: number[] = [];
  for (const offsetMs of [CHICAGO_STANDARD_OFFSET_MS, CHICAGO_DAYLIGHT_OFFSET_MS]) {
    const instantMs = wallMs - offsetMs;
    if (chicagoOffsetMs(new Date(instantMs)) !== offsetMs) continue;
    if (wallMatchesInstant(instantMs, year, month, day, hour, minute, second, ms)) {
      matches.push(instantMs);
    }
  }
  if (matches.length > 0) return new Date(Math.min(...matches));
  return new Date(chicagoSpringTransitionMs(year, month, day));
}

type ChicagoWall = ReturnType<typeof chicagoWallClock>;

function shiftChicagoWall(wall: ChicagoWall, months: number): { year: number; month: number; day: number } {
  const shifted = wall.year * 12 + (wall.month - 1) - months;
  const year = Math.floor(shifted / 12);
  const monthIndex = shifted - year * 12;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return {
    year,
    month: monthIndex + 1,
    day: Math.min(wall.day, daysInMonth),
  };
}

function subMonthsChicagoWall(now: Date, months: number): Date {
  const wall = chicagoWallClock(now);
  const shifted = shiftChicagoWall(wall, months);
  return chicagoWallClockToUtc(
    shifted.year,
    shifted.month,
    shifted.day,
    wall.hour,
    wall.minute,
    wall.second,
    wall.ms,
  );
}

/**
 * Instant when `now` is the later occurrence of a repeated Chicago hour,
 * otherwise null. The returned value is the start of that later hour.
 */
function laterChicagoFoldStartMs(now: Date): number | null {
  const wall = chicagoWallClock(now);
  const earlier = chicagoWallClockToUtc(
    wall.year,
    wall.month,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
    wall.ms,
  );
  if (earlier.getTime() === now.getTime()) return null;
  const elapsedInHour = wall.minute * 60_000 + wall.second * 1000 + wall.ms;
  return now.getTime() - elapsedInHour;
}

/**
 * `subMonths` on the America/Chicago wall clock. The process timezone does
 * not change the instant. Day-of-month clamps the same way date-fns does.
 *
 * A missing spring-forward target resolves to the transition instant. An
 * ambiguous fall-back target resolves to the earlier occurrence. While `now`
 * is inside the later copy of a repeated hour, the cutoff stays at the value
 * it had one millisecond before the backward transition.
 *
 * Month-end and leap-day clamping can still move a cutoff backward as `now`
 * advances (31 March → 28 February, for example). This helper does not hide
 * that calendar clamp.
 */
export function subMonthsChicago(now: Date, months: number): Date {
  const naive = subMonthsChicagoWall(now, months);
  const foldStartMs = laterChicagoFoldStartMs(now);
  if (foldStartMs == null) return naive;
  const held = subMonthsChicagoWall(new Date(foldStartMs - 1), months);
  return naive.getTime() < held.getTime() ? held : naive;
}

/**
 * Why a verified history blocks this restaurant, if it does.
 * A visit inside six Chicago months wins over two visits inside twelve.
 */
export function redemptionCooldownReason(
  restaurantId: string,
  redemptions: CooldownRedemption[],
  now: Date,
): CooldownBlockReason | null {
  const sixMonthsAgo = subMonthsChicago(now, 6);
  const twelveMonthsAgo = subMonthsChicago(now, 12);
  const verifiedAts = redemptions
    .filter((row) => row.restaurant_id === restaurantId && row.status === 'verified')
    .flatMap((row) => {
      const raw = row.verified_at ?? row.created_at;
      if (!raw) return [];
      const at = new Date(raw);
      return Number.isNaN(at.getTime()) ? [] : [at];
    });
  if (verifiedAts.some((at) => at >= sixMonthsAgo)) return 'recent_visit_6m';
  if (verifiedAts.filter((at) => at >= twelveMonthsAgo).length >= 2) return 'two_in_12m';
  return null;
}

/** No verified visit in six months, and fewer than two verified visits in twelve. */
export function redemptionCooldownOk(
  restaurantId: string,
  redemptions: CooldownRedemption[],
  now: Date,
): boolean {
  return redemptionCooldownReason(restaurantId, redemptions, now) === null;
}

export function passesRestaurantHardFilters(args: {
  cuisineTags: string[] | null;
  allergyFlags: string[] | null;
  dietaryFlags: string[] | null;
  excludedCuisineIds: string[];
  restaurantId: string;
  redemptions: CooldownRedemption[];
  now: Date;
}): boolean {
  if (getDietaryConflict(args.cuisineTags, args.dietaryFlags)) return false;
  if (hasAllergyConflict(args.cuisineTags, args.allergyFlags)) return false;
  if (
    restaurantHasExcludedCuisine({
      restaurantCuisineTags: args.cuisineTags,
      excludedCuisineIds: args.excludedCuisineIds,
    })
  ) {
    return false;
  }
  return redemptionCooldownOk(args.restaurantId, args.redemptions, args.now);
}
