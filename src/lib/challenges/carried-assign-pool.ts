import { lowestSealedBase } from '@/lib/offers/sealed-base';
import { selectDistancePool } from '@/lib/challenges/distance-pool';
import { offerVersionCoversDeadline } from '@/lib/challenges/challenge-deadline';
import {
  passesRestaurantHardFilters,
  type CooldownRedemption,
} from '@/lib/challenges/restaurant-safety';
import type { GeoPoint } from '@/lib/launch-market';
import type { Json } from '@/types/database.types';

export const CARRIED_ASSIGN_FLOOR_CENTS = 2000;

export type AssignVersion = {
  id: string;
  restaurant_id: string;
  valid_from: string;
  valid_until: string;
  withdrawn_from_selection_at: string | null;
  tiers: Json;
};

export type AssignRestaurant = {
  id: string;
  name: string;
  cuisine_tags: string[] | null;
  lat: number | null;
  lon: number | null;
  current_offer_version_id: string | null;
};

export type PricedAssignRestaurant<T extends AssignRestaurant> = T & {
  discount_amount_cents: number;
  min_spend_cents: number;
};

export function filterCarriedAssignCandidates<T extends AssignRestaurant>(args: {
  restaurants: T[];
  versionsById: ReadonlyMap<string, AssignVersion>;
  origin: GeoPoint;
  requestedMiles: number;
  allergyFlags: string[] | null;
  dietaryFlags: string[] | null;
  excludedCuisineIds: string[];
  redemptions: CooldownRedemption[];
  now: Date;
  deadline: Date;
}): PricedAssignRestaurant<T>[] {
  const prepared: PricedAssignRestaurant<T>[] = [];
  for (const restaurant of args.restaurants) {
    const versionId = restaurant.current_offer_version_id;
    if (!versionId) continue;
    const version = args.versionsById.get(versionId);
    if (!version || version.restaurant_id !== restaurant.id) continue;
    if (!offerVersionCoversDeadline(version, args.now, args.deadline)) continue;
    const base = lowestSealedBase(version.tiers);
    if (base == null || base.discount_amount_cents < CARRIED_ASSIGN_FLOOR_CENTS) continue;
    prepared.push({
      ...restaurant,
      discount_amount_cents: base.discount_amount_cents,
      min_spend_cents: base.min_spend_cents,
    });
  }

  return selectDistancePool({
    restaurants: prepared,
    origin: args.origin,
    requestedMiles: args.requestedMiles,
    requiredCount: 1,
    passesHard: (restaurant) =>
      passesRestaurantHardFilters({
        cuisineTags: restaurant.cuisine_tags,
        allergyFlags: args.allergyFlags,
        dietaryFlags: args.dietaryFlags,
        excludedCuisineIds: args.excludedCuisineIds,
        restaurantId: restaurant.id,
        redemptions: args.redemptions,
        now: args.now,
      }),
    passesVariety: () => true,
    passesRelaxedVariety: () => true,
  }).candidates;
}
