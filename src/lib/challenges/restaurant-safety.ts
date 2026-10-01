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
 * cooldown stays `rollingTwelveMonthStart` (`subMonths(now, 12)`).
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

/**
 * Why a verified history blocks this restaurant, if it does.
 * A visit inside six months wins over two visits inside twelve.
 */
export function redemptionCooldownReason(
  restaurantId: string,
  redemptions: CooldownRedemption[],
  now: Date,
): CooldownBlockReason | null {
  const sixMonthsAgo = subMonths(now, 6);
  const twelveMonthsAgo = rollingTwelveMonthStart(now);
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
