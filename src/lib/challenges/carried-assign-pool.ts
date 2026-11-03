import { listEligibleChallengeCandidates } from '@/lib/challenges/eligible-candidates';
import type { CooldownRedemption } from '@/lib/challenges/restaurant-safety';
import type { GeoPoint } from '@/lib/launch-market';
import type { Json } from '@/types/database.types';

import { MINIMUM_CREDIT_BASE_CENTS } from '@/lib/offers/credit-floor';

export const CARRIED_ASSIGN_FLOOR_CENTS = MINIMUM_CREDIT_BASE_CENTS;

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
  const listed = listEligibleChallengeCandidates({
    context: {
      mode: 'carried',
      versionsById: args.versionsById,
      now: args.now,
      deadline: args.deadline,
      allergyFlags: args.allergyFlags,
      dietaryFlags: args.dietaryFlags,
      excludedCuisineIds: args.excludedCuisineIds,
      redemptions: args.redemptions,
    },
    restaurants: args.restaurants,
    origin: args.origin,
    requestedMiles: args.requestedMiles,
    requiredCount: 1,
  });
  return listed.candidates.map((candidate) => ({
    ...candidate.restaurant,
    discount_amount_cents: candidate.baseSavingsCents,
    min_spend_cents: candidate.minSpendCents,
  }));
}
