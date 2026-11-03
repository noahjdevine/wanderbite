import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectDistancePool } from '@/lib/challenges/distance-pool';
import {
  candidateRowsForPick,
  listEligibleChallengeCandidates,
  type ChallengeEligibilityContext,
  type EligibilityLegacyOffer,
  type EligibilityRestaurant,
  type EligibilityVersion,
} from '@/lib/challenges/eligible-candidates';
import { filterCarriedAssignCandidates } from '@/lib/challenges/carried-assign-pool';
import { offerVersionCoversDeadline } from '@/lib/challenges/challenge-deadline';
import {
  passesRestaurantHardFilters,
  redemptionCooldownOk,
  subMonthsChicago,
  type CooldownRedemption,
} from '@/lib/challenges/restaurant-safety';
import { getDietaryConflict, hasAllergyConflict } from '@/lib/dietary-utils';
import { restaurantHasExcludedCuisine } from '@/lib/cuisines';
import { chicagoMonthStart } from '@/lib/cron-period';
import { LAUNCH_MARKET, haversineMiles } from '@/lib/launch-market';
import { meetsMinimumCreditBase } from '@/lib/offers/credit-floor';
import { restaurantBaseCents } from '@/lib/offers/restaurant-base-cents';
import { lowestSealedBase } from '@/lib/offers/sealed-base';
import {
  passesVersionCapacityPrefilter,
  type VersionCapacityFields,
} from '@/lib/offers/version-capacity';

const ROOT = path.resolve(__dirname, '../../..');
const ORIGIN = LAUNCH_MARKET.zipCentroids['75070'];
const NOW = new Date('2026-10-15T15:00:00.000Z');
const COVER_UNTIL = '2030-01-01T00:00:00.000Z';

const rpcCalls = vi.hoisted(() => ({ args: [] as unknown[] }));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => queryBuilder(table),
    rpc: (...args: unknown[]) => {
      rpcCalls.args.push(args);
      return Promise.resolve({ data: null, error: { message: 'rpc should not run' } });
    },
  }),
}));

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function north(miles: number): { lat: number; lon: number } {
  return { lat: ORIGIN.lat + miles / 69, lon: ORIGIN.lon };
}

function legacyOffer(
  restaurantId: string,
  discount = 2000,
  max = 10,
): EligibilityLegacyOffer {
  return {
    id: `offer-${restaurantId}`,
    restaurant_id: restaurantId,
    discount_amount_cents: discount,
    min_spend_cents: 5000,
    max_redemptions_per_month: max,
    active: true,
  };
}

function place(
  id: string,
  miles: number,
  cuisine: string[] = ['thai'],
  versionId: string | null = null,
): EligibilityRestaurant {
  const point = miles === 0 ? ORIGIN : north(miles);
  return {
    id,
    name: id,
    cuisine_tags: cuisine,
    lat: point.lat,
    lon: point.lon,
    current_offer_version_id: versionId,
  };
}

function versionRow(
  restaurantId: string,
  overrides: Partial<EligibilityVersion> = {},
): EligibilityVersion {
  return {
    id: `v-${restaurantId}`,
    restaurant_id: restaurantId,
    valid_from: '2020-01-01T00:00:00.000Z',
    valid_until: COVER_UNTIL,
    withdrawn_from_selection_at: null,
    tiers: [{ threshold_cents: 5000, discount_cents: 2000 }],
    capacity_timezone: 'America/Chicago',
    capacity_max_redemptions: 5,
    ...overrides,
  };
}

function visit(restaurantId: string, at: string): CooldownRedemption {
  return {
    restaurant_id: restaurantId,
    status: 'verified',
    verified_at: at,
    created_at: at,
  };
}

function monthlyContext(
  overrides: Partial<ChallengeEligibilityContext> = {},
): ChallengeEligibilityContext {
  return {
    mode: 'monthly',
    versionsById: new Map(),
    legacyOffersByRestaurant: new Map(),
    now: NOW,
    deadline: new Date('2026-11-19T15:00:00.000Z'),
    allergyFlags: [],
    dietaryFlags: [],
    excludedCuisineIds: [],
    redemptions: [],
    ...overrides,
  };
}

type OfferRestaurant = EligibilityRestaurant & {
  baseCents: number | null;
};

function withBase(restaurant: EligibilityRestaurant, offers: ReadonlyMap<string, EligibilityLegacyOffer>, versions: ReadonlyMap<string, EligibilityVersion>): OfferRestaurant {
  const versionId = restaurant.current_offer_version_id ?? null;
  return {
    ...restaurant,
    baseCents: restaurantBaseCents({
      currentOfferVersionId: versionId,
      versionTiers: versionId ? versions.get(versionId)?.tiers ?? null : null,
      legacyOffer: offers.get(restaurant.id) ?? null,
    }),
  };
}

/** Today's generate passesHard, copied here as the parity oracle. */
function legacyMonthlyIds(args: {
  restaurants: EligibilityRestaurant[];
  offers: ReadonlyMap<string, EligibilityLegacyOffer>;
  versions: ReadonlyMap<string, EligibilityVersion & VersionCapacityFields>;
  capacity: ReadonlyMap<string, ReadonlyMap<string, number>>;
  redemptions: CooldownRedemption[];
  swappedOut?: ReadonlySet<string>;
  monthCounts?: ReadonlyMap<string, number>;
  passesVariety?: (restaurant: EligibilityRestaurant) => boolean;
  passesRelaxedVariety?: (restaurant: EligibilityRestaurant) => boolean;
  requiredCount?: number;
  requestedMiles?: number;
  dietaryFlags?: string[] | null;
  allergyFlags?: string[] | null;
  excludedCuisineIds?: string[];
  now?: Date;
}) {
  const now = args.now ?? NOW;
  const withOffer = args.restaurants.filter(
    (restaurant) =>
      Boolean(restaurant.current_offer_version_id) || args.offers.has(restaurant.id),
  );
  const pool = selectDistancePool({
    restaurants: withOffer.map((restaurant) => withBase(restaurant, args.offers, args.versions)),
    origin: ORIGIN,
    requestedMiles: args.requestedMiles ?? 5,
    requiredCount: args.requiredCount ?? 2,
    passesHard: (restaurant) => {
      if (getDietaryConflict(restaurant.cuisine_tags, args.dietaryFlags ?? [])) return false;
      if (hasAllergyConflict(restaurant.cuisine_tags, args.allergyFlags ?? [])) return false;
      if (
        restaurantHasExcludedCuisine({
          restaurantCuisineTags: restaurant.cuisine_tags,
          excludedCuisineIds: args.excludedCuisineIds ?? [],
        })
      ) {
        return false;
      }
      if (args.swappedOut?.has(restaurant.id)) return false;
      const versionId = restaurant.current_offer_version_id ?? null;
      const versionBound = Boolean(versionId);
      const offer = args.offers.get(restaurant.id);
      if (!versionBound && !offer) return false;
      if (!versionBound && offer) {
        const monthCount = args.monthCounts?.get(restaurant.id) ?? 0;
        if (monthCount >= offer.max_redemptions_per_month) return false;
      }
      if (
        versionBound &&
        !passesVersionCapacityPrefilter({
          restaurantId: restaurant.id,
          currentOfferVersionId: versionId,
          version: versionId ? args.versions.get(versionId) ?? null : null,
          now,
          countsByBucket: args.capacity.get(restaurant.id) ?? new Map(),
        })
      ) {
        return false;
      }
      if (!meetsMinimumCreditBase(restaurant.baseCents)) return false;
      return redemptionCooldownOk(restaurant.id, args.redemptions, now);
    },
    passesVariety: args.passesVariety ?? (() => true),
    passesRelaxedVariety: args.passesRelaxedVariety ?? (() => true),
  });
  return pool;
}

function serviceIds(
  restaurants: readonly EligibilityRestaurant[],
  context: ChallengeEligibilityContext,
  extra: {
    requiredCount?: number;
    requestedMiles?: number;
    duplicateRestaurantIds?: ReadonlySet<string>;
    passesVariety?: (restaurant: EligibilityRestaurant) => boolean;
    passesRelaxedVariety?: (restaurant: EligibilityRestaurant) => boolean;
  } = {},
) {
  return listEligibleChallengeCandidates({
    context,
    restaurants,
    origin: ORIGIN,
    requestedMiles: extra.requestedMiles ?? 5,
    requiredCount: extra.requiredCount ?? 2,
    duplicateRestaurantIds: extra.duplicateRestaurantIds,
    passesVariety: extra.passesVariety,
    passesRelaxedVariety: extra.passesRelaxedVariety,
  });
}

describe('eligible challenge candidates', () => {
  it('counts each hard-rule rejection and keeps two distinct keepers', () => {
    const keepA = place('keep-a', 0);
    const keepB = place('keep-b', 0, ['mexican']);
    const noOffer = place('no-offer', 0, ['cafe']);
    const belowFloor = place('below-floor', 0, ['seafood']);
    const monthFull = place('month-full', 0, ['pizza']);
    const cooldown = place('cooldown', 0, ['indian']);
    const excluded = place('excluded', 0, ['bbq']);
    const duplicate = place('duplicate', 0, ['tapas']);
    const swapped = place('swapped', 0, ['cafe']);
    const far = place('far', 30, ['korean']);
    const withdrawn = place('withdrawn', 0, ['french'], 'v-withdrawn');
    const capFull = place('cap-full', 0, ['japanese'], 'v-cap-full');
    const restaurants = [
      keepA,
      keepB,
      noOffer,
      belowFloor,
      monthFull,
      cooldown,
      excluded,
      duplicate,
      swapped,
      far,
      withdrawn,
      capFull,
    ];
    const offers = new Map<string, EligibilityLegacyOffer>([
      [keepA.id, legacyOffer(keepA.id)],
      [keepB.id, legacyOffer(keepB.id)],
      [belowFloor.id, legacyOffer(belowFloor.id, 500)],
      [monthFull.id, legacyOffer(monthFull.id, 2000, 1)],
      [cooldown.id, legacyOffer(cooldown.id)],
      [excluded.id, legacyOffer(excluded.id)],
      [duplicate.id, legacyOffer(duplicate.id)],
      [swapped.id, legacyOffer(swapped.id)],
      [far.id, legacyOffer(far.id)],
    ]);
    const versions = new Map<string, EligibilityVersion>([
      ['v-withdrawn', versionRow('withdrawn', { id: 'v-withdrawn', withdrawn_from_selection_at: '2026-01-01T00:00:00.000Z' })],
      ['v-cap-full', versionRow('cap-full', { id: 'v-cap-full', capacity_max_redemptions: 0 })],
    ]);
    const context = monthlyContext({
      legacyOffersByRestaurant: offers,
      versionsById: versions,
      redemptions: [visit('cooldown', '2026-09-01T00:00:00.000Z')],
      dietaryFlags: ['vegan'],
      swappedOutRestaurantIds: new Set(['swapped']),
      legacyMonthCounts: new Map([['month-full', 1]]),
      capacityCountsByRestaurant: new Map(),
    });
    const listed = serviceIds(restaurants, context, {
      duplicateRestaurantIds: new Set(['duplicate']),
    });

    expect(listed.rejections.no_offer_version).toBeGreaterThanOrEqual(1);
    expect(listed.rejections.capacity).toBeGreaterThanOrEqual(1);
    expect(listed.rejections.cooldown).toBe(1);
    expect(listed.rejections.exclusion).toBe(2);
    expect(listed.rejections.distance).toBe(1);
    expect(listed.rejections.credit_floor).toBe(1);
    expect(listed.rejections.duplicate).toBe(1);
    expect(listed.candidates.map((row) => row.restaurantId)).toEqual(['keep-a', 'keep-b']);
    expect(new Set(listed.candidates.map((row) => row.restaurantId)).size).toBe(2);
    expect(listed.candidates.every((row) => row.baseSavingsCents >= 1000)).toBe(true);
    expect(listed.candidates.every((row) => row.zipDistanceExpanded === false)).toBe(true);
    expect(listed.candidates.every((row) => row.distanceTier === 'requested')).toBe(true);
    expect(listed.distance.expanded).toBe(false);
    for (const id of ['no-offer', 'below-floor', 'month-full', 'cooldown', 'excluded', 'duplicate', 'swapped', 'far', 'withdrawn', 'cap-full']) {
      expect(listed.candidates.map((row) => row.restaurantId)).not.toContain(id);
    }
  });

  it('matches generate, swap, and carried-assign picks and the ZIP expansion flag', () => {
    const near = place('near', 0, ['thai'], 'v-near');
    const other = place('other', 1, ['mexican'], 'v-other');
    const expandedOnly = place('expanded-only', 10, ['indian'], 'v-expanded');
    const below = place('below', 0, ['seafood']);
    const capped = place('capped', 0, ['pizza']);
    const restaurants = [near, other, expandedOnly, below, capped];
    const versions = new Map<string, EligibilityVersion & VersionCapacityFields>([
      ['v-near', versionRow('near', { id: 'v-near' }) as EligibilityVersion & VersionCapacityFields],
      ['v-other', versionRow('other', { id: 'v-other' }) as EligibilityVersion & VersionCapacityFields],
      ['v-expanded', versionRow('expanded-only', { id: 'v-expanded' }) as EligibilityVersion & VersionCapacityFields],
    ]);
    const offers = new Map<string, EligibilityLegacyOffer>([
      [below.id, legacyOffer(below.id, 500)],
      [capped.id, legacyOffer(capped.id, 2000, 2)],
    ]);
    const received = new Set(['other']);
    const lastMonth = new Set<string>();
    const passesVariety = (restaurant: EligibilityRestaurant) => !received.has(restaurant.id);
    const passesRelaxedVariety = (restaurant: EligibilityRestaurant) => !lastMonth.has(restaurant.id);
    const monthly = monthlyContext({
      versionsById: versions,
      legacyOffersByRestaurant: offers,
      legacyMonthCounts: new Map([['capped', 2]]),
    });
    const legacyMonthly = legacyMonthlyIds({
      restaurants,
      offers,
      versions,
      capacity: new Map(),
      redemptions: [],
      monthCounts: new Map([['capped', 2]]),
      passesVariety,
      passesRelaxedVariety,
      requestedMiles: 5,
    });
    const serviceMonthly = serviceIds(restaurants, monthly, {
      passesVariety,
      passesRelaxedVariety,
      requestedMiles: 5,
    });
    expect(serviceMonthly.candidates.map((row) => row.restaurantId)).toEqual(
      legacyMonthly.candidates.map((row) => row.id),
    );
    expect(serviceMonthly.distance.expanded).toBe(legacyMonthly.match.expanded);
    expect(serviceMonthly.candidates.every((row) => row.zipDistanceExpanded === legacyMonthly.match.expanded)).toBe(true);
    expect(haversineMiles(ORIGIN, north(10))).toBeGreaterThan(5);
    expect(haversineMiles(ORIGIN, north(10))).toBeLessThan(15);

    const legacySwapPool = selectDistancePool({
      restaurants: restaurants.filter(
        (restaurant) => offers.has(restaurant.id) || Boolean(restaurant.current_offer_version_id),
      ),
      origin: ORIGIN,
      requestedMiles: 5,
      requiredCount: 1,
      passesHard: (restaurant) => {
        if (getDietaryConflict(restaurant.cuisine_tags, [])) return false;
        if (hasAllergyConflict(restaurant.cuisine_tags, [])) return false;
        const offer = offers.get(restaurant.id);
        const versionBound = Boolean(restaurant.current_offer_version_id);
        if (!offer && !versionBound) return false;
        if (offer && !versionBound) {
          const monthCount = restaurant.id === 'capped' ? 2 : 0;
          if (monthCount >= offer.max_redemptions_per_month) return false;
        }
        return redemptionCooldownOk(restaurant.id, [], NOW);
      },
      passesVariety: () => true,
      passesRelaxedVariety: () => true,
    });
    const legacySwap = serviceIds(restaurants, { ...monthly, mode: 'legacy_swap' }, { requiredCount: 1 });
    expect(legacySwap.candidates.map((row) => row.restaurantId)).toEqual(
      legacySwapPool.candidates.map((row) => row.id),
    );
    expect(legacySwap.candidates.map((row) => row.restaurantId)).toContain('below');
    expect(serviceMonthly.candidates.map((row) => row.restaurantId)).not.toContain('below');

    const deadline = new Date('2026-11-19T15:00:00.000Z');
    const creditInput = restaurants.flatMap((restaurant) => {
      const versionId = restaurant.current_offer_version_id;
      if (!versionId) return [];
      const version = versions.get(versionId);
      if (!version || version.restaurant_id !== restaurant.id) return [];
      if (!offerVersionCoversDeadline(version, NOW, deadline)) return [];
      const sealed = lowestSealedBase(version.tiers);
      if (!sealed || !meetsMinimumCreditBase(sealed.discount_amount_cents)) return [];
      return [restaurant];
    });
    const creditOracle = selectDistancePool({
      restaurants: creditInput,
      origin: ORIGIN,
      requestedMiles: 5,
      requiredCount: 1,
      passesHard: (restaurant) =>
        passesRestaurantHardFilters({
          cuisineTags: restaurant.cuisine_tags,
          allergyFlags: [],
          dietaryFlags: [],
          excludedCuisineIds: [],
          restaurantId: restaurant.id,
          redemptions: [],
          now: NOW,
        }),
      passesVariety: () => true,
      passesRelaxedVariety: () => true,
    });
    const credit = serviceIds(
      restaurants,
      {
        ...monthly,
        mode: 'credit_swap',
        legacyOffersByRestaurant: undefined,
        legacyMonthCounts: new Map([['near', 99]]),
        deadline,
      },
      { requiredCount: 1 },
    );
    expect(credit.candidates.map((row) => row.restaurantId)).toEqual(
      creditOracle.candidates.map((row) => row.id),
    );
    expect(credit.candidates.map((row) => row.restaurantId)).toContain('near');
    expect(credit.distance.expanded).toBe(creditOracle.match.expanded);

    const carriedRestaurants = restaurants.map((restaurant) => ({
      id: restaurant.id,
      name: restaurant.name ?? restaurant.id,
      cuisine_tags: restaurant.cuisine_tags,
      lat: restaurant.lat,
      lon: restaurant.lon,
      current_offer_version_id: restaurant.current_offer_version_id ?? null,
    }));
    const carried = filterCarriedAssignCandidates({
      restaurants: carriedRestaurants,
      versionsById: versions,
      origin: ORIGIN,
      requestedMiles: 5,
      allergyFlags: [],
      dietaryFlags: [],
      excludedCuisineIds: [],
      redemptions: [],
      now: NOW,
      deadline,
    });
    const carriedOracle = selectDistancePool({
      restaurants: creditInput,
      origin: ORIGIN,
      requestedMiles: 5,
      requiredCount: 1,
      passesHard: (restaurant) =>
        passesRestaurantHardFilters({
          cuisineTags: restaurant.cuisine_tags,
          allergyFlags: [],
          dietaryFlags: [],
          excludedCuisineIds: [],
          restaurantId: restaurant.id,
          redemptions: [],
          now: NOW,
        }),
      passesVariety: () => true,
      passesRelaxedVariety: () => true,
    });
    expect(carried.map((row) => row.id)).toEqual(carriedOracle.candidates.map((row) => row.id));
    expect(carried.map((row) => row.discount_amount_cents)).toEqual(
      carriedOracle.candidates.map(() => 2000),
    );
  });

  it('keeps the Chicago month and cooldown at 2026-11-30 23:30 Chicago', () => {
    const now = new Date('2026-12-01T05:30:00.000Z');
    expect(chicagoMonthStart(now)).toBe('2026-11-01');
    expect(subMonthsChicago(now, 6).toISOString()).toBe('2026-05-31T04:30:00.000Z');

    const kept = place('kept', 0);
    const blocked = place('blocked', 0, ['mexican']);
    const offers = new Map<string, EligibilityLegacyOffer>([
      [kept.id, legacyOffer(kept.id)],
      [blocked.id, legacyOffer(blocked.id)],
    ]);
    const listed = serviceIds([kept, blocked], monthlyContext({
      now,
      deadline: new Date(now.getTime() + 840 * 60 * 60 * 1000),
      legacyOffersByRestaurant: offers,
      redemptions: [visit('blocked', '2026-05-31T05:00:00.000Z')],
    }), { requiredCount: 1 });
    const oracle = legacyMonthlyIds({
      restaurants: [kept, blocked],
      offers,
      versions: new Map(),
      capacity: new Map(),
      redemptions: [visit('blocked', '2026-05-31T05:00:00.000Z')],
      now,
      requiredCount: 1,
    });
    expect(listed.rejections.cooldown).toBe(1);
    expect(listed.candidates.map((row) => row.restaurantId)).toEqual(['kept']);
    expect(oracle.candidates.map((row) => row.id)).toEqual(['kept']);
    expect(listed.distance.expanded).toBe(oracle.match.expanded);
  });

  it('returns fewer than two candidates without treating that list as a reservation', () => {
    const only = place('only', 0);
    const offers = new Map<string, EligibilityLegacyOffer>([[only.id, legacyOffer(only.id)]]);
    const listed = serviceIds([only], monthlyContext({ legacyOffersByRestaurant: offers }));
    expect(listed.candidates).toHaveLength(1);
    expect(listed.candidates[0]?.restaurantId).toBe('only');
    const moduleSource = source('src/lib/challenges/eligible-candidates.ts');
    expect(moduleSource).not.toMatch(/rpc\(|generate_challenge_cycle|reserve_version_buckets/);
    const generate = source('src/lib/challenges/generate.ts');
    const rpcAt = generate.indexOf("rpc(");
    expect(generate.indexOf('pool.candidates.length < CHALLENGE_ITEMS_PER_MONTH')).toBeLessThan(rpcAt);
    expect(generate.indexOf('listEligibleChallengeCandidates(')).toBeLessThan(rpcAt);
    expect(generate).toContain('candidateRowsForPick(');
    expect(source('src/app/actions/swap-challenge.ts')).toContain("mode: 'credit_swap'");
    expect(source('src/app/actions/swap-challenge.ts')).toContain("mode: 'legacy_swap'");
    expect(source('src/lib/challenges/carried-assign-pool.ts')).toContain("mode: 'carried'");
  });

  it('falls back to the caller rows when the shared order disagrees', () => {
    const service = [{ id: 'a' }, { id: 'b' }];
    const legacy = [{ id: 'a' }, { id: 'b' }];
    expect(candidateRowsForPick(service, legacy).map((row) => row.id)).toEqual(['a', 'b']);
    expect(candidateRowsForPick([{ id: 'b' }, { id: 'a' }], legacy)).toEqual(legacy);
    expect(candidateRowsForPick([{ id: 'a' }], legacy)).toEqual(legacy);
  });
});

function queryBuilder(table: string) {
  let single = false;
  const self = {
    select() {
      return self;
    },
    eq() {
      return self;
    },
    in() {
      return self;
    },
    gte() {
      return self;
    },
    lt() {
      return self;
    },
    order() {
      return self;
    },
    range() {
      return self;
    },
    limit() {
      return self;
    },
    maybeSingle() {
      single = true;
      return self;
    },
    then(resolve: (value: { data: unknown; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(queryPayload(table, single)).then(resolve, reject);
    },
  };
  return self;
}

function queryPayload(table: string, single: boolean): { data: unknown; error: null } {
  if (table === 'markets') return { data: [{ id: 'market-1' }], error: null };
  if (table === 'user_profiles') {
    return {
      data: {
        subscription_status: 'active',
        allergy_flags: [],
        dietary_flags: [],
        wants_cocktail_experience: false,
        address: null,
        address_street: '100 E Louisiana St',
        address_city: 'McKinney',
        address_state: 'TX',
        address_zip: '75070',
        distance_band: '5_mi',
      },
      error: null,
    };
  }
  if (table === 'user_preferences') return { data: { excluded_cuisines: [] }, error: null };
  if (table === 'restaurants') {
    return {
      data: [
        {
          id: 'only-restaurant',
          name: 'Only',
          cuisine_tags: ['thai'],
          address: '1 Main',
          lat: ORIGIN.lat,
          lon: ORIGIN.lon,
          status: 'active',
          market_id: 'market-1',
          org_id: 'org-1',
          google_place_id: null,
          current_offer_version_id: null,
        },
      ],
      error: null,
    };
  }
  if (table === 'restaurant_offers') {
    return {
      data: [
        {
          id: 'offer-only',
          restaurant_id: 'only-restaurant',
          discount_amount_cents: 2000,
          min_spend_cents: 5000,
          max_redemptions_per_month: 10,
          active: true,
        },
      ],
      error: null,
    };
  }
  if (table === 'challenge_cycles') return { data: single ? null : [], error: null };
  if (table === 'redemptions' || table === 'challenge_items' || table === 'offer_versions') {
    return { data: single ? null : [], error: null };
  }
  throw new Error(`unexpected table ${table}`);
}

describe('generate thin pool', () => {
  beforeEach(() => {
    rpcCalls.args.length = 0;
  });

  it('fails with today\'s thin-pool reason and does not call the assignment RPC', async () => {
    const { generateMonthlyChallengeForUser } = await import('@/lib/challenges/generate');
    const result = await generateMonthlyChallengeForUser('user-1');
    expect(result).toEqual({
      ok: false,
      reason: 'thin_pool',
      error:
        'No eligible restaurants found within your travel distance. Try a wider distance or check dietary preferences.',
    });
    expect(rpcCalls.args).toEqual([]);
  });
});
