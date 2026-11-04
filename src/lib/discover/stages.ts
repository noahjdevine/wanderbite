import { cuisineIdsFromRestaurantTags, cuisineLabel, isCuisineId, type CuisineId } from '@/lib/cuisines';
import type { Constraint, DiscoverFood, PartnerLite } from '@/lib/discover/events';
import { restaurantDisplayImageUrl } from '@/lib/restaurant-image';
import { isRouletteDietaryFlag, type RouletteDietaryFlag } from '@/lib/roulette-dietary';
import { ROULETTE_PRICE_OPTIONS, type RoulettePriceRange } from '@/lib/roulette-options';

export type DiscoverRestaurant = {
  id: string;
  name: string;
  cuisine_tags: string[] | null;
  neighborhood: string | null;
  address: string | null;
  price_range: string | null;
  image_url: string | null;
  google_place_id: string | null;
  is_dairy_free?: boolean | null;
  is_vegan?: boolean | null;
  is_halal?: boolean | null;
  status?: string | null;
};

const DIETARY_LABELS: Record<RouletteDietaryFlag, string> = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  gluten_free: 'Gluten-Free',
  halal: 'Halal',
  kosher: 'Kosher',
  dairy_free: 'Dairy-Free',
  pescatarian: 'Pescatarian',
};

const OCCASION_VIBES = new Set(['Date Night', 'Special Occasion']);

const UNKNOWN_LISTING = "Can't confirm that from the partner listing";
const UNKNOWN_HOURS = 'Hours are not checked for this pick';
const UNKNOWN_PRICE = 'No price is listed';

/**
 * Rows the directory query already limits to `status = active` omit `status` in tests.
 * A present status other than `active` (paused, hidden, test) is not a partner.
 */
export function isDiscoverListedRestaurant(status: string | null | undefined): boolean {
  if (status == null) return true;
  return status === 'active';
}

export function listedDiscoverRestaurants<T extends { status?: string | null }>(
  rows: readonly T[],
): T[] {
  return rows.filter((row) => isDiscoverListedRestaurant(row.status));
}

export function dietaryConstraintLabel(flag: RouletteDietaryFlag): string {
  return DIETARY_LABELS[flag];
}

export function constraintsFromDiscoveryInput(args: {
  dietary: readonly string[];
  vibe?: string;
  timeOfDay?: string;
  priceRange?: string;
  preferredCuisine?: string;
}): Constraint[] {
  const constraints: Constraint[] = [];
  for (const flag of args.dietary) {
    if (!isRouletteDietaryFlag(flag)) continue;
    constraints.push({
      key: 'dietary',
      label: dietaryConstraintLabel(flag),
      required: true,
    });
  }
  if (args.vibe) {
    constraints.push({
      key: OCCASION_VIBES.has(args.vibe) ? 'occasion' : 'vibe',
      label: args.vibe,
      required: false,
    });
  }
  if (args.timeOfDay) {
    constraints.push({ key: 'time', label: args.timeOfDay, required: false });
  }
  if (args.priceRange) {
    const option = ROULETTE_PRICE_OPTIONS.find((item) => item.value === args.priceRange);
    constraints.push({
      key: 'budget',
      label: option ? `${option.label} (${option.hint})` : args.priceRange,
      required: false,
    });
  }
  if (args.preferredCuisine && isCuisineId(args.preferredCuisine)) {
    constraints.push({
      key: 'cuisine',
      label: cuisineLabel(args.preferredCuisine),
      required: false,
    });
  }
  return constraints;
}

export function partnerCuisineLabel(tags: string[] | null | undefined): string | undefined {
  const ids = cuisineIdsFromRestaurantTags(tags);
  if (ids[0]) return cuisineLabel(ids[0]);
  const raw = (tags ?? []).map((tag) => tag.trim()).find(Boolean);
  return raw || undefined;
}

export function toPartnerLite(row: DiscoverRestaurant): PartnerLite {
  const partner: PartnerLite = {
    id: row.id,
    name: row.name,
    photoUrl: restaurantDisplayImageUrl(row),
  };
  const cuisine = partnerCuisineLabel(row.cuisine_tags);
  if (cuisine) partner.cuisine = cuisine;
  const neighborhood = row.neighborhood?.trim();
  if (neighborhood) partner.neighborhood = neighborhood;
  return partner;
}

export const FILTER_SAMPLE_LIMIT = 3;

export function filterSample(rows: readonly DiscoverRestaurant[]): PartnerLite[] {
  return rows.slice(0, FILTER_SAMPLE_LIMIT).map((row) => toPartnerLite(row));
}

export function filterDetail(args: {
  dietary: readonly string[];
  excludedCuisineIds: readonly string[];
}): string {
  const dietary = args.dietary
    .filter((flag): flag is RouletteDietaryFlag => isRouletteDietaryFlag(flag))
    .map((flag) => dietaryConstraintLabel(flag));
  const excluded = args.excludedCuisineIds
    .filter((id): id is CuisineId => isCuisineId(id))
    .map((id) => cuisineLabel(id));
  const parts: string[] = [];
  if (dietary.length > 0) parts.push(`Keeping partners that match ${dietary.join(', ')}`);
  if (excluded.length > 0) parts.push(`Skipping ${excluded.join(', ')}`);
  if (parts.length === 0) return 'Active partners in the launch market';
  return parts.join('. ');
}

const FOOD_RULES: readonly { food: DiscoverFood; pattern: RegExp }[] = [
  { food: 'dumpling', pattern: /\b(dumplings?|noodles?|gyoza|dim sum|chinese)\b/i },
  { food: 'sushi', pattern: /\b(sushi|sashimi|japanese|izakaya|yakitori)\b/i },
  { food: 'pizza', pattern: /\b(pizzas?|pizzeria)\b/i },
  { food: 'taco', pattern: /\b(tacos?|taqueria|mexican|tex-mex|tex mex)\b/i },
  { food: 'burger', pattern: /\bburgers?\b/i },
  { food: 'bbq', pattern: /\b(bbq|barbecue|barbeque)\b/i },
];

const CUISINE_FOOD: Partial<Record<CuisineId, DiscoverFood>> = {
  japanese: 'sushi',
  chinese: 'dumpling',
  mexican: 'taco',
  tex_mex: 'taco',
  pizza: 'pizza',
};

/**
 * Avatar food from the ask. Message keywords win, then a preferred-cuisine chip.
 * Anything else is `generic` (noodles and Chinese map to `dumpling`).
 */
export function foodFromParsedCuisine(args: {
  message: string;
  preferredCuisine?: string | null;
  constraintLabels?: readonly string[];
}): DiscoverFood {
  const text = [args.message, ...(args.constraintLabels ?? [])].join('\n');
  for (const rule of FOOD_RULES) {
    if (rule.pattern.test(text)) return rule.food;
  }
  if (args.preferredCuisine && isCuisineId(args.preferredCuisine)) {
    return CUISINE_FOOD[args.preferredCuisine] ?? 'generic';
  }
  return 'generic';
}

export function restaurantMatchesPreferredCuisine(
  tags: string[] | null | undefined,
  cuisineId: string | undefined,
): boolean {
  if (!cuisineId || !isCuisineId(cuisineId)) return false;
  return cuisineIdsFromRestaurantTags(tags).includes(cuisineId);
}

export function classifyPickConstraints(args: {
  constraints: readonly Constraint[];
  restaurant: DiscoverRestaurant;
  priceRange?: RoulettePriceRange | string;
  preferredCuisine?: string;
}): {
  matched: string[];
  unknown: { label: string; note: string }[];
  unmet: string[];
} {
  const matched: string[] = [];
  const unknown: { label: string; note: string }[] = [];
  const unmet: string[] = [];

  for (const constraint of args.constraints) {
    if (constraint.key === 'dietary') {
      matched.push(constraint.label);
      continue;
    }
    if (constraint.key === 'cuisine') {
      if (restaurantMatchesPreferredCuisine(args.restaurant.cuisine_tags, args.preferredCuisine)) {
        matched.push(constraint.label);
      } else {
        unmet.push(constraint.label);
      }
      continue;
    }
    if (constraint.key === 'budget') {
      const listed = args.restaurant.price_range?.trim() ?? '';
      if (!listed) {
        unknown.push({ label: constraint.label, note: UNKNOWN_PRICE });
      } else if (args.priceRange && listed === args.priceRange) {
        matched.push(constraint.label);
      } else {
        unmet.push(constraint.label);
      }
      continue;
    }
    if (constraint.key === 'time') {
      unknown.push({ label: constraint.label, note: UNKNOWN_HOURS });
      continue;
    }
    unknown.push({ label: constraint.label, note: UNKNOWN_LISTING });
  }

  return { matched, unknown, unmet };
}
