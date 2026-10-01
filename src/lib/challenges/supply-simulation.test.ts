import { readFileSync } from 'node:fs';
import path from 'node:path';
import { subMonths } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { selectDistancePool } from '@/lib/challenges/distance-pool';
import {
  bucketsHaveCapacity,
  bucketsIntersectingDeadline,
  capacityCounts,
  carriedAssignDeadline,
  chicagoMidnight,
  createLedger,
  plusAssignmentHours,
  reserveBuckets,
  settleItem,
  tierExpiresAt,
} from '@/lib/challenges/supply-simulation-lifecycle';
import { getDietaryConflict, hasAllergyConflict } from '@/lib/dietary-utils';
import { restaurantHasExcludedCuisine } from '@/lib/cuisines';
import { haversineMiles, originFromZip } from '@/lib/launch-market';
import {
  passesRestaurantHardFilters,
  redemptionCooldownOk,
} from '@/lib/challenges/restaurant-safety';
import {
  CEILING_EXPANSION_CONFIG,
  COVERAGE_CONFIG,
  THIN_CATALOG_CONFIG,
  finalItemSpendCents,
  runCarryPressure,
  runSimulatedSupplyMonths,
  seededMatchRate,
  selectorReason,
  simulatedMatchRate,
  supplyRestaurant,
  SUPPLY_MARKET_ID,
  SUPPLY_RESTAURANTS,
  type SupplyRestaurant,
} from '@/lib/challenges/supply-simulation';

const ROOT = path.resolve(__dirname, '../../..');
const NOW = new Date('2026-09-30T16:00:00.000Z');

function memberReason(
  restaurant: Pick<SupplyRestaurant, 'marketId' | 'cuisineTags' | 'id' | 'thresholdCents' | 'discountCents'>,
  patch: { dietaryFlags?: string[]; allergyFlags?: string[]; excludedCuisineIds?: string[]; ceiling?: number } = {},
) {
  return selectorReason({
    restaurant,
    marketId: SUPPLY_MARKET_ID,
    dietaryFlags: patch.dietaryFlags ?? [],
    allergyFlags: patch.allergyFlags ?? [],
    excludedCuisineIds: patch.excludedCuisineIds ?? [],
    redemptions: [],
    now: NOW,
    maxQualifyingSpendCents: patch.ceiling ?? 4000,
  });
}

describe('supply simulation helpers', () => {
  it('reads dietary_exclusion from getDietaryConflict', () => {
    const tags = ['cheese'];
    const flags = ['vegan'];
    expect(getDietaryConflict(tags, flags)?.conflictingTags).toContain('cheese');
    expect(
      memberReason(
        { ...supplyRestaurant('cheese'), cuisineTags: tags },
        { dietaryFlags: flags },
      ),
    ).toBe('dietary_exclusion');
  });

  it('reads allergy from hasAllergyConflict', () => {
    const tags = ['peanut'];
    const flags = ['peanut'];
    expect(hasAllergyConflict(tags, flags)).toBe(true);
    expect(
      memberReason(
        { ...supplyRestaurant('peanut'), cuisineTags: tags },
        { allergyFlags: flags },
      ),
    ).toBe('allergy');
  });

  it('reads excluded_cuisine from restaurantHasExcludedCuisine', () => {
    const tags = ['pasta'];
    expect(
      restaurantHasExcludedCuisine({
        restaurantCuisineTags: tags,
        excludedCuisineIds: ['italian'],
      }),
    ).toBe(true);
    expect(
      memberReason(
        { ...supplyRestaurant('pasta'), cuisineTags: tags },
        { excludedCuisineIds: ['italian'] },
      ),
    ).toBe('excluded_cuisine');
  });

  it('applies a twelve-month cooldown with subMonths', () => {
    const restaurantId = 'restaurant-1';
    const visit = (months: number) => ({
      restaurant_id: restaurantId,
      status: 'verified',
      verified_at: subMonths(NOW, months).toISOString(),
      created_at: subMonths(NOW, months).toISOString(),
    });
    expect(redemptionCooldownOk(restaurantId, [visit(6)], NOW)).toBe(false);
    expect(redemptionCooldownOk(restaurantId, [visit(7), visit(11)], NOW)).toBe(false);
    expect(redemptionCooldownOk(restaurantId, [visit(13), visit(14)], NOW)).toBe(true);
    expect(
      passesRestaurantHardFilters({
        cuisineTags: ['salad'],
        allergyFlags: [],
        dietaryFlags: [],
        excludedCuisineIds: [],
        restaurantId,
        redemptions: [visit(13), visit(14)],
        now: NOW,
      }),
    ).toBe(true);
  });

  it('records spending_ceiling when the lowest threshold is above the ceiling', () => {
    expect(memberReason(supplyRestaurant('OB1'), { ceiling: 4000 })).toBe('spending_ceiling');
    expect(memberReason(supplyRestaurant('S01'), { ceiling: 4000 })).toBeNull();
  });

  it('expands past over-budget neighbors and stops when the ceiling is ignored', () => {
    const origin = originFromZip('75069');
    expect(origin).toBeTruthy();
    const rows = ['OB1', 'OB2', 'Far1', 'Far2', 'beyond'].map((key) => supplyRestaurant(key));
    const far1 = supplyRestaurant('Far1');
    const far2 = supplyRestaurant('Far2');
    const beyond = supplyRestaurant('beyond');
    expect(haversineMiles(origin!, far1)).toBeGreaterThan(5);
    expect(haversineMiles(origin!, far1)).toBeLessThanOrEqual(15);
    expect(haversineMiles(origin!, beyond)).toBeGreaterThan(15);
    const aware = selectDistancePool({
      restaurants: rows,
      origin: origin!,
      requestedMiles: 5,
      requiredCount: 2,
      passesHard: (restaurant) =>
        memberReason(restaurant, { ceiling: 4000 }) === null &&
        passesRestaurantHardFilters({
          cuisineTags: restaurant.cuisineTags,
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
    expect(aware.match).toEqual({ requestedMiles: 5, usedMiles: 15, expanded: true });
    expect(aware.candidates.map((row) => row.key).sort()).toEqual(['Far1', 'Far2']);
    const blind = selectDistancePool({
      restaurants: rows,
      origin: origin!,
      requestedMiles: 5,
      requiredCount: 2,
      passesHard: () => true,
      passesVariety: () => true,
      passesRelaxedVariety: () => true,
    });
    expect(blind.match).toEqual({ requestedMiles: 5, usedMiles: 5, expanded: false });
    expect(blind.candidates.map((row) => row.key).sort()).toEqual(['OB1', 'OB2']);
    expect(far2.key).toBe('Far2');
  });

  it('rejects the second month through redemptionCooldownOk after verified visits', () => {
    const first = supplyRestaurant('S01');
    const second = supplyRestaurant('S02');
    const catalog: SupplyRestaurant[] = [first, second];
    const result = runSimulatedSupplyMonths({
      config: {
        ...COVERAGE_CONFIG,
        name: 'two-month-cooldown',
        ks: [1, 0],
        swaps: [],
        secondSwap: false,
        completionPolicy: 'verify_on_assign',
      },
      anchorNow: NOW,
      catalog,
    });
    expect(result.months[0]?.pairKeys).toEqual(['S01', 'S02']);
    expect(result.months[1]?.pairKeys).toBeNull();
    expect(result.months[1] && result.rejections.some((row) => row.reason === 'cooldown')).toBe(
      true,
    );
    expect(result.numerator).toBe(2);
    expect(result.denominator).toBe(4);
  });

  it('keeps seeded and simulated match rates separate', () => {
    const seeded = seededMatchRate([
      { status: 'spent', challenge_item_id: 'item-spent' },
      { status: 'linked', challenge_item_id: 'item-linked' },
      { status: 'expired', challenge_item_id: null },
    ]);
    const simulated = simulatedMatchRate({ numerator: 12, denominator: 12 });
    expect(seeded).toEqual({ numerator: 2, denominator: 3 });
    expect(simulated).toEqual({ numerator: 12, denominator: 12 });
    expect(seeded.denominator).not.toBe(simulated.denominator);
  });

  it('counts the successor threshold once', () => {
    const spend = finalItemSpendCents({
      challengeItemId: 'successor',
      items: [
        { id: 'source', thresholdCents: 2000 },
        { id: 'successor', thresholdCents: 4000 },
      ],
    });
    expect(spend).toBe(4000);
    expect(
      finalItemSpendCents({
        challengeItemId: null,
        items: [{ id: 'source', thresholdCents: 2000 }],
      }),
    ).toBe(0);
  });

  it('delegates redemptionHardOk to redemptionCooldownOk', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/challenges/generate.ts'), 'utf8');
    const start = source.indexOf('function redemptionHardOk');
    const end = source.indexOf('function passesHard');
    const body = source.slice(start, end);
    expect(body).toContain('redemptionCooldownOk');
    expect(body).not.toContain('subYears');
    expect(body).not.toContain('subMonths');
    expect(body).not.toContain('twelveMonthsAgo');
  });
});

describe('supply simulation lifecycle', () => {
  it('frees released seats and settles the visit bucket', () => {
    const ledger = createLedger();
    reserveBuckets(ledger, 'item-1', 'rest-1', ['2026-01-01', '2026-02-01']);
    expect(capacityCounts(ledger, 'rest-1', '2026-01-01').used).toBe(1);
    expect(bucketsHaveCapacity(ledger, 'rest-1', ['2026-01-01'], 1)).toBe(false);
    for (const row of ledger.reservations) {
      if (row.bucketStart === '2026-01-01') row.status = 'released';
    }
    expect(capacityCounts(ledger, 'rest-1', '2026-01-01').used).toBe(0);
    expect(bucketsHaveCapacity(ledger, 'rest-1', ['2026-01-01'], 1)).toBe(true);
    settleItem(ledger, 'item-1', new Date('2026-02-15T18:00:00.000Z'));
    expect(capacityCounts(ledger, 'rest-1', '2026-02-01')).toMatchObject({
      consumed: 1,
      used: 1,
    });
    expect(capacityCounts(ledger, 'rest-1', '2026-01-01').released).toBe(1);
  });

  it('clips a carried deadline at expires_at and can touch three buckets', () => {
    const assignedAt = new Date('2026-01-31T18:00:00.000Z');
    const expiresAt = new Date('2026-02-05T06:00:00.000Z');
    const deadline = carriedAssignDeadline(assignedAt, expiresAt);
    expect(deadline.toISOString()).toBe(expiresAt.toISOString());
    expect(plusAssignmentHours(assignedAt).getTime()).toBeGreaterThan(expiresAt.getTime());
    const buckets = bucketsIntersectingDeadline(assignedAt, plusAssignmentHours(assignedAt));
    expect(buckets).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
    expect(chicagoMidnight('2026-09-01').toISOString()).toBe('2026-09-01T05:00:00.000Z');
    expect(tierExpiresAt('2026-08-01', 2).toISOString()).toBe('2026-10-01T05:00:00.000Z');
  });

  it('extends P2 at k=1 and applies the k=0 carry cap', () => {
    const pressure = runCarryPressure(NOW);
    expect(pressure.leaveSnapshot).toEqual({
      vLinked: 2,
      p1Extended: 0,
      p1Expired: 2,
      outcome: 'rolled',
      carryCapExceeded: false,
      p0Assigned: 2,
      numerator: 4,
      denominator: 6,
    });
    expect(pressure.verifySnapshot).toMatchObject({
      vLinked: 0,
      p1Extended: 2,
      p1Expired: 0,
      outcome: 'rolled',
      carryCapExceeded: false,
      p0Assigned: 2,
      denominator: 6,
    });
    const k1 = pressure.leaveLinked.months.find((month) => month.k === 1);
    expect(k1?.rollover?.outcome).toBe('rolled');
    const p2 = pressure.leaveLinked.ledger.credits.filter((credit) => credit.issueK === 2);
    expect(p2.map((credit) => credit.status).sort()).toEqual(['linked', 'linked']);
    expect(
      p2.every(
        (credit) => credit.expiresAt.getTime() === tierExpiresAt(credit.issuePeriod, 2).getTime(),
      ),
    ).toBe(true);
  });

  it('assigns six distinct S pairs for coverage and none for a thin catalog', () => {
    const coverage = runSimulatedSupplyMonths({ config: COVERAGE_CONFIG, anchorNow: NOW });
    expect(coverage.months.map((month) => month.pairKeys)).toEqual([
      ['S01', 'S02'],
      ['S03', 'S04'],
      ['S05', 'S06'],
      ['S07', 'S08'],
      ['S09', 'S10'],
      ['S11', 'S12'],
    ]);
    expect(coverage.months.map((month) => month.k)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(coverage.months[0]?.rollover).toBeNull();
    expect(coverage.months[5]?.rollover).not.toBeNull();
    expect(coverage.months[5]?.swapOutcomes).toEqual(['created', 'swap_exhausted']);
    expect(coverage.numerator).toBe(12);
    expect(coverage.denominator).toBe(12);
    expect(coverage.requestedMiles).toBe(5);
    expect(coverage.usedMiles).toBe(5);
    expect(coverage.expanded).toBe(false);
    expect(coverage.carryCapExceeded).toBe(false);
    expect(coverage.capacity.every((row) => row.used <= row.capacityMax)).toBe(true);
    const ids = SUPPLY_RESTAURANTS.map((row) => row.id);
    const success = ids.slice(0, 12);
    const rest = ids.slice(12);
    expect([...success].sort()).toEqual(success);
    expect(rest.every((id) => id > success[11])).toBe(true);

    const thin = runSimulatedSupplyMonths({ config: THIN_CATALOG_CONFIG, anchorNow: NOW });
    expect(thin.numerator).toBe(0);
    expect(thin.denominator).toBe(12);
    expect(thin.rejections.some((row) => row.reason === 'pair_below_floor')).toBe(true);

    const expansion = runSimulatedSupplyMonths({
      config: CEILING_EXPANSION_CONFIG,
      anchorNow: NOW,
    });
    expect(expansion.expanded).toBe(true);
    expect(expansion.requestedMiles).toBe(5);
    expect(expansion.usedMiles).toBe(15);
    expect(expansion.months[0]?.pairKeys).toEqual(['Far1', 'Far2']);
  });
});
