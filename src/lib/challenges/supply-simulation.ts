import { chicagoMonthStart } from '@/lib/cron-period';
import { selectDistancePool } from '@/lib/challenges/distance-pool';
import {
  applyRollover,
  assignLinkedRestaurant,
  bucketsHaveCapacity,
  bucketsIntersectingDeadline,
  capacityCounts,
  carriedAssignDeadline,
  completeCredit,
  createLedger,
  creditIsCarried,
  issueTwoCredits,
  plusAssignmentHours,
  resetSupplyIds,
  simulatedMonthNow,
  snapshotLedger,
  swapLinkedCredit,
  tierExpiresAt,
  type RolloverApplyResult,
  type SimCredit,
  type SupplyLedger,
} from '@/lib/challenges/supply-simulation-lifecycle';
import { getDietaryConflict, hasAllergyConflict } from '@/lib/dietary-utils';
import { restaurantHasExcludedCuisine } from '@/lib/cuisines';
import {
  haversineMiles,
  milesForDistanceBand,
  originFromZip,
} from '@/lib/launch-market';
import type { DistanceBand } from '@/lib/onboarding-shared';
import { pairSavingsModel, type OfferTier } from '@/lib/offers/calculator';
import { lowestSealedBase } from '@/lib/offers/sealed-base';
import {
  passesRestaurantHardFilters,
  redemptionCooldownOk,
  type CooldownRedemption,
} from '@/lib/challenges/restaurant-safety';

export const SUPPLY_MARKET_ID = 'e2ss0000-0000-4000-8000-00000000b001';
export const SUPPLY_OTHER_MARKET_ID = 'e2ss0000-0000-4000-8000-00000000b002';

const EARTH_RADIUS_MILES = 3958.7613;
const originPoint = originFromZip('75069');
if (!originPoint) throw new Error('75069 origin missing');
const ORIGIN = originPoint;

function northOfOrigin(miles: number): { lat: number; lon: number } {
  const dLat = (miles / EARTH_RADIUS_MILES) * (180 / Math.PI);
  return { lat: ORIGIN.lat + dLat, lon: ORIGIN.lon };
}

const INSIDE = northOfOrigin(0);
const FAR = northOfOrigin(8);
const BEYOND = northOfOrigin(20);

export type SupplyRestaurant = {
  key: string;
  id: string;
  versionId: string;
  marketId: string;
  lat: number;
  lon: number;
  cuisineTags: string[];
  discountCents: number;
  thresholdCents: number;
  capacityMaxRedemptions: number;
};

function ids(n: number): { id: string; versionId: string } {
  const head = n.toString(16).padStart(4, '0');
  return {
    id: `e2ss${head}-0000-4000-8000-000000000001`,
    versionId: `e2ss${head}-0000-4000-8000-000000000002`,
  };
}

type Place = 'inside' | 'far' | 'beyond';

function restaurant(
  n: number,
  key: string,
  discountCents: number,
  thresholdCents: number,
  cuisineTags: string[],
  place: Place,
  marketId: string,
  capacityMaxRedemptions = 50,
): SupplyRestaurant {
  const point = place === 'far' ? FAR : place === 'beyond' ? BEYOND : INSIDE;
  return {
    key,
    ...ids(n),
    marketId,
    lat: point.lat,
    lon: point.lon,
    cuisineTags,
    discountCents,
    thresholdCents,
    capacityMaxRedemptions,
  };
}

const success = Array.from({ length: 12 }, (_, index) =>
  restaurant(
    index + 1,
    `S${String(index + 1).padStart(2, '0')}`,
    1000,
    4000,
    ['salad'],
    'inside',
    SUPPLY_MARKET_ID,
  ),
);

export const SUPPLY_RESTAURANTS: SupplyRestaurant[] = [
  ...success,
  restaurant(13, 'U1', 900, 2000, ['salad'], 'inside', SUPPLY_MARKET_ID),
  restaurant(14, 'U2', 900, 2000, ['salad'], 'inside', SUPPLY_MARKET_ID),
  restaurant(15, 'L1999', 1999, 4000, ['soup'], 'inside', SUPPLY_MARKET_ID),
  restaurant(16, 'C2000', 2000, 4000, ['grill'], 'inside', SUPPLY_MARKET_ID),
  restaurant(17, 'C2500', 2500, 4000, ['seafood'], 'inside', SUPPLY_MARKET_ID),
  restaurant(18, 'cheese', 2000, 2000, ['cheese'], 'inside', SUPPLY_MARKET_ID),
  restaurant(19, 'peanut', 2000, 2000, ['peanut'], 'inside', SUPPLY_MARKET_ID),
  restaurant(20, 'pasta', 2000, 2000, ['pasta'], 'inside', SUPPLY_MARKET_ID),
  restaurant(21, 'other', 2000, 2000, ['salad'], 'inside', SUPPLY_OTHER_MARKET_ID),
  restaurant(22, 'beyond', 2000, 2000, ['salad'], 'beyond', SUPPLY_MARKET_ID),
  restaurant(23, 'cap', 2000, 4000, ['grill'], 'inside', SUPPLY_MARKET_ID, 1),
  restaurant(24, 'swap', 1000, 4000, ['seafood'], 'inside', SUPPLY_MARKET_ID),
  restaurant(25, 'cooldown', 2000, 2000, ['salad'], 'inside', SUPPLY_MARKET_ID),
  restaurant(26, 'OB1', 1000, 5000, ['salad'], 'inside', SUPPLY_MARKET_ID),
  restaurant(27, 'OB2', 1000, 5000, ['salad'], 'inside', SUPPLY_MARKET_ID),
  restaurant(28, 'Far1', 1000, 4000, ['salad'], 'far', SUPPLY_MARKET_ID),
  restaurant(29, 'Far2', 1000, 4000, ['salad'], 'far', SUPPLY_MARKET_ID),
];

const byKey = new Map(SUPPLY_RESTAURANTS.map((row) => [row.key, row]));

export function supplyRestaurant(key: string): SupplyRestaurant {
  const row = byKey.get(key);
  if (!row) throw new Error(`missing supply restaurant ${key}`);
  return row;
}

export type SupplyRejectionReason =
  | 'dietary_exclusion'
  | 'allergy'
  | 'excluded_cuisine'
  | 'cooldown'
  | 'outside_market'
  | 'outside_distance'
  | 'spending_ceiling'
  | 'pair_below_floor'
  | 'below_floor'
  | 'capacity_full';

export type SupplyRejection = {
  scope: string;
  subject: string;
  reason: SupplyRejectionReason;
};

export type CompletionPolicy = 'verify_on_assign' | 'leave_linked';

export type SupplySimulationConfig = {
  name: string;
  zip: '75069';
  distanceBand: DistanceBand;
  maxQualifyingSpendCents: number;
  dietaryFlags: string[];
  allergyFlags: string[];
  excludedCuisineIds: string[];
  marketId: string;
  completionPolicy: CompletionPolicy;
  ks: number[];
  skipPairAssignKs: number[];
  autoCarried: boolean;
  carriedAssigns: Array<{
    k: number;
    credits: Array<{
      issueK: number;
      slot: 1 | 2;
      restaurantKey: string;
      completionPolicy?: CompletionPolicy;
    }>;
  }>;
  swaps: Array<{ k: number; slot: 1 | 2; replacementKey: string }>;
  secondSwap: boolean;
  catalogKeys?: string[];
};

const MEMBER_FLAGS = {
  dietaryFlags: ['vegan'],
  allergyFlags: ['peanut'],
  excludedCuisineIds: ['italian'],
} as const;

function baseConfig(name: string, patch: Partial<SupplySimulationConfig>): SupplySimulationConfig {
  return {
    name,
    zip: '75069',
    distanceBand: '5_mi',
    maxQualifyingSpendCents: 4000,
    dietaryFlags: [...MEMBER_FLAGS.dietaryFlags],
    allergyFlags: [...MEMBER_FLAGS.allergyFlags],
    excludedCuisineIds: [...MEMBER_FLAGS.excludedCuisineIds],
    marketId: SUPPLY_MARKET_ID,
    completionPolicy: 'verify_on_assign',
    ks: [5, 4, 3, 2, 1, 0],
    skipPairAssignKs: [],
    autoCarried: false,
    carriedAssigns: [],
    swaps: [],
    secondSwap: false,
    ...patch,
  };
}

export const COVERAGE_CONFIG = baseConfig('coverage', {
  swaps: [{ k: 0, slot: 2, replacementKey: 'swap' }],
  secondSwap: true,
});

export const TIGHT_CEILING_CONFIG = baseConfig('tight_ceiling', {
  maxQualifyingSpendCents: 3999,
  completionPolicy: 'leave_linked',
  ks: [0],
});

export const THIN_CATALOG_CONFIG = baseConfig('thin_catalog', {
  maxQualifyingSpendCents: 3999,
  completionPolicy: 'leave_linked',
  autoCarried: true,
});

export const CEILING_EXPANSION_CONFIG = baseConfig('ceiling_expansion', {
  ks: [0],
  catalogKeys: ['OB1', 'OB2', 'Far1', 'Far2', 'beyond'],
});

export const NAMED_SUPPLY_CONFIGS = {
  coverage: COVERAGE_CONFIG,
  tight_ceiling: TIGHT_CEILING_CONFIG,
  thin_catalog: THIN_CATALOG_CONFIG,
  ceiling_expansion: CEILING_EXPANSION_CONFIG,
} as const;

export type SupplyMonthTrace = {
  k: number;
  monthNow: string;
  chicagoMonth: string;
  requestedMiles: number | null;
  usedMiles: number | null;
  expanded: boolean | null;
  pairKeys: [string, string] | null;
  rollover: RolloverApplyResult | null;
  swapOutcomes: string[];
};

export type CapacityLine = {
  source: 'model' | 'rpc';
  restaurantId: string;
  restaurantKey: string;
  bucketStart: string;
  reserved: number;
  consumed: number;
  released: number;
  used: number;
  capacityMax: number;
  utilization: number;
};

export type SupplyModelResult = {
  config: SupplySimulationConfig;
  ledger: SupplyLedger;
  months: SupplyMonthTrace[];
  rejections: SupplyRejection[];
  requestedMiles: number;
  usedMiles: number;
  expanded: boolean;
  numerator: number;
  denominator: number;
  spendCents: number;
  capacity: CapacityLine[];
  carryCapExceeded: boolean;
  pairSavings: {
    label: 'model input';
    baseCents: number;
    qualifyingSpendCents: number;
  } | null;
};

export type CarryCapSnapshot = {
  vLinked: number;
  p1Extended: number;
  p1Expired: number;
  outcome: string;
  carryCapExceeded: boolean;
  p0Assigned: number;
  numerator: number;
  denominator: number;
};

export type CarryPressureResult = {
  leaveLinked: SupplyModelResult;
  verifyControl: SupplyModelResult;
  leaveSnapshot: CarryCapSnapshot;
  verifySnapshot: CarryCapSnapshot;
};

export function selectorReason(args: {
  restaurant: Pick<SupplyRestaurant, 'marketId' | 'cuisineTags' | 'id' | 'thresholdCents' | 'discountCents'>;
  marketId: string;
  dietaryFlags: string[];
  allergyFlags: string[];
  excludedCuisineIds: string[];
  redemptions: CooldownRedemption[];
  now: Date;
  maxQualifyingSpendCents: number;
}): SupplyRejectionReason | null {
  if (args.restaurant.marketId !== args.marketId) return 'outside_market';
  if (getDietaryConflict(args.restaurant.cuisineTags, args.dietaryFlags)) return 'dietary_exclusion';
  if (hasAllergyConflict(args.restaurant.cuisineTags, args.allergyFlags)) return 'allergy';
  if (
    restaurantHasExcludedCuisine({
      restaurantCuisineTags: args.restaurant.cuisineTags,
      excludedCuisineIds: args.excludedCuisineIds,
    })
  ) {
    return 'excluded_cuisine';
  }
  if (!redemptionCooldownOk(args.restaurant.id, args.redemptions, args.now)) return 'cooldown';
  const base = lowestSealedBase([
    { threshold_cents: args.restaurant.thresholdCents, discount_cents: args.restaurant.discountCents },
  ]);
  if (base && base.min_spend_cents > args.maxQualifyingSpendCents) return 'spending_ceiling';
  return null;
}

function remember(
  bag: Map<string, SupplyRejection>,
  scope: string,
  subject: string,
  reason: SupplyRejectionReason,
): void {
  const id = `${scope}\t${subject}\t${reason}`;
  if (!bag.has(id)) bag.set(id, { scope, subject, reason });
}

function tiersOf(restaurant: SupplyRestaurant): OfferTier[] {
  return [{ thresholdCents: restaurant.thresholdCents, discountCents: restaurant.discountCents }];
}

function catalogFor(config: SupplySimulationConfig, catalog: SupplyRestaurant[]): SupplyRestaurant[] {
  if (!config.catalogKeys) return catalog;
  const wanted = new Set(config.catalogKeys);
  return catalog.filter((row) => wanted.has(row.key));
}

function byId(a: SupplyRestaurant, b: SupplyRestaurant): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function modelCapacity(ledger: SupplyLedger, catalog: SupplyRestaurant[]): CapacityLine[] {
  const seen = new Map<string, { restaurantId: string; bucketStart: string }>();
  for (const row of ledger.reservations) {
    seen.set(`${row.restaurantId}|${row.bucketStart}`, {
      restaurantId: row.restaurantId,
      bucketStart: row.bucketStart,
    });
  }
  const lines: CapacityLine[] = [];
  for (const entry of seen.values()) {
    const restaurant = catalog.find((row) => row.id === entry.restaurantId);
    const counts = capacityCounts(ledger, entry.restaurantId, entry.bucketStart);
    const capacityMax = restaurant?.capacityMaxRedemptions ?? 0;
    lines.push({
      source: 'model',
      restaurantId: entry.restaurantId,
      restaurantKey: restaurant?.key ?? entry.restaurantId,
      bucketStart: entry.bucketStart,
      reserved: counts.reserved,
      consumed: counts.consumed,
      released: counts.released,
      used: counts.used,
      capacityMax,
      utilization: capacityMax === 0 ? 0 : counts.used / capacityMax,
    });
  }
  return lines.sort((a, b) =>
    a.restaurantKey === b.restaurantKey
      ? a.bucketStart < b.bucketStart
        ? -1
        : 1
      : a.restaurantKey < b.restaurantKey
        ? -1
        : 1,
  );
}

function spendOf(ledger: SupplyLedger, catalog: SupplyRestaurant[]): number {
  let sum = 0;
  for (const credit of ledger.credits) {
    if (!credit.challengeItemId) continue;
    const item = ledger.items.find((row) => row.id === credit.challengeItemId);
    const restaurant = catalog.find((row) => row.id === item?.restaurantId);
    if (restaurant) sum += restaurant.thresholdCents;
  }
  return sum;
}

type PoolSelection = {
  candidates: SupplyRestaurant[];
  requestedMiles: number;
  usedMiles: number;
  expanded: boolean;
};

function selectPool(
  config: SupplySimulationConfig,
  rows: SupplyRestaurant[],
  redemptions: CooldownRedemption[],
  now: Date,
  requiredCount: number,
): PoolSelection {
  const origin = originFromZip(config.zip);
  if (!origin) throw new Error('zip origin missing');
  const requestedMiles = milesForDistanceBand(config.distanceBand);
  const pool = selectDistancePool({
    restaurants: rows,
    origin,
    requestedMiles,
    requiredCount,
    passesHard: (restaurant) => {
      const base = lowestSealedBase([
        { threshold_cents: restaurant.thresholdCents, discount_cents: restaurant.discountCents },
      ]);
      if (!base || base.min_spend_cents > config.maxQualifyingSpendCents) return false;
      return passesRestaurantHardFilters({
        cuisineTags: restaurant.cuisineTags,
        allergyFlags: config.allergyFlags,
        dietaryFlags: config.dietaryFlags,
        excludedCuisineIds: config.excludedCuisineIds,
        restaurantId: restaurant.id,
        redemptions,
        now,
      });
    },
    passesVariety: () => true,
    passesRelaxedVariety: () => true,
  });
  return {
    candidates: pool.candidates,
    requestedMiles: pool.match.requestedMiles,
    usedMiles: pool.match.usedMiles,
    expanded: pool.match.expanded,
  };
}

export function runSimulatedSupplyMonths(args: {
  config: SupplySimulationConfig;
  anchorNow: Date;
  catalog?: SupplyRestaurant[];
  onRollover?: (k: number, result: RolloverApplyResult, ledger: SupplyLedger) => void;
}): SupplyModelResult {
  resetSupplyIds();
  const config = args.config;
  const fullCatalog = args.catalog ?? SUPPLY_RESTAURANTS;
  const catalog = catalogFor(config, fullCatalog);
  const ledger = createLedger();
  const cooldown = catalog.find((row) => row.key === 'cooldown');
  if (cooldown) {
    const verifiedAt = simulatedMonthNow(args.anchorNow, 5);
    ledger.redemptions.push({
      restaurant_id: cooldown.id,
      status: 'verified',
      verified_at: verifiedAt.toISOString(),
      created_at: verifiedAt.toISOString(),
      challengeItemId: 'e2ssseed-0000-4000-8000-0000000000c0',
    });
  }
  const bag = new Map<string, SupplyRejection>();
  const months: SupplyMonthTrace[] = [];
  let pairSavings: SupplyModelResult['pairSavings'] = null;

  config.ks.forEach((k, index) => {
    const monthNow = simulatedMonthNow(args.anchorNow, k);
    const chicagoMonth = chicagoMonthStart(monthNow);
    const scope = `sim:${config.name}:${chicagoMonth}`;
    let rollover: RolloverApplyResult | null = null;
    if (index > 0) {
      rollover = applyRollover(ledger, monthNow);
      args.onRollover?.(k, rollover, ledger);
    }
    issueTwoCredits(ledger, monthNow, k);
    const redemptions = ledger.redemptions;
    const rejected = new Set<string>();
    for (const restaurant of catalog) {
      const reason = selectorReason({
        restaurant,
        marketId: config.marketId,
        dietaryFlags: config.dietaryFlags,
        allergyFlags: config.allergyFlags,
        excludedCuisineIds: config.excludedCuisineIds,
        redemptions,
        now: monthNow,
        maxQualifyingSpendCents: config.maxQualifyingSpendCents,
      });
      if (!reason) continue;
      rejected.add(restaurant.id);
      remember(bag, scope, restaurant.id, reason);
    }
    const poolInput = catalog.filter((restaurant) => !rejected.has(restaurant.id));
    const needsCarried =
      config.autoCarried || config.carriedAssigns.some((entry) => entry.k === k);
    const needsPair = !config.skipPairAssignKs.includes(k);
    let pairKeys: [string, string] | null = null;
    let monthMiles: SupplyMonthTrace['requestedMiles'] = null;
    let monthUsed: SupplyMonthTrace['usedMiles'] = null;
    let monthExpanded: boolean | null = null;

    const markDistance = (selection: PoolSelection) => {
      const origin = originFromZip(config.zip);
      if (!origin) return;
      for (const restaurant of poolInput) {
        const miles = haversineMiles(origin, { lat: restaurant.lat, lon: restaurant.lon });
        if (miles > selection.usedMiles) remember(bag, scope, restaurant.id, 'outside_distance');
      }
      monthMiles = selection.requestedMiles;
      monthUsed = selection.usedMiles;
      monthExpanded = selection.expanded;
    };

    if (needsCarried) {
      const carriedPool = selectPool(config, poolInput, redemptions, monthNow, 1);
      if (!needsPair) markDistance(carriedPool);
      const planned = config.carriedAssigns.find((entry) => entry.k === k);
      if (planned) {
        for (const spec of planned.credits) {
          const credit = ledger.credits.find(
            (row) => row.issueK === spec.issueK && row.slot === spec.slot && creditIsCarried(row, monthNow),
          );
          const restaurant = catalog.find((row) => row.key === spec.restaurantKey);
          if (!credit || !restaurant) continue;
          if (!carriedPool.candidates.some((row) => row.id === restaurant.id)) continue;
          const deadline = carriedAssignDeadline(monthNow, credit.expiresAt);
          const buckets = bucketsIntersectingDeadline(monthNow, deadline);
          if (!bucketsHaveCapacity(ledger, restaurant.id, buckets, restaurant.capacityMaxRedemptions)) {
            remember(bag, scope, restaurant.id, 'capacity_full');
            continue;
          }
          const assigned = assignLinkedRestaurant({
            ledger,
            credit,
            restaurantId: restaurant.id,
            assignedAt: monthNow,
            deadline,
            capacityMax: restaurant.capacityMaxRedemptions,
            discountCents: restaurant.discountCents,
            floor: 'carried',
          });
          if (assigned === 'below_floor' || assigned === 'capacity_full') {
            remember(bag, scope, restaurant.id, assigned);
            continue;
          }
          if (assigned === 'duplicate_restaurant') continue;
          completeCredit(
            ledger,
            credit,
            monthNow,
            spec.completionPolicy ?? config.completionPolicy,
          );
        }
      } else if (config.autoCarried) {
        const carriedCredits = ledger.credits.filter((credit) => creditIsCarried(credit, monthNow));
        const sorted = [...carriedPool.candidates].sort(byId);
        for (const credit of carriedCredits) {
          const legal = sorted.find((restaurant) => restaurant.discountCents >= 2000);
          if (!legal) {
            if (sorted[0]) remember(bag, scope, sorted[0].id, 'below_floor');
            continue;
          }
          const deadline = carriedAssignDeadline(monthNow, credit.expiresAt);
          const assigned = assignLinkedRestaurant({
            ledger,
            credit,
            restaurantId: legal.id,
            assignedAt: monthNow,
            deadline,
            capacityMax: legal.capacityMaxRedemptions,
            discountCents: legal.discountCents,
            floor: 'carried',
          });
          if (assigned === 'below_floor' || assigned === 'capacity_full') {
            remember(bag, scope, legal.id, assigned);
          }
          else completeCredit(ledger, credit, monthNow, config.completionPolicy);
        }
      }
    }

    if (needsPair) {
      const pairPool = selectPool(config, poolInput, redemptions, monthNow, 2);
      markDistance(pairPool);
      const ranked = [...pairPool.candidates].sort(byId);
      if (ranked.length >= 2) {
        const [left, right] = [ranked[0], ranked[1]];
        const subject = `${left.id}|${right.id}`;
        if (left.discountCents + right.discountCents < 2000) {
          remember(bag, scope, subject, 'pair_below_floor');
        } else {
          const deadline = plusAssignmentHours(monthNow);
          const leftBuckets = bucketsIntersectingDeadline(monthNow, deadline);
          const rightBuckets = bucketsIntersectingDeadline(monthNow, deadline);
          const leftOk = bucketsHaveCapacity(
            ledger,
            left.id,
            leftBuckets,
            left.capacityMaxRedemptions,
          );
          const rightOk = bucketsHaveCapacity(
            ledger,
            right.id,
            rightBuckets,
            right.capacityMaxRedemptions,
          );
          if (!leftOk || !rightOk) {
            remember(bag, scope, leftOk ? right.id : left.id, 'capacity_full');
          } else {
            const issued = ledger.credits.filter(
              (credit) => credit.issueK === k && credit.status === 'pending',
            );
            const slot1 = issued.find((credit) => credit.slot === 1);
            const slot2 = issued.find((credit) => credit.slot === 2);
            if (slot1 && slot2) {
              const first = assignLinkedRestaurant({
                ledger,
                credit: slot1,
                restaurantId: left.id,
                assignedAt: monthNow,
                deadline,
                capacityMax: left.capacityMaxRedemptions,
                discountCents: left.discountCents,
                floor: 'checked',
              });
              const second = assignLinkedRestaurant({
                ledger,
                credit: slot2,
                restaurantId: right.id,
                assignedAt: monthNow,
                deadline,
                capacityMax: right.capacityMaxRedemptions,
                discountCents: right.discountCents,
                floor: 'checked',
              });
              if (typeof first !== 'string' && typeof second !== 'string') {
                pairKeys = [left.key, right.key];
                if (k === config.ks[config.ks.length - 1] && config.name === 'coverage') {
                  const savings = pairSavingsModel(tiersOf(left), tiersOf(right));
                  pairSavings = {
                    label: 'model input',
                    baseCents: savings.baseCents,
                    qualifyingSpendCents: savings.qualifyingSpendCents,
                  };
                }
              }
            }
          }
        }
      }
    }

    const swapOutcomes: string[] = [];
    const swap = config.swaps.find((entry) => entry.k === k);
    if (swap) {
      const credit = ledger.credits.find(
        (row) => row.issueK === k && row.slot === swap.slot && row.status === 'linked',
      );
      const replacement = catalog.find((row) => row.key === swap.replacementKey);
      const sibling = ledger.credits.find(
        (row) => row.issueK === k && row.slot !== swap.slot && row.challengeItemId,
      );
      const siblingItem = ledger.items.find((row) => row.id === sibling?.challengeItemId);
      const siblingRestaurant = catalog.find((row) => row.id === siblingItem?.restaurantId);
      if (credit && replacement && siblingRestaurant) {
        const swapped = swapLinkedCredit({
          ledger,
          credit,
          replacementRestaurantId: replacement.id,
          replacementDiscountCents: replacement.discountCents,
          siblingDiscountCents: siblingRestaurant.discountCents,
          capacityMax: replacement.capacityMaxRedemptions,
          monthNow,
          carried: false,
        });
        swapOutcomes.push(typeof swapped === 'string' ? swapped : swapped.outcome);
        if (config.secondSwap) {
          const before = snapshotLedger(ledger);
          const again = swapLinkedCredit({
            ledger,
            credit,
            replacementRestaurantId: replacement.id,
            replacementDiscountCents: replacement.discountCents,
            siblingDiscountCents: siblingRestaurant.discountCents,
            capacityMax: replacement.capacityMaxRedemptions,
            monthNow,
            carried: false,
          });
          swapOutcomes.push(typeof again === 'string' ? again : again.outcome);
          if (snapshotLedger(ledger) !== before) {
            throw new Error('failed swap mutated the ledger');
          }
        }
      }
    }

    const assignedThisMonth = ledger.credits.filter(
      (credit) => credit.issueK === k && credit.challengeItemId && credit.status === 'linked',
    );
    for (const credit of assignedThisMonth) {
      completeCredit(ledger, credit, monthNow, config.completionPolicy);
    }
    const carriedLinked = ledger.credits.filter(
      (credit) => credit.issueK !== k && credit.status === 'linked' && credit.challengeItemId,
    );
    for (const credit of carriedLinked) {
      const spec = config.carriedAssigns
        .find((entry) => entry.k === k)
        ?.credits.find((row) => row.issueK === credit.issueK && row.slot === credit.slot);
      if (!spec) continue;
      completeCredit(ledger, credit, monthNow, spec.completionPolicy ?? config.completionPolicy);
    }

    months.push({
      k,
      monthNow: monthNow.toISOString(),
      chicagoMonth,
      requestedMiles: monthMiles,
      usedMiles: monthUsed,
      expanded: monthExpanded,
      pairKeys,
      rollover,
      swapOutcomes,
    });
  });

  const numerator = ledger.credits.filter((credit) => credit.challengeItemId !== null).length;
  const withMiles = [...months].reverse().find((month) => month.requestedMiles != null);
  const requestedMiles = withMiles?.requestedMiles ?? milesForDistanceBand(config.distanceBand);
  const usedMiles = withMiles?.usedMiles ?? requestedMiles;
  return {
    config,
    ledger,
    months,
    rejections: [...bag.values()],
    requestedMiles,
    usedMiles,
    expanded: withMiles?.expanded === true,
    numerator,
    denominator: ledger.credits.length,
    spendCents: spendOf(ledger, fullCatalog),
    capacity: modelCapacity(ledger, fullCatalog),
    carryCapExceeded: ledger.exceptions.some((row) => row.reason === 'carry_cap_exceeded'),
    pairSavings,
  };
}

function p1Counts(ledger: SupplyLedger): { extended: number; expired: number } {
  const p1 = ledger.credits.filter((credit) => credit.issueK === 1);
  return {
    extended: p1.filter(
      (credit) =>
        credit.status === 'pending' &&
        credit.expiresAt.getTime() === tierExpiresAt(credit.issuePeriod, 2).getTime(),
    ).length,
    expired: p1.filter((credit) => credit.status === 'expired').length,
  };
}

function carryConfig(completion: CompletionPolicy): SupplySimulationConfig {
  return baseConfig('carry_pressure', {
    completionPolicy: 'leave_linked',
    ks: [2, 1, 0],
    skipPairAssignKs: [2, 1],
    carriedAssigns: [
      {
        k: 1,
        credits: [
          { issueK: 2, slot: 1, restaurantKey: 'C2000', completionPolicy: completion },
          { issueK: 2, slot: 2, restaurantKey: 'C2500', completionPolicy: completion },
        ],
      },
    ],
  });
}

export function runCarryPressure(anchorNow: Date): CarryPressureResult {
  const snapshots = new Map<CompletionPolicy, CarryCapSnapshot>();
  const run = (completion: CompletionPolicy) =>
    runSimulatedSupplyMonths({
      config: carryConfig(completion),
      anchorNow,
      onRollover: (k, result, ledger) => {
        if (k !== 0) return;
        const counts = p1Counts(ledger);
        snapshots.set(completion, {
          vLinked: result.vLinked,
          p1Extended: counts.extended,
          p1Expired: counts.expired,
          outcome: result.outcome,
          carryCapExceeded: result.exceptionInserted,
          p0Assigned: 0,
          numerator: 0,
          denominator: 0,
        });
      },
    });
  const leaveLinked = run('leave_linked');
  const verifyControl = run('verify_on_assign');
  const finish = (completion: CompletionPolicy, model: SupplyModelResult): CarryCapSnapshot => {
    const snap = snapshots.get(completion);
    if (!snap) throw new Error('missing k=0 rollover snapshot');
    const p0Assigned = model.ledger.credits.filter(
      (credit) => credit.issueK === 0 && credit.challengeItemId !== null,
    ).length;
    return {
      ...snap,
      p0Assigned,
      numerator: model.numerator,
      denominator: model.denominator,
    };
  };
  return {
    leaveLinked,
    verifyControl,
    leaveSnapshot: finish('leave_linked', leaveLinked),
    verifySnapshot: finish('verify_on_assign', verifyControl),
  };
}

export function seededMatchRate(
  rows: Array<{ status: string; challenge_item_id: string | null }>,
): { numerator: number; denominator: number } {
  return {
    denominator: rows.length,
    numerator: rows.filter(
      (row) =>
        row.challenge_item_id !== null || row.status === 'spent' || row.status === 'linked',
    ).length,
  };
}

export function simulatedMatchRate(result: Pick<SupplyModelResult, 'numerator' | 'denominator'>): {
  numerator: number;
  denominator: number;
} {
  return { numerator: result.numerator, denominator: result.denominator };
}

export function finalItemSpendCents(args: {
  challengeItemId: string | null;
  items: Array<{ id: string; thresholdCents: number }>;
}): number {
  if (!args.challengeItemId) return 0;
  return args.items.find((item) => item.id === args.challengeItemId)?.thresholdCents ?? 0;
}

export type SeededReport = {
  numerator: number;
  denominator: number;
  spendCents: number;
  rejections: SupplyRejection[];
  capacity: CapacityLine[];
  lines: string[];
};

export function formatSupplySimulationReport(args: {
  config: string;
  simulatedMonths: number;
  requestedMiles: number;
  usedMiles: number;
  expanded: boolean;
  seeded: SeededReport;
  simulatedLines: string[];
  simulatedRejections: SupplyRejection[];
  simulatedCapacity: CapacityLine[];
  pairSavings: SupplyModelResult['pairSavings'];
  carryCapExceeded: boolean;
}): string {
  const rejectLine = (label: string, rows: SupplyRejection[]) => {
    if (rows.length === 0) return `${label} none`;
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
    const body = [...counts.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([reason, count]) => `${reason}=${count}`)
      .join(' ');
    return `${label} ${body}`;
  };
  const capacityLine = (row: CapacityLine) =>
    [
      'capacity',
      `source=${row.source}`,
      `restaurant=${row.restaurantKey}`,
      `bucket=${row.bucketStart}`,
      `reserved_count=${row.reserved}`,
      `consumed_count=${row.consumed}`,
      `released_count=${row.released}`,
      `used=${row.used}`,
      `capacity_max_redemptions=${row.capacityMax}`,
      `utilization=${row.utilization}`,
    ].join(' ');
  const lines = [
    `=== E02 supply simulation config=${args.config} ===`,
    `simulated_months=${args.simulatedMonths}`,
    `requested_miles=${args.requestedMiles}`,
    `used_miles=${args.usedMiles}`,
    `expanded=${args.expanded}`,
    'seeded_baseline',
    `seeded_match=${args.seeded.numerator}/${args.seeded.denominator}`,
    `seeded_historical_required_spend_cents=${args.seeded.spendCents}`,
    'seeded_spend_label=seeded_historical fixture_assumption',
    ...args.seeded.lines,
    rejectLine('rpc_rejections', args.seeded.rejections),
    ...args.seeded.capacity.map(capacityLine),
    'simulated',
    ...args.simulatedLines,
    rejectLine('selector_rejections', args.simulatedRejections),
    ...args.simulatedCapacity.map(capacityLine),
    args.pairSavings
      ? `pair_savings label=${args.pairSavings.label} base_cents=${args.pairSavings.baseCents} qualifying_spend_cents=${args.pairSavings.qualifyingSpendCents}`
      : 'pair_savings none',
    `carry_cap_exceeded=${args.carryCapExceeded ? 'present' : 'none'}`,
  ];
  return lines.join('\n');
}

export function simulatedLinesFor(result: SupplyModelResult): string[] {
  return [
    `simulated_match=${result.numerator}/${result.denominator}`,
    `simulated_month_required_spend_cents=${result.spendCents}`,
    'simulated_spend_label=simulated_month fixture_assumption',
  ];
}

export function carryPressureLines(pressure: CarryPressureResult): string[] {
  const block = (label: string, model: SupplyModelResult, snap: CarryCapSnapshot) => [
    label,
    `simulated_match=${snap.numerator}/${snap.denominator}`,
    `simulated_month_required_spend_cents=${model.spendCents}`,
    'simulated_spend_label=simulated_month fixture_assumption',
    `v_linked=${snap.vLinked}`,
    `p1_extended=${snap.p1Extended}`,
    `p1_expired=${snap.p1Expired}`,
    `rollover=${snap.outcome}`,
    `carry_cap_exceeded=${snap.carryCapExceeded ? 'present' : 'none'}`,
    `p0_assigned=${snap.p0Assigned}`,
    `denominator=${snap.denominator}`,
  ];
  return [
    ...block('carry_pressure_leave_linked', pressure.leaveLinked, pressure.leaveSnapshot),
    ...block('carry_pressure_verify_control', pressure.verifyControl, pressure.verifySnapshot),
  ];
}

export function openMonthPair(result: SupplyModelResult): [string, string] | null {
  const last = [...result.months].reverse().find((month) => month.pairKeys);
  return last?.pairKeys ?? null;
}

export function creditByIssue(
  ledger: SupplyLedger,
  issueK: number,
  slot: 1 | 2,
): SimCredit | undefined {
  return ledger.credits.find((credit) => credit.issueK === issueK && credit.slot === slot);
}
