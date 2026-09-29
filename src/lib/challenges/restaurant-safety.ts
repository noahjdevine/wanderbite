import { subMonths, subYears } from 'date-fns';
import { getDietaryConflict, hasAllergyConflict } from '@/lib/dietary-utils';
import { restaurantHasExcludedCuisine } from '@/lib/cuisines';

export type CooldownRedemption = {
  restaurant_id: string | null;
  status: string | null;
  verified_at: string | null;
  created_at: string | null;
};

/** No verified visit in six months, and fewer than two verified visits in twelve. */
export function redemptionCooldownOk(
  restaurantId: string,
  redemptions: CooldownRedemption[],
  now: Date,
): boolean {
  const sixMonthsAgo = subMonths(now, 6);
  const twelveMonthsAgo = subYears(now, 12);
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
