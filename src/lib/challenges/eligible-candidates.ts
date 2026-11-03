import { selectDistancePool } from '@/lib/challenges/distance-pool';
import { offerVersionCoversDeadline } from '@/lib/challenges/challenge-deadline';
import {
  redemptionCooldownOk,
  type CooldownCutoffCache,
  type CooldownRedemption,
} from '@/lib/challenges/restaurant-safety';
import { restaurantHasExcludedCuisine } from '@/lib/cuisines';
import { getDietaryConflict, hasAllergyConflict } from '@/lib/dietary-utils';
import { haversineMiles, toGeoPoint, type DistanceMatch, type GeoPoint } from '@/lib/launch-market';
import { meetsMinimumCreditBase } from '@/lib/offers/credit-floor';
import { restaurantBaseCents, type LegacyOfferRow } from '@/lib/offers/restaurant-base-cents';
import { lowestSealedBase } from '@/lib/offers/sealed-base';
import {
  passesVersionCapacityPrefilter,
  versionSelectable,
  type VersionCapacityFields,
} from '@/lib/offers/version-capacity';
import type { Json } from '@/types/database.types';

/**
 * Shared hard-filter list for monthly generate, swap, and carried assign.
 * Callers still commit through the existing RPCs. This module never reserves capacity.
 */
export const ELIGIBILITY_REJECTION_REASONS = [
  'no_offer_version',
  'capacity',
  'cooldown',
  'exclusion',
  'distance',
  'credit_floor',
  'duplicate',
] as const;

export type EligibilityRejectionReason = (typeof ELIGIBILITY_REJECTION_REASONS)[number];

export type EligibilityRejections = Record<EligibilityRejectionReason, number>;

export type ChallengeEligibilityMode = 'monthly' | 'credit_swap' | 'legacy_swap' | 'carried';

export type EligibilityLegacyOffer = LegacyOfferRow & {
  max_redemptions_per_month: number;
};

export type EligibilityVersion = {
  id: string;
  restaurant_id: string;
  valid_from: string;
  valid_until: string;
  withdrawn_from_selection_at: string | null;
  tiers: Json;
  capacity_timezone?: string;
  capacity_max_redemptions?: number;
};

export type EligibilityRestaurant = {
  id: string;
  name?: string;
  cuisine_tags: string[] | null;
  lat: number | null;
  lon: number | null;
  current_offer_version_id?: string | null;
};

export type EligibleChallengeCandidate<T extends EligibilityRestaurant> = {
  restaurant: T;
  restaurantId: string;
  offerVersionId: string | null;
  baseSavingsCents: number;
  minSpendCents: number;
  deadlineCovered: boolean;
  /** `requested` when the ZIP-centroid miles are inside the member's band. */
  distanceTier: 'requested' | 'expanded';
  /** True when the chosen pool used the one-band ZIP-distance expansion. */
  zipDistanceExpanded: boolean;
};

export type EligibleCandidateList<T extends EligibilityRestaurant> = {
  candidates: EligibleChallengeCandidate<T>[];
  rejections: EligibilityRejections;
  distance: DistanceMatch;
};

export type ChallengeEligibilityContext = {
  mode: ChallengeEligibilityMode;
  versionsById: ReadonlyMap<string, EligibilityVersion>;
  legacyOffersByRestaurant?: ReadonlyMap<string, EligibilityLegacyOffer>;
  now: Date;
  deadline: Date;
  allergyFlags: string[] | null;
  dietaryFlags: string[] | null;
  excludedCuisineIds: readonly string[];
  redemptions: readonly CooldownRedemption[];
  swappedOutRestaurantIds?: ReadonlySet<string>;
  legacyMonthCounts?: ReadonlyMap<string, number>;
  capacityCountsByRestaurant?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  cutoffCache?: CooldownCutoffCache;
};

const EMPTY_COUNTS: ReadonlyMap<string, number> = new Map();

export function emptyEligibilityRejections(): EligibilityRejections {
  return {
    no_offer_version: 0,
    capacity: 0,
    cooldown: 0,
    exclusion: 0,
    distance: 0,
    credit_floor: 0,
    duplicate: 0,
  };
}

function versionIdOf(restaurant: EligibilityRestaurant): string | null {
  return restaurant.current_offer_version_id ?? null;
}

function versionFor(
  restaurant: EligibilityRestaurant,
  versionsById: ReadonlyMap<string, EligibilityVersion>,
): EligibilityVersion | null {
  const versionId = versionIdOf(restaurant);
  if (!versionId) return null;
  return versionsById.get(versionId) ?? null;
}

function hasCapacityFields(
  version: EligibilityVersion,
): version is EligibilityVersion & VersionCapacityFields {
  return (
    typeof version.capacity_timezone === 'string' &&
    version.capacity_timezone.length > 0 &&
    typeof version.capacity_max_redemptions === 'number'
  );
}

function offerTerms(
  restaurant: EligibilityRestaurant,
  version: EligibilityVersion | null,
  legacy: EligibilityLegacyOffer | null,
): { discount_amount_cents: number; min_spend_cents: number } {
  if (versionIdOf(restaurant) && version) {
    const sealed = lowestSealedBase(version.tiers);
    if (sealed) return sealed;
  }
  if (legacy) {
    return {
      discount_amount_cents: legacy.discount_amount_cents ?? 0,
      min_spend_cents: legacy.min_spend_cents ?? 0,
    };
  }
  return { discount_amount_cents: 0, min_spend_cents: 0 };
}

function memberRejection(
  restaurant: EligibilityRestaurant,
  ctx: ChallengeEligibilityContext,
): EligibilityRejectionReason | null {
  if (ctx.mode === 'monthly' && ctx.swappedOutRestaurantIds?.has(restaurant.id)) {
    return 'exclusion';
  }
  if (getDietaryConflict(restaurant.cuisine_tags, ctx.dietaryFlags)) return 'exclusion';
  if (hasAllergyConflict(restaurant.cuisine_tags, ctx.allergyFlags)) return 'exclusion';
  if (
    restaurantHasExcludedCuisine({
      restaurantCuisineTags: restaurant.cuisine_tags,
      excludedCuisineIds: [...ctx.excludedCuisineIds],
    })
  ) {
    return 'exclusion';
  }
  if (
    !redemptionCooldownOk(restaurant.id, [...ctx.redemptions], ctx.now, ctx.cutoffCache)
  ) {
    return 'cooldown';
  }
  return null;
}

/**
 * First hard-rule failure, excluding distance. Null means the restaurant may
 * enter the ZIP-distance pool. Cooldown stays in `restaurant-safety.ts`.
 */
export function challengeCandidateRejection(
  restaurant: EligibilityRestaurant,
  ctx: ChallengeEligibilityContext,
): EligibilityRejectionReason | null {
  const versionId = versionIdOf(restaurant);
  const version = versionFor(restaurant, ctx.versionsById);
  const legacy = ctx.legacyOffersByRestaurant?.get(restaurant.id) ?? null;
  const versionBound = Boolean(versionId);

  if (ctx.mode === 'credit_swap' || ctx.mode === 'carried') {
    if (!versionId || !version || version.restaurant_id !== restaurant.id) return 'no_offer_version';
    if (!offerVersionCoversDeadline(version, ctx.now, ctx.deadline)) return 'no_offer_version';
  } else if (!versionBound && !legacy) {
    return 'no_offer_version';
  } else if (ctx.mode === 'monthly' && versionBound) {
    if (!version || !hasCapacityFields(version)) return 'no_offer_version';
    if (
      !versionSelectable(version, ctx.now, {
        id: restaurant.id,
        current_offer_version_id: versionId,
      })
    ) {
      return 'no_offer_version';
    }
  }

  if (ctx.mode === 'monthly' || ctx.mode === 'credit_swap' || ctx.mode === 'carried') {
    const base = restaurantBaseCents({
      currentOfferVersionId: versionId,
      versionTiers: version?.tiers ?? null,
      legacyOffer: ctx.mode === 'monthly' ? legacy : null,
    });
    if (!meetsMinimumCreditBase(base)) return 'credit_floor';
  }

  if (ctx.mode === 'monthly' && versionBound && version && hasCapacityFields(version)) {
    const open = passesVersionCapacityPrefilter({
      restaurantId: restaurant.id,
      currentOfferVersionId: versionId,
      version,
      now: ctx.now,
      countsByBucket: ctx.capacityCountsByRestaurant?.get(restaurant.id) ?? EMPTY_COUNTS,
    });
    if (!open) return 'capacity';
  }

  if ((ctx.mode === 'monthly' || ctx.mode === 'legacy_swap') && !versionBound && legacy) {
    const monthCount = ctx.legacyMonthCounts?.get(restaurant.id) ?? 0;
    if (monthCount >= legacy.max_redemptions_per_month) return 'capacity';
  }

  return memberRejection(restaurant, ctx);
}

function deadlineCovered(
  restaurant: EligibilityRestaurant,
  version: EligibilityVersion | null,
  ctx: ChallengeEligibilityContext,
): boolean {
  const versionId = versionIdOf(restaurant);
  if (!versionId) return true;
  if (!version || version.restaurant_id !== restaurant.id) return false;
  if (ctx.mode === 'monthly') {
    return versionSelectable(version, ctx.now, {
      id: restaurant.id,
      current_offer_version_id: versionId,
    });
  }
  return offerVersionCoversDeadline(version, ctx.now, ctx.deadline);
}

/**
 * Ordered eligible candidates and per-rule rejection counts.
 * The candidate array is the distance-pool tier callers already pick from.
 * A client-supplied id list is not an input.
 */
export function listEligibleChallengeCandidates<T extends EligibilityRestaurant>(args: {
  context: ChallengeEligibilityContext;
  restaurants: readonly T[];
  origin: GeoPoint;
  requestedMiles: number;
  requiredCount: number;
  duplicateRestaurantIds?: ReadonlySet<string>;
  passesVariety?: (restaurant: T) => boolean;
  passesRelaxedVariety?: (restaurant: T) => boolean;
}): EligibleCandidateList<T> {
  const rejections = emptyEligibilityRejections();
  const hard: T[] = [];
  for (const restaurant of args.restaurants) {
    if (args.duplicateRestaurantIds?.has(restaurant.id)) {
      rejections.duplicate += 1;
      continue;
    }
    const reason = challengeCandidateRejection(restaurant, args.context);
    if (reason) {
      rejections[reason] += 1;
      continue;
    }
    hard.push(restaurant);
  }

  const pool = selectDistancePool({
    restaurants: hard,
    origin: args.origin,
    requestedMiles: args.requestedMiles,
    requiredCount: args.requiredCount,
    passesHard: () => true,
    passesVariety: args.passesVariety ?? (() => true),
    passesRelaxedVariety: args.passesRelaxedVariety ?? (() => true),
  });

  const selected = new Set(pool.candidates.map((restaurant) => restaurant.id));
  for (const restaurant of hard) {
    if (selected.has(restaurant.id)) continue;
    const point = toGeoPoint(restaurant.lat, restaurant.lon);
    const miles = point ? haversineMiles(args.origin, point) : Number.POSITIVE_INFINITY;
    if (miles > pool.match.usedMiles) rejections.distance += 1;
  }

  const candidates = pool.candidates.map((restaurant) => {
    const version = versionFor(restaurant, args.context.versionsById);
    const legacy = args.context.legacyOffersByRestaurant?.get(restaurant.id) ?? null;
    const terms = offerTerms(restaurant, version, legacy);
    const point = toGeoPoint(restaurant.lat, restaurant.lon);
    const insideRequested =
      point != null && haversineMiles(args.origin, point) <= args.requestedMiles;
    return {
      restaurant,
      restaurantId: restaurant.id,
      offerVersionId: versionIdOf(restaurant),
      baseSavingsCents: terms.discount_amount_cents,
      minSpendCents: terms.min_spend_cents,
      deadlineCovered: deadlineCovered(restaurant, version, args.context),
      distanceTier: insideRequested ? ('requested' as const) : ('expanded' as const),
      zipDistanceExpanded: pool.match.expanded,
    };
  });

  return { candidates, rejections, distance: pool.match };
}

/**
 * Use the shared list when it is the same ordered pick the caller already
 * computed. Otherwise keep that caller's rows so a classifier mismatch
 * cannot change the restaurant that reaches the RPC.
 */
export function candidateRowsForPick<T extends { id: string }>(
  serviceRows: readonly T[],
  legacyRows: readonly T[],
): T[] {
  const same =
    serviceRows.length === legacyRows.length &&
    serviceRows.every((row, index) => row.id === legacyRows[index]?.id);
  return same ? [...serviceRows] : [...legacyRows];
}
