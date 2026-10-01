import { format, subMonths } from 'date-fns';
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
 * `cycle_month` lower bound for {@link rollingTwelveMonthStart}.
 * Same shape as the six-month variety bound: `format(subMonths(now, n), 'yyyy-MM-dd')`.
 */
export function rollingTwelveMonthCycleBound(now: Date): string {
  return format(rollingTwelveMonthStart(now), 'yyyy-MM-dd');
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
