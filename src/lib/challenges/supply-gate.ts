import { z } from 'zod';
import type { Json } from '@/types/database.types';
import { chicagoMonthStart } from '@/lib/cron-period';
import {
  floorPairExists,
  pickFloorPair,
  selectDistancePool,
} from '@/lib/challenges/distance-pool';
import { offerVersionCoversDeadline } from '@/lib/challenges/challenge-deadline';
import {
  applyRollover,
  assignLinkedRestaurant,
  bucketsIntersectingDeadline,
  carriedAssignDeadline,
  completeCredit,
  createLedger,
  creditIsCarried,
  issueTwoCredits,
  plusAssignmentHours,
  resetSupplyIds,
  shiftMonthStart,
  type SimCredit,
  type SupplyLedger,
} from '@/lib/challenges/supply-simulation-lifecycle';
import {
  createCooldownCutoffCache,
  redemptionCooldownReason,
  varietyCycleMonthLowerBound,
  type CooldownCutoffCache,
  type CooldownRedemption,
} from '@/lib/challenges/restaurant-safety';
import { MEMBER_FLAGS } from '@/lib/challenges/supply-simulation';
import { getDietaryConflict, hasAllergyConflict } from '@/lib/dietary-utils';
import { restaurantHasExcludedCuisine } from '@/lib/cuisines';
import {
  haversineMiles,
  milesForDistanceBand,
  originFromZip,
  toGeoPoint,
} from '@/lib/launch-market';
import { lowestSealedBase } from '@/lib/offers/sealed-base';
import { createSeededShuffle } from '@/lib/simulation/seeded-shuffle';

/**
 * E02 supply gate (D2=B). Read-only catalog in, seeded trials out.
 * Does not import a Supabase client and does not read the environment.
 *
 * No production caller of `link_pending_credits` exists under `src/`.
 * That SQL function checks a caller-supplied pair (`offer_lowest_tier_cents`
 * sum >= 2000) and does not choose the pair. This gate searches for the first
 * seeded (i < j) pair whose bases sum to >= 2000, expanding one distance band
 * when the requested radius has no qualifying pair. A PASS measures that
 * floor-aware policy. `generate.ts` still picks two candidates at random and
 * can receive `pair_below_floor` from the RPC.
 */

export const SUPPLY_GATE_SCHEMA = 'wanderbite.e02.supply_snapshot.v1';
export const SUPPLY_GATE_DENOMINATOR = 192;
export const PAIR_FLOOR_CENTS = 2000;
export const CARRIED_FLOOR_CENTS = 2000;

const FORBIDDEN_KEY = /pin|verification|address|email|phone|token|secret|password/i;
const TOP_LEVEL_KEYS = [
  'schema',
  'exported_at',
  'launch_market',
  'restaurants',
  'offer_versions',
  'legacy_offers',
] as const;

const LAUNCH_ZIPS = ['75069', '75070', '75071', '75072'] as const;
export type LaunchZip = (typeof LAUNCH_ZIPS)[number];
export type GatePersona = 'open' | 'restricted';
export type GateTenure = 'new' | 'tenured';

export type SupplyGateMember = {
  id: string;
  zip: LaunchZip;
  persona: GatePersona;
  tenure: GateTenure;
  distanceBand: '5_mi';
  wantsCocktailExperience: false;
  swaps: 0;
  completion: 'verify_on_assign';
  dietaryFlags: string[];
  allergyFlags: string[];
  excludedCuisineIds: string[];
};

function personaFlags(persona: GatePersona): {
  dietaryFlags: string[];
  allergyFlags: string[];
  excludedCuisineIds: string[];
} {
  if (persona === 'open') {
    return { dietaryFlags: [], allergyFlags: [], excludedCuisineIds: [] };
  }
  return {
    dietaryFlags: [...MEMBER_FLAGS.dietaryFlags],
    allergyFlags: [...MEMBER_FLAGS.allergyFlags],
    excludedCuisineIds: [...MEMBER_FLAGS.excludedCuisineIds],
  };
}

/** 4 launch ZIPs × open/restricted × new/tenured. Restricted counts toward 100%. */
export const SUPPLY_GATE_COHORT: readonly SupplyGateMember[] = LAUNCH_ZIPS.flatMap((zip) =>
  (['open', 'restricted'] as const).flatMap((persona) =>
    (['new', 'tenured'] as const).map((tenure) => ({
      id: `${zip}-${persona}-${tenure}`,
      zip,
      persona,
      tenure,
      distanceBand: '5_mi' as const,
      wantsCocktailExperience: false as const,
      swaps: 0 as const,
      completion: 'verify_on_assign' as const,
      ...personaFlags(persona),
    })),
  ),
);

export type GateRule =
  | 'outside_market'
  | 'no_offer_version'
  | 'offer_version_not_selectable'
  | 'offer_tiers_invalid'
  | 'missing_coordinates'
  | 'dietary_exclusion'
  | 'allergy'
  | 'excluded_cuisine'
  | 'cooldown_recent_visit_6m'
  | 'cooldown_two_in_12m'
  | 'capacity_full'
  | 'variety_6m'
  | 'variety_12m'
  | 'relaxed_variety_last_month'
  | 'outside_distance'
  | 'pair_below_floor'
  | 'carried_below_floor';

const tierRecord = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

const snapshotSchema = z
  .object({
    schema: z.literal(SUPPLY_GATE_SCHEMA),
    exported_at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'exported_at'),
    launch_market: z
      .object({
        id: z.string(),
        slug: z.string(),
        status: z.string().nullable(),
      })
      .strict(),
    restaurants: z.array(
      z
        .object({
          id: z.string(),
          slug: z.string().nullable(),
          name: z.string(),
          status: z.string().nullable(),
          market_id: z.string().nullable(),
          cuisine_tags: z.array(z.string()).nullable(),
          lat: z.number().nullable(),
          lon: z.number().nullable(),
          current_offer_version_id: z.string().nullable(),
        })
        .strict(),
    ),
    offer_versions: z.array(
      z
        .object({
          id: z.string(),
          restaurant_id: z.string(),
          tiers: z.array(tierRecord),
          valid_from: z.string(),
          valid_until: z.string(),
          withdrawn_from_selection_at: z.string().nullable(),
          capacity_max_redemptions: z.number(),
          capacity_timezone: z.string(),
          capacity_window_kind: z.string(),
        })
        .strict(),
    ),
    legacy_offers: z.array(
      z
        .object({
          restaurant_id: z.string().nullable(),
          discount_amount_cents: z.number().nullable(),
          min_spend_cents: z.number().nullable(),
          max_redemptions_per_month: z.number().nullable(),
          active: z.boolean().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export type SupplySnapshot = z.infer<typeof snapshotSchema>;

export type SnapshotParseResult =
  | { ok: true; snapshot: SupplySnapshot }
  | { ok: false; message: string };

function formatZodPath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') {
      out += `[${part}]`;
      continue;
    }
    const text = String(part);
    out += out.length === 0 ? text : `.${text}`;
  }
  return out;
}

/** Key paths only. Zod messages and input values stay out of the text. */
function formatZodPaths(issues: ReadonlyArray<{ code?: string; path: ReadonlyArray<PropertyKey>; keys?: ReadonlyArray<string> }>): string {
  const paths: string[] = [];
  for (const issue of issues) {
    const base = formatZodPath(issue.path);
    if (issue.code === 'unrecognized_keys' && issue.keys && issue.keys.length > 0) {
      for (const key of issue.keys) paths.push(base.length === 0 ? key : `${base}.${key}`);
      continue;
    }
    paths.push(base.length === 0 ? '(root)' : base);
  }
  return [...new Set(paths)].join(', ');
}

function forbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => forbiddenKey(entry));
  if (!value || typeof value !== 'object') return false;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) return true;
    if (forbiddenKey(entry)) return true;
  }
  return false;
}

/** Fail closed. Never include values from the rejected document. */
export function parseSupplySnapshot(raw: unknown): SnapshotParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: 'snapshot rejected: schema mismatch' };
  }
  if (forbiddenKey(raw)) {
    return { ok: false, message: 'snapshot rejected: forbidden key' };
  }
  const keys = Object.keys(raw);
  if (keys.some((key) => !TOP_LEVEL_KEYS.includes(key as (typeof TOP_LEVEL_KEYS)[number]))) {
    return { ok: false, message: 'snapshot rejected: unknown top-level key' };
  }
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: `snapshot rejected: ${formatZodPaths(parsed.error.issues)}` };
  }
  if (parsed.data.launch_market.slug !== 'mckinney-tx') {
    return { ok: false, message: 'snapshot rejected: schema mismatch' };
  }
  return { ok: true, snapshot: parsed.data };
}

type VersionRow = SupplySnapshot['offer_versions'][number];
type RestaurantRow = SupplySnapshot['restaurants'][number];

type GateRestaurant = RestaurantRow & {
  version: VersionRow | null;
  legacy: boolean;
};

type CycleHit = { cycleMonth: string; restaurantId: string };

type MemberState = {
  member: SupplyGateMember;
  ledger: SupplyLedger;
  cycles: CycleHit[];
  monthsRun: number;
};

type AttemptKind = 'pair' | 'carried';

type FailureMark = {
  month: string;
  binding: GateRule;
  sub: string | null;
  attempt: AttemptKind;
  need: 1 | 2;
  counts: FunnelCounts;
};

export type SupplyGateTrial = {
  seed: number;
  numerator: number;
  matchedViaCarry: number;
  unmatchedByMonth: Map<string, number>;
  unmatchedByRule: Map<string, number>;
  unmatchedByPersona: Map<string, number>;
  funnel: string[];
};

export type SupplyGateShortfall = {
  persona: GatePersona;
  zip: LaunchZip;
  eligibleStatic5: number;
  eligibleStatic15: number;
  neededDistinct6mo: 12;
  baseAtLeast1000: number;
  baseAtLeast2000: number;
  addAtLeast: number;
  kind: string;
};

export type SupplyGateResult = {
  result: 'PASS' | 'FAIL';
  exportedAt: string;
  exportedAtCt: string;
  activeRestaurants: number;
  catalogLine: string;
  windowLabel: string;
  m0: string;
  m5: string;
  seeds: number[];
  matchedMin: number;
  worstSeed: number;
  trialsFailed: number;
  matchedViaCarry: number;
  unmatchedByMonth: Map<string, number>;
  unmatchedByRule: Map<string, number>;
  unmatchedByPersona: Map<string, number>;
  unmatchedByMonthAll: Map<string, number>;
  unmatchedByRuleAll: Map<string, number>;
  unmatchedByPersonaAll: Map<string, number>;
  funnel: string[];
  shortfall: SupplyGateShortfall[];
  minSpendDistribution: Record<string, number>;
  trials: SupplyGateTrial[];
  text: string;
};

function monthInstant(yyyyMmDd: string): Date {
  const year = Number(yyyyMmDd.slice(0, 4));
  const month = Number(yyyyMmDd.slice(5, 7));
  return new Date(Date.UTC(year, month - 1, 15, 18, 0, 0));
}

/** First Chicago month whose 15th 18:00Z is at or after `exportedAt`. */
export function firstScoredMonth(exportedAt: Date): string {
  let month = chicagoMonthStart(exportedAt);
  for (let step = 0; step < 6; step += 1) {
    if (monthInstant(month).getTime() >= exportedAt.getTime()) return month;
    month = shiftMonthStart(month, 1);
  }
  throw new Error('E02 supply gate: could not place M0');
}

export function scoredMonthList(m0: string): string[] {
  return Array.from({ length: 6 }, (_, index) => shiftMonthStart(m0, index));
}

function formatCt(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  let hour = pick('hour');
  if (hour === '24') hour = '00';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${hour}:${pick('minute')}:${pick('second')}`;
}

function ym(yyyyMmDd: string): string {
  return yyyyMmDd.slice(0, 7);
}

function tiersJson(tiers: VersionRow['tiers']): Json {
  return tiers.map((row) => ({ ...row }));
}

function baseCents(version: VersionRow | null): number | null {
  if (!version) return null;
  const sealed = lowestSealedBase(tiersJson(version.tiers));
  if (!sealed) return null;
  return sealed.discount_amount_cents;
}

function offerSubreason(
  version: VersionRow,
  now: Date,
  deadline: Date,
): 'withdrawn' | 'not_yet_valid' | 'expires_before_deadline' | null {
  if (offerVersionCoversDeadline(version, now, deadline)) return null;
  if (version.withdrawn_from_selection_at) return 'withdrawn';
  if (new Date(version.valid_from).getTime() > now.getTime()) return 'not_yet_valid';
  return 'expires_before_deadline';
}

function buildRestaurants(snapshot: SupplySnapshot): GateRestaurant[] {
  const versions = new Map(snapshot.offer_versions.map((row) => [row.id, row]));
  const legacyIds = new Set(
    snapshot.legacy_offers
      .filter((row) => row.active === true && row.restaurant_id)
      .map((row) => row.restaurant_id as string),
  );
  return snapshot.restaurants
    .filter((row) => row.status === 'active')
    .map((row) => {
      const version = row.current_offer_version_id
        ? versions.get(row.current_offer_version_id) ?? null
        : null;
      const linked = version && version.restaurant_id === row.id ? version : null;
      return {
        ...row,
        version: linked,
        legacy: legacyIds.has(row.id),
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function hasCoords(restaurant: GateRestaurant): boolean {
  return toGeoPoint(restaurant.lat, restaurant.lon) != null;
}

function withinMiles(restaurant: GateRestaurant, originLat: number, originLon: number, miles: number): boolean {
  const point = toGeoPoint(restaurant.lat, restaurant.lon);
  if (!point) return false;
  return haversineMiles({ lat: originLat, lon: originLon }, point) <= miles;
}

function cycleCount(cycles: CycleHit[], restaurantId: string, lower: string, upper: string): number {
  const seen = new Set<string>();
  for (const hit of cycles) {
    if (hit.restaurantId !== restaurantId) continue;
    if (hit.cycleMonth >= lower && hit.cycleMonth < upper) seen.add(hit.cycleMonth);
  }
  return seen.size;
}

type FilterCtx = {
  marketId: string;
  member: SupplyGateMember;
  now: Date;
  deadline: Date;
  buckets: string[];
  used: Map<string, Map<string, number>>;
  ledger: SupplyLedger;
  cycles: CycleHit[];
  skipOffer: boolean;
  cutoffCache: CooldownCutoffCache;
  varietyUpper: string;
  varietyLower6: string;
  varietyLower12: string;
  previousCycleMonth: string;
};

function usedCounts(ledger: SupplyLedger): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();
  for (const row of ledger.reservations) {
    if (row.status !== 'reserved' && row.status !== 'consumed') continue;
    let buckets = counts.get(row.restaurantId);
    if (!buckets) {
      buckets = new Map();
      counts.set(row.restaurantId, buckets);
    }
    buckets.set(row.bucketStart, (buckets.get(row.bucketStart) ?? 0) + 1);
  }
  return counts;
}

function makeCtx(args: Omit<FilterCtx, 'buckets' | 'used' | 'cutoffCache' | 'varietyUpper' | 'varietyLower6' | 'varietyLower12' | 'previousCycleMonth'> & {
  cutoffCache?: CooldownCutoffCache;
}): FilterCtx {
  const varietyUpper = chicagoMonthStart(args.now);
  return {
    ...args,
    cutoffCache: args.cutoffCache ?? createCooldownCutoffCache(),
    buckets: bucketsIntersectingDeadline(args.now, args.deadline),
    used: usedCounts(args.ledger),
    varietyUpper,
    varietyLower6: varietyCycleMonthLowerBound(args.now, 6),
    varietyLower12: varietyCycleMonthLowerBound(args.now, 12),
    previousCycleMonth: shiftMonthStart(varietyUpper, -1),
  };
}

function passesMarket(restaurant: GateRestaurant, ctx: FilterCtx): boolean {
  return restaurant.market_id === ctx.marketId;
}

function passesOfferVersion(restaurant: GateRestaurant, ctx: FilterCtx): boolean {
  if (ctx.skipOffer) return true;
  return restaurant.version != null;
}

function passesSelectable(restaurant: GateRestaurant, ctx: FilterCtx): boolean {
  if (ctx.skipOffer) return true;
  if (!restaurant.version) return true;
  return offerVersionCoversDeadline(restaurant.version, ctx.now, ctx.deadline);
}

function passesTiers(restaurant: GateRestaurant, ctx: FilterCtx): boolean {
  if (ctx.skipOffer) return true;
  if (!restaurant.version) return true;
  return baseCents(restaurant.version) != null;
}

function passesDietary(restaurant: GateRestaurant, ctx: FilterCtx): boolean {
  return !getDietaryConflict(restaurant.cuisine_tags, ctx.member.dietaryFlags);
}

function passesAllergy(restaurant: GateRestaurant, ctx: FilterCtx): boolean {
  return !hasAllergyConflict(restaurant.cuisine_tags, ctx.member.allergyFlags);
}

function passesCuisine(restaurant: GateRestaurant, ctx: FilterCtx): boolean {
  return !restaurantHasExcludedCuisine({
    restaurantCuisineTags: restaurant.cuisine_tags,
    excludedCuisineIds: ctx.member.excludedCuisineIds,
  });
}

function passesRecent(restaurant: GateRestaurant, ctx: FilterCtx): boolean {
  return (
    redemptionCooldownReason(restaurant.id, ctx.ledger.redemptions, ctx.now, ctx.cutoffCache) !==
    'recent_visit_6m'
  );
}

function passesTwoIn12(restaurant: GateRestaurant, ctx: FilterCtx): boolean {
  return (
    redemptionCooldownReason(restaurant.id, ctx.ledger.redemptions, ctx.now, ctx.cutoffCache) !==
    'two_in_12m'
  );
}

function passesCapacity(restaurant: GateRestaurant, ctx: FilterCtx): boolean {
  const cap = restaurant.version?.capacity_max_redemptions ?? 1000;
  const buckets = ctx.used.get(restaurant.id);
  return ctx.buckets.every((bucket) => (buckets?.get(bucket) ?? 0) < cap);
}

function passesVariety6(restaurant: GateRestaurant, ctx: FilterCtx): boolean {
  return cycleCount(ctx.cycles, restaurant.id, ctx.varietyLower6, ctx.varietyUpper) === 0;
}

function passesVariety12(restaurant: GateRestaurant, ctx: FilterCtx): boolean {
  return cycleCount(ctx.cycles, restaurant.id, ctx.varietyLower12, ctx.varietyUpper) < 2;
}

function passesRelaxed(restaurant: GateRestaurant, ctx: FilterCtx): boolean {
  return !ctx.cycles.some(
    (hit) => hit.restaurantId === restaurant.id && hit.cycleMonth === ctx.previousCycleMonth,
  );
}

function passesHard(restaurant: GateRestaurant, ctx: FilterCtx): boolean {
  return (
    passesMarket(restaurant, ctx) &&
    passesOfferVersion(restaurant, ctx) &&
    passesSelectable(restaurant, ctx) &&
    passesTiers(restaurant, ctx) &&
    hasCoords(restaurant) &&
    passesDietary(restaurant, ctx) &&
    passesAllergy(restaurant, ctx) &&
    passesCuisine(restaurant, ctx) &&
    redemptionCooldownReason(restaurant.id, ctx.ledger.redemptions, ctx.now, ctx.cutoffCache) === null &&
    passesCapacity(restaurant, ctx)
  );
}

function offerFailureSub(
  survivors: GateRestaurant[],
  ctx: FilterCtx,
): string | null {
  const reasons = new Set<string>();
  for (const restaurant of survivors) {
    if (!restaurant.version) continue;
    if (passesSelectable(restaurant, ctx)) continue;
    const reason = offerSubreason(restaurant.version, ctx.now, ctx.deadline);
    if (reason) reasons.add(reason);
  }
  if (reasons.size === 0) return null;
  for (const reason of ['withdrawn', 'not_yet_valid', 'expires_before_deadline']) {
    if (reasons.has(reason)) return reason;
  }
  return null;
}

type FunnelCounts = {
  active: number;
  market: number;
  offerVersion: number;
  selectable: number;
  coords: number;
  dietary: number;
  allergy: number;
  cuisine: number;
  cooldown: number;
  capacity: number;
  distance: number;
  variety: number;
  floor: number;
};

function countFloor(restaurants: GateRestaurant[], floor: AttemptKind): number {
  if (floor === 'carried') {
    return restaurants.filter((restaurant) => (baseCents(restaurant.version) ?? 0) >= CARRIED_FLOOR_CENTS).length;
  }
  const bases = restaurants.map((restaurant) => baseCents(restaurant.version));
  let count = 0;
  for (let i = 0; i < restaurants.length; i += 1) {
    const left = bases[i];
    if (left == null) continue;
    const canPair = bases.some((right, j) => j !== i && right != null && left + right >= PAIR_FLOOR_CENTS);
    if (canPair) count += 1;
  }
  return count;
}

/**
 * Walk the full active catalog. Coordinates drop at missing_coordinates.
 * Distance (usedMiles) runs only after the hard filters and variety.
 */
function explainFunnel(args: {
  restaurants: GateRestaurant[];
  ctx: FilterCtx;
  usedMiles: number;
  need: 1 | 2;
  origin: { lat: number; lon: number };
  floor: AttemptKind;
}): { binding: GateRule | null; sub: string | null; counts: FunnelCounts } {
  const stages: Array<{
    id: GateRule;
    key: keyof FunnelCounts | null;
    ok: (restaurant: GateRestaurant) => boolean;
  }> = [
    { id: 'outside_market', key: 'market', ok: (restaurant) => passesMarket(restaurant, args.ctx) },
    { id: 'no_offer_version', key: 'offerVersion', ok: (restaurant) => passesOfferVersion(restaurant, args.ctx) },
    { id: 'offer_version_not_selectable', key: 'selectable', ok: (restaurant) => passesSelectable(restaurant, args.ctx) },
    { id: 'offer_tiers_invalid', key: null, ok: (restaurant) => passesTiers(restaurant, args.ctx) },
    { id: 'missing_coordinates', key: 'coords', ok: (restaurant) => hasCoords(restaurant) },
    { id: 'dietary_exclusion', key: 'dietary', ok: (restaurant) => passesDietary(restaurant, args.ctx) },
    { id: 'allergy', key: 'allergy', ok: (restaurant) => passesAllergy(restaurant, args.ctx) },
    { id: 'excluded_cuisine', key: 'cuisine', ok: (restaurant) => passesCuisine(restaurant, args.ctx) },
    { id: 'cooldown_recent_visit_6m', key: null, ok: (restaurant) => passesRecent(restaurant, args.ctx) },
    { id: 'cooldown_two_in_12m', key: 'cooldown', ok: (restaurant) => passesTwoIn12(restaurant, args.ctx) },
    { id: 'capacity_full', key: 'capacity', ok: (restaurant) => passesCapacity(restaurant, args.ctx) },
  ];

  let binding: GateRule | null = null;
  let sub: string | null = null;
  let survivors = args.restaurants;
  const counts: FunnelCounts = {
    active: survivors.length,
    market: 0,
    offerVersion: 0,
    selectable: 0,
    coords: 0,
    dietary: 0,
    allergy: 0,
    cuisine: 0,
    cooldown: 0,
    capacity: 0,
    distance: 0,
    variety: 0,
    floor: 0,
  };

  for (const stage of stages) {
    const next = survivors.filter(stage.ok);
    if (binding == null && next.length < args.need) {
      binding = stage.id;
      if (stage.id === 'no_offer_version') {
        const blocked = survivors.filter((restaurant) => !stage.ok(restaurant));
        const legacyOnly =
          blocked.length > 0 && blocked.every((restaurant) => restaurant.legacy && !restaurant.version);
        sub = legacyOnly ? 'legacy_offer_only' : null;
      } else if (stage.id === 'offer_version_not_selectable') {
        sub = offerFailureSub(survivors, args.ctx);
      }
    }
    survivors = next;
    if (stage.key) counts[stage.key] = next.length;
  }

  const after6 = survivors.filter((restaurant) => passesVariety6(restaurant, args.ctx));
  const after12 = after6.filter((restaurant) => passesVariety12(restaurant, args.ctx));
  const relaxed = survivors.filter((restaurant) => passesRelaxed(restaurant, args.ctx));
  let varietyRows = after12;
  if (after12.length < args.need) {
    if (after6.length < args.need) {
      if (binding == null) binding = 'variety_6m';
      varietyRows = after6;
    } else if (binding == null) {
      binding = 'variety_12m';
    }
  }
  if (binding == null && relaxed.length < args.need) {
    binding = 'relaxed_variety_last_month';
    varietyRows = relaxed;
  }
  counts.variety = varietyRows.length;

  const inRadius = varietyRows.filter((restaurant) =>
    withinMiles(restaurant, args.origin.lat, args.origin.lon, args.usedMiles),
  );
  counts.distance = inRadius.length;
  if (binding == null && inRadius.length < args.need) binding = 'outside_distance';

  counts.floor = countFloor(inRadius, args.floor);
  if (binding == null && counts.floor < args.need) {
    binding = args.floor === 'pair' ? 'pair_below_floor' : 'carried_below_floor';
  }
  return { binding, sub, counts };
}

function meetsPairFloor(candidates: readonly GateRestaurant[]): boolean {
  return floorPairExists(
    candidates.map((restaurant) => ({
      id: restaurant.id,
      baseCents: baseCents(restaurant.version),
    })),
    PAIR_FLOOR_CENTS,
  );
}

function scopeRestaurants(restaurants: GateRestaurant[], floor: AttemptKind): GateRestaurant[] {
  if (floor !== 'carried') return restaurants;
  return restaurants.filter((restaurant) => (baseCents(restaurant.version) ?? 0) >= CARRIED_FLOOR_CENTS);
}

function selectPool(args: {
  restaurants: GateRestaurant[];
  ctx: FilterCtx;
  need: 1 | 2;
}): { candidates: GateRestaurant[]; usedMiles: number } {
  const origin = originFromZip(args.ctx.member.zip);
  if (!origin) return { candidates: [], usedMiles: milesForDistanceBand('5_mi') };
  const requestedMiles = milesForDistanceBand(args.ctx.member.distanceBand);
  const pool = selectDistancePool({
    restaurants: args.restaurants,
    origin,
    requestedMiles,
    requiredCount: args.need,
    passesHard: (restaurant) => passesHard(restaurant, args.ctx),
    passesVariety: (restaurant) =>
      passesVariety6(restaurant, args.ctx) && passesVariety12(restaurant, args.ctx),
    passesRelaxedVariety: (restaurant) => passesRelaxed(restaurant, args.ctx),
    poolSatisfies: args.need === 2 ? meetsPairFloor : undefined,
  });
  return { candidates: pool.candidates, usedMiles: pool.match.usedMiles };
}

function explainAttempt(args: {
  restaurants: GateRestaurant[];
  ctx: FilterCtx;
  need: 1 | 2;
  floor: AttemptKind;
  candidates: GateRestaurant[];
  usedMiles: number;
}): { binding: GateRule; sub: string | null; counts: FunnelCounts } {
  const origin = originFromZip(args.ctx.member.zip);
  const empty: FunnelCounts = {
    active: args.restaurants.length,
    market: 0,
    offerVersion: 0,
    selectable: 0,
    coords: 0,
    dietary: 0,
    allergy: 0,
    cuisine: 0,
    cooldown: 0,
    capacity: 0,
    distance: 0,
    variety: 0,
    floor: 0,
  };
  if (!origin) return { binding: 'outside_distance', sub: null, counts: empty };
  const walked = explainFunnel({
    restaurants: args.restaurants,
    ctx: args.ctx,
    usedMiles: args.usedMiles,
    need: args.need,
    origin,
    floor: args.floor,
  });
  const floorBinding: GateRule = args.floor === 'pair' ? 'pair_below_floor' : 'carried_below_floor';
  const meetsFloor =
    args.floor === 'pair'
      ? meetsPairFloor(args.candidates)
      : args.candidates.some((restaurant) => (baseCents(restaurant.version) ?? 0) >= CARRIED_FLOOR_CENTS);
  if (!meetsFloor && args.candidates.length >= args.need) {
    return { binding: floorBinding, sub: null, counts: walked.counts };
  }
  if (walked.binding) return { binding: walked.binding, sub: walked.sub, counts: walked.counts };
  return { binding: floorBinding, sub: walked.sub, counts: walked.counts };
}

/**
 * Binding for a single attempt. Tests use this to prove 12-month history
 * rules that six warm-up months cannot stack under the rolling cooldown.
 */
export function explainSupplyBinding(args: {
  snapshot: SupplySnapshot;
  member: SupplyGateMember;
  now: Date;
  need: 1 | 2;
  floor: AttemptKind;
  redemptions: CooldownRedemption[];
  cycles: CycleHit[];
  reservations?: SupplyLedger['reservations'];
  skipOffer?: boolean;
}): { binding: GateRule | null; sub: string | null } {
  const ledger = createLedger();
  ledger.redemptions = args.redemptions.map((row) => ({
    restaurant_id: row.restaurant_id ?? '',
    status: 'verified' as const,
    verified_at: row.verified_at ?? row.created_at ?? args.now.toISOString(),
    created_at: row.created_at ?? row.verified_at ?? args.now.toISOString(),
    challengeItemId: 'primed',
  }));
  if (args.reservations) ledger.reservations = args.reservations;
  const deadline = plusAssignmentHours(args.now);
  const ctx = makeCtx({
    marketId: args.snapshot.launch_market.id,
    member: args.member,
    now: args.now,
    deadline,
    ledger,
    cycles: args.cycles,
    skipOffer: args.skipOffer === true,
  });
  const restaurants = buildRestaurants(args.snapshot);
  const origin = originFromZip(args.member.zip);
  if (!origin) return { binding: 'outside_distance', sub: null };
  const pool = selectPool({
    restaurants: scopeRestaurants(restaurants, args.floor),
    ctx,
    need: args.need,
  });
  const walked = explainFunnel({
    restaurants,
    ctx,
    usedMiles: pool.usedMiles,
    need: args.need,
    origin,
    floor: args.floor,
  });
  return { binding: walked.binding, sub: walked.sub };
}

/** Candidates the gate's distance policy would hand the carried or pair picker. */
export function selectSupplyGateCandidates(args: {
  snapshot: SupplySnapshot;
  member: SupplyGateMember;
  now: Date;
  deadline: Date;
  need: 1 | 2;
  floor: 'pair' | 'carried';
  redemptions: CooldownRedemption[];
  cycles: CycleHit[];
}): { ids: string[]; usedMiles: number } {
  const ledger = createLedger();
  ledger.redemptions = args.redemptions.map((row) => ({
    restaurant_id: row.restaurant_id ?? '',
    status: 'verified' as const,
    verified_at: row.verified_at ?? row.created_at ?? args.now.toISOString(),
    created_at: row.created_at ?? row.verified_at ?? args.now.toISOString(),
    challengeItemId: 'primed',
  }));
  const ctx = makeCtx({
    marketId: args.snapshot.launch_market.id,
    member: args.member,
    now: args.now,
    deadline: args.deadline,
    ledger,
    cycles: args.cycles,
    skipOffer: false,
  });
  const pool = selectPool({
    restaurants: scopeRestaurants(buildRestaurants(args.snapshot), args.floor),
    ctx,
    need: args.need,
  });
  return { ids: pool.candidates.map((restaurant) => restaurant.id), usedMiles: pool.usedMiles };
}

function mark(
  marks: Map<string, FailureMark>,
  credits: SimCredit[],
  failure: FailureMark,
): void {
  for (const credit of credits) {
    if (credit.challengeItemId) continue;
    marks.set(credit.id, failure);
  }
}

function recordCycle(state: MemberState, cycleMonth: string, restaurantId: string): void {
  state.cycles.push({ cycleMonth, restaurantId });
}

function runMemberMonth(args: {
  state: MemberState;
  restaurants: GateRestaurant[];
  marketId: string;
  monthNow: Date;
  monthKey: string;
  shuffle: <T>(items: readonly T[]) => T[];
  skipOffer: boolean;
  marks: Map<string, FailureMark>;
  score: boolean;
  cutoffCache: CooldownCutoffCache;
}): void {
  if (args.state.monthsRun > 0) applyRollover(args.state.ledger, args.monthNow);
  const issued = issueTwoCredits(args.state.ledger, args.monthNow, args.state.monthsRun);
  args.state.monthsRun += 1;

  const carried = args.state.ledger.credits
    .filter((credit) => creditIsCarried(credit, args.monthNow))
    .sort((a, b) => {
      if (a.issuePeriod !== b.issuePeriod) return a.issuePeriod < b.issuePeriod ? -1 : 1;
      if (a.slot !== b.slot) return a.slot - b.slot;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  for (const credit of carried) {
    const deadline = carriedAssignDeadline(args.monthNow, credit.expiresAt);
    const ctx = makeCtx({
      marketId: args.marketId,
      member: args.state.member,
      now: args.monthNow,
      deadline,
      ledger: args.state.ledger,
      cycles: args.state.cycles,
      skipOffer: args.skipOffer,
      cutoffCache: args.cutoffCache,
    });
    const pool = selectPool({
      restaurants: scopeRestaurants(args.restaurants, 'carried'),
      ctx,
      need: 1,
    });
    const ordered = args.shuffle(pool.candidates);
    const choice = ordered.find((restaurant) => {
      const base = baseCents(restaurant.version);
      return base != null && base >= CARRIED_FLOOR_CENTS && passesCapacity(restaurant, ctx);
    });
    if (!choice) {
      if (args.score) {
        const explained = explainAttempt({
          restaurants: args.restaurants,
          ctx,
          need: 1,
          floor: 'carried',
          candidates: pool.candidates,
          usedMiles: pool.usedMiles,
        });
        mark(args.marks, [credit], {
          month: args.monthKey,
          binding: explained.binding,
          sub: explained.sub,
          attempt: 'carried',
          need: 1,
          counts: explained.counts,
        });
      }
      continue;
    }
    const base = baseCents(choice.version) ?? 0;
    const assigned = assignLinkedRestaurant({
      ledger: args.state.ledger,
      credit,
      restaurantId: choice.id,
      assignedAt: args.monthNow,
      deadline,
      capacityMax: choice.version?.capacity_max_redemptions ?? 1000,
      discountCents: base,
      floor: 'carried',
    });
    if (typeof assigned === 'string') {
      if (args.score) {
        const explained = explainAttempt({
          restaurants: args.restaurants,
          ctx,
          need: 1,
          floor: 'carried',
          candidates: pool.candidates,
          usedMiles: pool.usedMiles,
        });
        const binding: GateRule = assigned === 'below_floor' ? 'carried_below_floor' : 'capacity_full';
        mark(args.marks, [credit], {
          month: args.monthKey,
          binding,
          sub: null,
          attempt: 'carried',
          need: 1,
          counts: explained.counts,
        });
      }
      continue;
    }
    recordCycle(args.state, credit.issuePeriod, choice.id);
    completeCredit(args.state.ledger, credit, args.monthNow, 'verify_on_assign');
    args.marks.delete(credit.id);
  }

  const pending = issued.filter((credit) => credit.status === 'pending' && !credit.challengeItemId);
  const pairDeadline = plusAssignmentHours(args.monthNow);
  const pairCtx = makeCtx({
    marketId: args.marketId,
    member: args.state.member,
    now: args.monthNow,
    deadline: pairDeadline,
    ledger: args.state.ledger,
    cycles: args.state.cycles,
    skipOffer: args.skipOffer,
    cutoffCache: args.cutoffCache,
  });
  const pairPool = selectPool({ restaurants: args.restaurants, ctx: pairCtx, need: 2 });
  const priced = pairPool.candidates
    .filter((restaurant) => passesCapacity(restaurant, pairCtx))
    .map((restaurant) => ({
      ...restaurant,
      baseCents: baseCents(restaurant.version),
    }));
  const pair = pickFloorPair(priced, {
    shuffle: args.shuffle,
    floorCents: PAIR_FLOOR_CENTS,
    reserveCocktail: args.state.member.wantsCocktailExperience,
  });

  if (!pair || pending.length < 2) {
    if (args.score && pending.length > 0) {
      const explained = explainAttempt({
        restaurants: args.restaurants,
        ctx: pairCtx,
        need: 2,
        floor: 'pair',
        candidates: pairPool.candidates,
        usedMiles: pairPool.usedMiles,
      });
      mark(args.marks, pending, {
        month: args.monthKey,
        binding: explained.binding,
        sub: explained.sub,
        attempt: 'pair',
        need: 2,
        counts: explained.counts,
      });
    }
    return;
  }

  const [left, right] = pair;
  const slot1 = pending.find((credit) => credit.slot === 1);
  const slot2 = pending.find((credit) => credit.slot === 2);
  const failed: SimCredit[] = [];
  const assignments: Array<{ credit: SimCredit; restaurant: GateRestaurant }> = [];
  if (slot1) assignments.push({ credit: slot1, restaurant: left });
  if (slot2) assignments.push({ credit: slot2, restaurant: right });
  for (const assignment of assignments) {
    const base = baseCents(assignment.restaurant.version) ?? 0;
    const assigned = assignLinkedRestaurant({
      ledger: args.state.ledger,
      credit: assignment.credit,
      restaurantId: assignment.restaurant.id,
      assignedAt: args.monthNow,
      deadline: pairDeadline,
      capacityMax: assignment.restaurant.version?.capacity_max_redemptions ?? 1000,
      discountCents: base,
      floor: 'checked',
    });
    if (typeof assigned === 'string') failed.push(assignment.credit);
    else {
      recordCycle(args.state, assignment.credit.issuePeriod, assignment.restaurant.id);
      completeCredit(args.state.ledger, assignment.credit, args.monthNow, 'verify_on_assign');
      args.marks.delete(assignment.credit.id);
    }
  }
  if (args.score && failed.length > 0) {
    const explained = explainAttempt({
      restaurants: args.restaurants,
      ctx: pairCtx,
      need: 2,
      floor: 'pair',
      candidates: pairPool.candidates,
      usedMiles: pairPool.usedMiles,
    });
    mark(args.marks, failed, {
      month: args.monthKey,
      binding: 'capacity_full',
      sub: null,
      attempt: 'pair',
      need: 2,
      counts: explained.counts,
    });
  }
}

function personaKey(member: SupplyGateMember): string {
  return `${member.persona}/${member.tenure}`;
}

export function runSupplyGateTrial(args: {
  snapshot: SupplySnapshot;
  seed: number;
  restaurants?: GateRestaurant[];
  cutoffCache?: CooldownCutoffCache;
}): SupplyGateTrial {
  resetSupplyIds(0);
  const cutoffCache = args.cutoffCache ?? createCooldownCutoffCache();
  const restaurants = args.restaurants ?? buildRestaurants(args.snapshot);
  const marketId = args.snapshot.launch_market.id;
  const m0 = firstScoredMonth(new Date(args.snapshot.exported_at));
  const scored = scoredMonthList(m0);
  const warmup = [6, 5, 4, 3, 2, 1].map((back) => shiftMonthStart(m0, -back));
  const shuffle = createSeededShuffle(args.seed);
  const shared: SupplyLedger['reservations'] = [];
  const states: MemberState[] = SUPPLY_GATE_COHORT.map((member) => {
    const ledger = createLedger();
    if (member.tenure === 'new') ledger.reservations = shared;
    return { member, ledger, cycles: [], monthsRun: 0 };
  });
  const marks = new Map<string, FailureMark>();
  const carriedMatchIds = new Set<string>();

  for (const monthKey of warmup) {
    const monthNow = monthInstant(monthKey);
    for (const state of states) {
      if (state.member.tenure !== 'tenured') continue;
      if (state.member.wantsCocktailExperience || state.member.swaps !== 0) {
        throw new Error('cohort flag drifted');
      }
      runMemberMonth({
        state,
        restaurants,
        marketId,
        monthNow,
        monthKey,
        shuffle,
        skipOffer: true,
        marks,
        score: false,
        cutoffCache,
      });
    }
  }

  for (const state of states) {
    if (state.member.tenure !== 'tenured') continue;
    state.ledger.credits = [];
    state.ledger.items = [];
    state.ledger.reservations = shared;
  }
  marks.clear();

  for (const monthKey of scored) {
    const monthNow = monthInstant(monthKey);
    for (const state of states) {
      const before = new Set(
        state.ledger.credits.filter((credit) => credit.challengeItemId).map((credit) => credit.id),
      );
      runMemberMonth({
        state,
        restaurants,
        marketId,
        monthNow,
        monthKey,
        shuffle,
        skipOffer: false,
        marks,
        score: true,
        cutoffCache,
      });
      for (const credit of state.ledger.credits) {
        if (!credit.challengeItemId || before.has(credit.id)) continue;
        if (credit.issuePeriod !== monthKey) carriedMatchIds.add(credit.id);
      }
    }
  }

  const scoredSet = new Set(scored);
  const unmatchedByMonth = new Map<string, number>();
  const unmatchedByRule = new Map<string, number>();
  const unmatchedByPersona = new Map<string, number>();
  for (const key of ['open/new', 'open/tenured', 'restricted/new', 'restricted/tenured']) {
    unmatchedByPersona.set(key, 0);
  }
  let numerator = 0;
  let matchedViaCarry = 0;
  const funnelKeys = new Set<string>();
  const funnel: string[] = [];

  for (const state of states) {
    for (const credit of state.ledger.credits) {
      if (!scoredSet.has(credit.issuePeriod)) continue;
      if (credit.challengeItemId) {
        numerator += 1;
        if (carriedMatchIds.has(credit.id)) matchedViaCarry += 1;
        continue;
      }
      const issue = ym(credit.issuePeriod);
      unmatchedByMonth.set(issue, (unmatchedByMonth.get(issue) ?? 0) + 1);
      const failure = marks.get(credit.id);
      const rule = failure?.binding ?? 'pair_below_floor';
      unmatchedByRule.set(rule, (unmatchedByRule.get(rule) ?? 0) + 1);
      const persona = personaKey(state.member);
      unmatchedByPersona.set(persona, (unmatchedByPersona.get(persona) ?? 0) + 1);
      if (!failure) continue;
      const counts = failure.counts;
      const sub = failure.sub ? ` sub=${failure.sub}` : '';
      const line = `funnel month=${ym(failure.month)} persona=${persona} zip=${state.member.zip} seed=${args.seed} attempt=${failure.attempt} active=${counts.active} market=${counts.market} offer_version=${counts.offerVersion} selectable=${counts.selectable} coords=${counts.coords} dietary=${counts.dietary} allergy=${counts.allergy} cuisine=${counts.cuisine} cooldown=${counts.cooldown} capacity=${counts.capacity} distance=${counts.distance} variety=${counts.variety} floor=${counts.floor} need=${failure.need} binding=${failure.binding}${sub}`;
      if (funnelKeys.has(line)) continue;
      funnelKeys.add(line);
      funnel.push(line);
    }
  }
  funnel.sort();

  return {
    seed: args.seed,
    numerator,
    matchedViaCarry,
    unmatchedByMonth,
    unmatchedByRule,
    unmatchedByPersona,
    funnel,
  };
}

function staticEligible(args: {
  restaurants: GateRestaurant[];
  member: SupplyGateMember;
  marketId: string;
  now: Date;
  miles: number;
}): GateRestaurant[] {
  const origin = originFromZip(args.member.zip);
  if (!origin) return [];
  const deadline = plusAssignmentHours(args.now);
  const ctx = makeCtx({
    marketId: args.marketId,
    member: args.member,
    now: args.now,
    deadline,
    ledger: createLedger(),
    cycles: [],
    skipOffer: false,
  });
  return args.restaurants.filter((restaurant) => {
    if (!passesMarket(restaurant, ctx)) return false;
    if (!restaurant.version) return false;
    if (!passesSelectable(restaurant, ctx)) return false;
    if (!passesTiers(restaurant, ctx)) return false;
    if (!hasCoords(restaurant)) return false;
    if (!passesDietary(restaurant, ctx)) return false;
    if (!passesAllergy(restaurant, ctx)) return false;
    if (!passesCuisine(restaurant, ctx)) return false;
    return withinMiles(restaurant, origin.lat, origin.lon, args.miles);
  });
}

function duplicateLabel(restaurants: GateRestaurant[]): string {
  const pairs = new Set<string>();
  const byPoint = new Map<string, string[]>();
  for (const restaurant of restaurants) {
    if (restaurant.lat == null || restaurant.lon == null) continue;
    const key = `${restaurant.lat.toFixed(4)},${restaurant.lon.toFixed(4)}`;
    const list = byPoint.get(key) ?? [];
    list.push(restaurant.slug ?? restaurant.id);
    byPoint.set(key, list);
  }
  for (const names of byPoint.values()) {
    const unique = [...new Set(names)].sort();
    for (let i = 0; i < unique.length; i += 1) {
      for (let j = i + 1; j < unique.length; j += 1) {
        const left = unique[i];
        const right = unique[j];
        if (left && right) pairs.add(`${left}+${right}`);
      }
    }
  }
  const slugs = new Set(restaurants.map((restaurant) => restaurant.slug).filter((slug): slug is string => Boolean(slug)));
  for (const slug of slugs) {
    if (slugs.has(`${slug}-2`)) pairs.add(`${slug}+${slug}-2`);
  }
  if (pairs.size === 0) return 'none';
  return [...pairs].sort().join(',');
}

function catalogLine(args: {
  restaurants: GateRestaurant[];
  now: Date;
  marketId: string;
}): string {
  const deadline = plusAssignmentHours(args.now);
  let selectable = 0;
  let noVersion = 0;
  let legacyOnly = 0;
  let notSelectable = 0;
  let missing = 0;
  for (const restaurant of args.restaurants) {
    if (!restaurant.version) {
      noVersion += 1;
      if (restaurant.legacy) legacyOnly += 1;
    } else if (offerVersionCoversDeadline(restaurant.version, args.now, deadline) && baseCents(restaurant.version) != null) {
      selectable += 1;
    } else {
      notSelectable += 1;
    }
    if (!hasCoords(restaurant)) missing += 1;
  }
  const duplicates = duplicateLabel(args.restaurants);
  return `catalog selectable_offer_version=${selectable} no_offer_version=${noVersion} legacy_offer_only=${legacyOnly} not_selectable=${notSelectable} missing_coordinates=${missing} possible_duplicates=${duplicates}`;
}

function minSpendDistribution(snapshot: SupplySnapshot): Record<string, number> {
  const counts = new Map<string, number>();
  const bump = (cents: number | null) => {
    if (cents == null || !Number.isFinite(cents)) return;
    const key = String(cents);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (const version of snapshot.offer_versions) {
    const sealed = lowestSealedBase(tiersJson(version.tiers));
    bump(sealed?.min_spend_cents ?? null);
  }
  for (const offer of snapshot.legacy_offers) {
    if (offer.active !== true) continue;
    bump(offer.min_spend_cents);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => Number(a[0]) - Number(b[0])));
}

function shortfallKind(persona: GatePersona, windowEndLabel: string): string {
  const requirement = `published selectable offer version valid >= ${windowEndLabel}+840h`;
  if (persona === 'open') return requirement;
  return `${requirement}; vegan-compatible, no peanut, not italian`;
}

function shortfallLines(args: {
  restaurants: GateRestaurant[];
  marketId: string;
  windowEnd: Date;
  windowEndLabel: string;
}): SupplyGateShortfall[] {
  const seen = new Set<string>();
  const lines: SupplyGateShortfall[] = [];
  for (const member of SUPPLY_GATE_COHORT) {
    const key = `${member.persona}:${member.zip}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const eligibleArgs = {
      restaurants: args.restaurants,
      marketId: args.marketId,
      now: args.windowEnd,
      member,
    };
    const at5 = staticEligible({ ...eligibleArgs, miles: 5 });
    const at15 = staticEligible({ ...eligibleArgs, miles: 15 });
    const base1000 = at15.filter((restaurant) => (baseCents(restaurant.version) ?? 0) >= 1000).length;
    const base2000 = at15.filter((restaurant) => (baseCents(restaurant.version) ?? 0) >= 2000).length;
    lines.push({
      persona: member.persona,
      zip: member.zip,
      eligibleStatic5: at5.length,
      eligibleStatic15: at15.length,
      neededDistinct6mo: 12,
      baseAtLeast1000: base1000,
      baseAtLeast2000: base2000,
      addAtLeast: Math.max(0, 12 - at15.length),
      kind: shortfallKind(member.persona, args.windowEndLabel),
    });
  }
  return lines;
}

function sumCountMaps(maps: Array<Map<string, number>>): Map<string, number> {
  const total = new Map<string, number>();
  for (const map of maps) {
    for (const [key, count] of map) total.set(key, (total.get(key) ?? 0) + count);
  }
  return total;
}

function formatSplitCounts(
  all: Map<string, number>,
  worst: Map<string, number>,
  order: 'month' | 'rule' | 'persona',
  worstSeed: number,
): string {
  return `${formatCountMap(all, order)} (all trials) | worst seed=${worstSeed}: ${formatCountMap(worst, order)}`;
}

function formatCountMap(map: Map<string, number>, order: 'month' | 'rule' | 'persona'): string {
  if (order === 'persona') {
    const keys = ['open/new', 'open/tenured', 'restricted/new', 'restricted/tenured'];
    return keys.map((key) => `${key}=${map.get(key) ?? 0}`).join(' ');
  }
  const entries = [...map.entries()];
  if (entries.length === 0) return 'none';
  if (order === 'month') {
    entries.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  } else {
    entries.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
  return entries.map(([key, count]) => `${key}=${count}`).join(' ');
}

export function formatSupplyGateReport(result: Omit<SupplyGateResult, 'text'> & { text?: string }): string {
  const lines = [
    '=== E02 supply gate (D2=B, threshold=100%) ===',
    `snapshot exported_at=${result.exportedAt} (${result.exportedAtCt} CT) market=mckinney-tx active_restaurants=${result.activeRestaurants}`,
    result.catalogLine,
    `window=${result.windowLabel} cohort=16 (4 zips x open/restricted x new/tenured) trials=${result.seeds.length} seeds=${result.seeds[0]}..${result.seeds[result.seeds.length - 1]}`,
    `result=${result.result} matched_min=${result.matchedMin}/${SUPPLY_GATE_DENOMINATOR} matched_via_carry=${result.matchedViaCarry} worst_seed=${result.worstSeed} trials_failed=${result.trialsFailed}/${result.seeds.length}`,
    `unmatched_by_month ${formatSplitCounts(result.unmatchedByMonthAll, result.unmatchedByMonth, 'month', result.worstSeed)}`,
    `unmatched_by_rule ${formatSplitCounts(result.unmatchedByRuleAll, result.unmatchedByRule, 'rule', result.worstSeed)}`,
    `unmatched_by_persona ${formatSplitCounts(result.unmatchedByPersonaAll, result.unmatchedByPersona, 'persona', result.worstSeed)}`,
    ...result.funnel,
    ...result.shortfall.map(
      (row) =>
        `shortfall persona=${row.persona} zip=${row.zip} eligible_static_5mi=${row.eligibleStatic5} eligible_static_15mi=${row.eligibleStatic15} needed_distinct_6mo=12 base>=1000=${row.baseAtLeast1000} base>=2000=${row.baseAtLeast2000} add_at_least=${row.addAtLeast} kind="${row.kind}" lower bound`,
    ),
    result.result === 'PASS'
      ? 'PASS: E02 supply gate'
      : `FAIL: E02 supply gate (${SUPPLY_GATE_DENOMINATOR - result.matchedMin} unmatched credits)`,
  ];
  return `${lines.join('\n')}\n`;
}

export function runSupplyGate(args: { snapshot: SupplySnapshot; seeds: number[] }): SupplyGateResult {
  if (args.seeds.length === 0) throw new Error('E02 supply gate: no seeds');
  const restaurants = buildRestaurants(args.snapshot);
  const exported = new Date(args.snapshot.exported_at);
  const m0 = firstScoredMonth(exported);
  const months = scoredMonthList(m0);
  const m5 = months[5] ?? m0;
  const cutoffCache = createCooldownCutoffCache();
  const trials = args.seeds.map((seed) =>
    runSupplyGateTrial({ snapshot: args.snapshot, seed, restaurants, cutoffCache }),
  );
  let worst = trials[0];
  if (!worst) throw new Error('E02 supply gate: no trials');
  for (const trial of trials) {
    if (trial.numerator < worst.numerator || (trial.numerator === worst.numerator && trial.seed < worst.seed)) {
      worst = trial;
    }
  }
  const trialsFailed = trials.filter((trial) => trial.numerator !== SUPPLY_GATE_DENOMINATOR).length;
  const result: 'PASS' | 'FAIL' =
    trialsFailed === 0 && worst.numerator === SUPPLY_GATE_DENOMINATOR ? 'PASS' : 'FAIL';
  const now = monthInstant(m0);
  const partial = {
    result,
    exportedAt: exported.toISOString(),
    exportedAtCt: formatCt(exported),
    activeRestaurants: restaurants.length,
    catalogLine: catalogLine({ restaurants, now, marketId: args.snapshot.launch_market.id }),
    windowLabel: `${ym(m0)}..${ym(m5)}`,
    m0,
    m5,
    seeds: args.seeds,
    matchedMin: worst.numerator,
    worstSeed: worst.seed,
    trialsFailed,
    matchedViaCarry: worst.matchedViaCarry,
    unmatchedByMonth: worst.unmatchedByMonth,
    unmatchedByRule: worst.unmatchedByRule,
    unmatchedByPersona: worst.unmatchedByPersona,
    unmatchedByMonthAll: sumCountMaps(trials.map((trial) => trial.unmatchedByMonth)),
    unmatchedByRuleAll: sumCountMaps(trials.map((trial) => trial.unmatchedByRule)),
    unmatchedByPersonaAll: sumCountMaps(trials.map((trial) => trial.unmatchedByPersona)),
    funnel: worst.funnel,
    shortfall: shortfallLines({
      restaurants,
      marketId: args.snapshot.launch_market.id,
      windowEnd: monthInstant(m5),
      windowEndLabel: ym(m5),
    }),
    minSpendDistribution: minSpendDistribution(args.snapshot),
    trials,
  };
  return { ...partial, text: formatSupplyGateReport(partial) };
}

export function supplyGateJson(result: SupplyGateResult): string {
  const payload = {
    text: result.text,
    result: result.result,
    exported_at: result.exportedAt,
    exported_at_ct: result.exportedAtCt,
    active_restaurants: result.activeRestaurants,
    window: result.windowLabel,
    seeds: result.seeds,
    matched_min: result.matchedMin,
    denominator: SUPPLY_GATE_DENOMINATOR,
    matched_via_carry: result.matchedViaCarry,
    worst_seed: result.worstSeed,
    trials_failed: result.trialsFailed,
    unmatched_by_month: {
      all_trials: Object.fromEntries([...result.unmatchedByMonthAll.entries()].sort()),
      worst: Object.fromEntries([...result.unmatchedByMonth.entries()].sort()),
    },
    unmatched_by_rule: {
      all_trials: Object.fromEntries(
        [...result.unmatchedByRuleAll.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
      ),
      worst: Object.fromEntries(
        [...result.unmatchedByRule.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
      ),
    },
    unmatched_by_persona: {
      all_trials: Object.fromEntries(
        ['open/new', 'open/tenured', 'restricted/new', 'restricted/tenured'].map((key) => [
          key,
          result.unmatchedByPersonaAll.get(key) ?? 0,
        ]),
      ),
      worst: Object.fromEntries(
        ['open/new', 'open/tenured', 'restricted/new', 'restricted/tenured'].map((key) => [
          key,
          result.unmatchedByPersona.get(key) ?? 0,
        ]),
      ),
    },
    funnel: result.funnel,
    shortfall: result.shortfall,
    min_spend_distribution: result.minSpendDistribution,
    per_trial: result.trials.map((trial) => ({
      seed: trial.seed,
      numerator: trial.numerator,
      matched_via_carry: trial.matchedViaCarry,
    })),
    pair_selector:
      'Seeded first i<j pair with base sum >= 2000, expanding one distance band when the requested radius has no qualifying pair. A gate PASS measures that floor-aware policy. generate.ts still picks two candidates at random and can receive pair_below_floor from the RPC.',
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}
