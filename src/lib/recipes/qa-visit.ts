import { challengeCandidateRejection } from '@/lib/challenges/eligible-candidates';
import type {
  ChallengeEligibilityContext,
  EligibilityRejectionReason,
  EligibilityRestaurant,
  EligibilityVersion,
} from '@/lib/challenges/eligible-candidates';
import {
  passesRestaurantHardFilters,
  redemptionCooldownReason,
  type CooldownRedemption,
} from '@/lib/challenges/restaurant-safety';
import { formatCents, lowestSealedBase } from '@/lib/offers/sealed-base';
import type { Json } from '@/types/database.types';

export type VisitCatalogRestaurant = EligibilityRestaurant & {
  name: string;
  neighborhood: string | null;
  address: string | null;
  description: string | null;
  price_range: string | null;
  is_dairy_free: boolean;
  is_vegan: boolean;
  is_halal: boolean;
};

const REJECTION_TEXT: Record<EligibilityRejectionReason, string> = {
  no_offer_version: 'no selectable offer version',
  capacity: 'version capacity',
  cooldown: 'a redemption cooldown',
  exclusion: 'a dietary, allergy, or cuisine exclusion',
  distance: 'distance',
  credit_floor: 'the credit floor',
  duplicate: 'a duplicate',
  variety: 'variety',
};

function catalogLines(restaurant: VisitCatalogRestaurant): string[] {
  const lines = [`Name: ${restaurant.name}.`];
  lines.push(
    restaurant.neighborhood
      ? `Area: ${restaurant.neighborhood}.`
      : 'Area: not in the catalog.',
  );
  const cuisines = (restaurant.cuisine_tags ?? []).map((tag) => tag.trim()).filter(Boolean);
  lines.push(cuisines.length > 0 ? `Cuisine: ${cuisines.join(', ')}.` : 'Cuisine: not in the catalog.');
  if (restaurant.address) lines.push(`Address: ${restaurant.address}.`);
  if (restaurant.price_range) lines.push(`Listed price range: ${restaurant.price_range}.`);
  if (restaurant.description) lines.push(`Catalog description: ${restaurant.description}.`);
  const marks = [
    restaurant.is_vegan ? 'vegan' : null,
    restaurant.is_dairy_free ? 'dairy-free' : null,
    restaurant.is_halal ? 'halal' : null,
  ].filter((mark): mark is string => Boolean(mark));
  if (marks.length > 0) lines.push(`Catalog accommodation marks: ${marks.join(', ')}.`);
  lines.push('Hours are not in the catalog. Confirm hours with the restaurant.');
  lines.push('These catalog facts may be out of date.');
  return lines;
}

export function visitLinesFromLookup(args: {
  restaurant: VisitCatalogRestaurant | null;
  version: EligibilityVersion | null;
  redemptions: readonly CooldownRedemption[];
  dietaryFlags: string[] | null;
  allergyFlags: string[] | null;
  excludedCuisineIds: readonly string[];
  capacityCounts?: ReadonlyMap<string, number>;
  now: Date;
  confirmed: boolean;
}): string[] {
  if (!args.restaurant) {
    return [
      'No matching restaurant is in the catalog.',
      'Hours are not in the catalog. Confirm hours with the restaurant.',
      'These catalog facts may be out of date.',
      'Offer terms were not read from the catalog.',
    ];
  }

  const lines = catalogLines(args.restaurant);
  const cooldown = redemptionCooldownReason(args.restaurant.id, [...args.redemptions], args.now);
  const hardPass = passesRestaurantHardFilters({
    cuisineTags: args.restaurant.cuisine_tags,
    allergyFlags: args.allergyFlags,
    dietaryFlags: args.dietaryFlags,
    excludedCuisineIds: [...args.excludedCuisineIds],
    restaurantId: args.restaurant.id,
    redemptions: [...args.redemptions],
    now: args.now,
  });

  if (!args.confirmed || !args.version) {
    lines.push(
      'Offer eligibility was not confirmed from the shared candidate check. Terms are not guessed.',
    );
    if (cooldown) {
      lines.push('A redemption cooldown from restaurant safety applies to this restaurant.');
    } else if (!hardPass) {
      lines.push('Restaurant safety excludes this restaurant for the signed-in member.');
    }
    lines.push('This check does not assign a credit, challenge, or visit.');
    return lines;
  }

  const deadline = new Date(args.now.getTime() + 840 * 60 * 60 * 1000);
  const context: ChallengeEligibilityContext = {
    mode: 'monthly',
    versionsById: new Map([[args.version.id, args.version]]),
    now: args.now,
    deadline,
    allergyFlags: args.allergyFlags,
    dietaryFlags: args.dietaryFlags,
    excludedCuisineIds: args.excludedCuisineIds,
    redemptions: args.redemptions,
    capacityCountsByRestaurant: new Map([
      [args.restaurant.id, args.capacityCounts ?? new Map<string, number>()],
    ]),
  };
  const rejection = challengeCandidateRejection(args.restaurant, context);
  const sealed = lowestSealedBase(args.version.tiers as Json);
  if (rejection) {
    lines.push(
      `The shared candidate check excludes this restaurant (${REJECTION_TEXT[rejection]}).`,
    );
  } else {
    lines.push('The shared candidate hard rules include this restaurant.');
  }
  if (sealed) {
    lines.push(
      `The sealed offer lists ${formatCents(sealed.discount_amount_cents)} off a ${formatCents(sealed.min_spend_cents)} spend.`,
    );
  } else {
    lines.push('The sealed offer has no readable lowest tier.');
  }
  if (cooldown) {
    lines.push('A redemption cooldown from restaurant safety applies to this restaurant.');
  }
  if (!hardPass) {
    lines.push('Restaurant safety excludes this restaurant for the signed-in member.');
  }
  lines.push('This check does not assign a credit, challenge, or visit.');
  return lines;
}
