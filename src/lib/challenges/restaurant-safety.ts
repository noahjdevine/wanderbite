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
 * Inclusive `cycle_month` lower bound for variety (`cyclesLast12`).
 *
 * Chicago month start 11 months before the Chicago month of `now`.
 * During October 2026 the bound is `2025-11-01`, so the October 2025 cycle
 * is outside and a full 12 Chicago months have passed. The day of the month
 * and the server clock do not move it.
 *
 * The variety query is `cycle_month >=` this value and has no upper bound,
 * so a row for the current month is included when one exists.
 */
export function varietyCycleMonthLowerBound(now: Date): string {
  const current = chicagoMonthStart(now);
  const year = Number(current.slice(0, 4));
  const monthIndex = Number(current.slice(5, 7)) - 1;
  const shifted = year * 12 + monthIndex - 11;
  const shiftedYear = Math.floor(shifted / 12);
  const shiftedMonth = shifted - shiftedYear * 12 + 1;
  return `${String(shiftedYear).padStart(4, '0')}-${String(shiftedMonth).padStart(2, '0')}-01`;
}

/** No verified visit in six months, and fewer than two verified visits in twelve. */
export function redemptionCooldownOk(
  restaurantId: string,
  redemptions: CooldownRedemption[],
  now: Date,
): boolean {
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
  if (verifiedAts.some((at) => at >= sixMonthsAgo)) return false;
  if (verifiedAts.filter((at) => at >= twelveMonthsAgo).length >= 2) return false;
  return true;
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
