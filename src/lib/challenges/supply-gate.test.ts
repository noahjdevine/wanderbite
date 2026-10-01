import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { subMonths } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { filterCarriedAssignCandidates } from '@/lib/challenges/carried-assign-pool';
import { MEMBER_FLAGS } from '@/lib/challenges/supply-simulation';
import {
  assignLinkedRestaurant,
  createLedger,
  issueTwoCredits,
} from '@/lib/challenges/supply-simulation-lifecycle';
import {
  SUPPLY_GATE_COHORT,
  SUPPLY_GATE_DENOMINATOR,
  explainSupplyBinding,
  firstScoredMonth,
  parseSupplySnapshot,
  runSupplyGate,
  selectSupplyGateCandidates,
  type SupplySnapshot,
} from '@/lib/challenges/supply-gate';
import { haversineMiles, originFromZip } from '@/lib/launch-market';

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = path.join(ROOT, 'scripts/fixtures/e02-supply-gate-synthetic.json');
const MARKET = 'e0255200-0000-4000-8000-0000000000aa';
const EXPORTED = '2026-10-10T15:00:00.000Z';

/** Restaurants added on top of the thin fixture so every trial can hit 192/192. */
const PASS_PADDING = 24;

function loadFixture(): SupplySnapshot {
  const parsed = parseSupplySnapshot(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.snapshot;
}

function gateId(n: number, tail: '01' | '02'): string {
  return `e02552${String(n).padStart(2, '0')}-0000-4000-8000-0000000000${tail}`;
}

function makeSnapshot(options: {
  count: number;
  discount?: number;
  capacity?: number;
  tags?: string[];
  validFrom?: string;
  validUntil?: string;
  withdrawn?: string | null;
  noVersion?: boolean;
  legacy?: boolean;
  lat?: number;
  lon?: number;
  nullCoords?: boolean;
}): SupplySnapshot {
  const restaurants = [];
  const versions = [];
  const legacy = [];
  for (let n = 1; n <= options.count; n += 1) {
    const restaurantId = gateId(n, '01');
    const versionId = options.noVersion ? null : gateId(n, '02');
    const lat = options.nullCoords ? null : (options.lat ?? 33.194 + n * 0.0001);
    const lon = options.nullCoords ? null : (options.lon ?? -96.65);
    restaurants.push({
      id: restaurantId,
      slug: `cause-${String(n).padStart(2, '0')}`,
      name: `Cause ${String(n).padStart(2, '0')}`,
      status: 'active',
      market_id: MARKET,
      cuisine_tags: options.tags ?? ['salad'],
      lat,
      lon,
      current_offer_version_id: versionId,
    });
    if (options.legacy) {
      legacy.push({
        restaurant_id: restaurantId,
        discount_amount_cents: options.discount ?? 1000,
        min_spend_cents: 4000,
        max_redemptions_per_month: 50,
        active: true,
      });
    }
    if (!versionId) continue;
    versions.push({
      id: versionId,
      restaurant_id: restaurantId,
      tiers: [{ threshold_cents: 4000, discount_cents: options.discount ?? 1000 }],
      valid_from: options.validFrom ?? '2020-01-01T00:00:00.000Z',
      valid_until: options.validUntil ?? '2030-01-01T00:00:00.000Z',
      withdrawn_from_selection_at: options.withdrawn ?? null,
      capacity_max_redemptions: options.capacity ?? 80,
      capacity_timezone: 'America/Chicago',
      capacity_window_kind: 'calendar_month',
    });
  }
  return {
    schema: 'wanderbite.e02.supply_snapshot.v1',
    exported_at: EXPORTED,
    launch_market: { id: MARKET, slug: 'mckinney-tx', status: 'active' },
    restaurants,
    offer_versions: versions,
    legacy_offers: legacy,
  };
}

function padSnapshot(snapshot: SupplySnapshot, count: number): SupplySnapshot {
  const next: SupplySnapshot = structuredClone(snapshot);
  for (let i = 0; i < count; i += 1) {
    const restaurantId = `e0255900-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    const versionId = `e0255901-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    next.restaurants.push({
      id: restaurantId,
      slug: `pad-${String(i + 1).padStart(2, '0')}`,
      name: `Pad ${String(i + 1).padStart(2, '0')}`,
      status: 'active',
      market_id: snapshot.launch_market.id,
      cuisine_tags: ['salad'],
      lat: 33.194 + (i + 1) * 0.0001,
      lon: -96.651,
      current_offer_version_id: versionId,
    });
    next.offer_versions.push({
      id: versionId,
      restaurant_id: restaurantId,
      tiers: [{ threshold_cents: 4000, discount_cents: 1000 }],
      valid_from: '2020-01-01T00:00:00.000Z',
      valid_until: '2030-01-01T00:00:00.000Z',
      withdrawn_from_selection_at: null,
      capacity_max_redemptions: 80,
      capacity_timezone: 'America/Chicago',
      capacity_window_kind: 'calendar_month',
    });
  }
  return next;
}

function runCli(args: string[], file?: { name: string; body: unknown }): { status: number; output: string } {
  const cliArgs = [...args];
  if (file) {
    const destination = path.join(os.tmpdir(), file.name);
    writeFileSync(destination, JSON.stringify(file.body));
    cliArgs.push('--snapshot', destination);
  }
  const child = spawnSync('npx', ['tsx', 'scripts/e02-supply-gate.ts', ...cliArgs], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return {
    status: child.status ?? 2,
    output: `${child.stdout ?? ''}${child.stderr ?? ''}`,
  };
}

describe('supply gate window', () => {
  it('places M0 from exported_at', () => {
    expect(firstScoredMonth(new Date('2026-11-01T04:30:00.000Z')).slice(0, 7)).toBe('2026-11');
    expect(firstScoredMonth(new Date('2026-10-10T15:00:00.000Z')).slice(0, 7)).toBe('2026-10');
  });
});

describe('supply gate cohort', () => {
  it('is 16 members with the restricted flags exported from the simulation', () => {
    expect(SUPPLY_GATE_COHORT).toHaveLength(16);
    const restricted = SUPPLY_GATE_COHORT.filter((member) => member.persona === 'restricted');
    const open = SUPPLY_GATE_COHORT.filter((member) => member.persona === 'open');
    expect(restricted).toHaveLength(8);
    expect(open).toHaveLength(8);
    for (const member of restricted) {
      expect(member.dietaryFlags).toEqual([...MEMBER_FLAGS.dietaryFlags]);
      expect(member.allergyFlags).toEqual([...MEMBER_FLAGS.allergyFlags]);
      expect(member.excludedCuisineIds).toEqual([...MEMBER_FLAGS.excludedCuisineIds]);
    }
    for (const member of SUPPLY_GATE_COHORT) {
      expect(member.distanceBand).toBe('5_mi');
      expect(member.wantsCocktailExperience).toBe(false);
      expect(member.swaps).toBe(0);
      expect(member.completion).toBe('verify_on_assign');
    }
  });
});

describe('synthetic supply gate', () => {
  const seeds = Array.from({ length: 20 }, (_, index) => index + 1);

  it('fails the thin fixture across 20 seeds', () => {
    const failed = runSupplyGate({ snapshot: loadFixture(), seeds });
    expect(failed.result).toBe('FAIL');
    expect(failed.matchedMin).toBeLessThan(SUPPLY_GATE_DENOMINATOR);
    expect(failed.text).toContain('unmatched_by_month ');
    expect(failed.text).not.toContain('unmatched_by_month none');
    const rules = [...failed.unmatchedByRule.keys()];
    expect(rules.length).toBeGreaterThanOrEqual(2);
    expect(failed.funnel.length).toBeGreaterThan(0);
    expect(failed.funnel[0]).toMatch(
      /active=\d+ market=\d+ offer_version=\d+ selectable=\d+ coords=\d+ dietary=\d+ allergy=\d+ cuisine=\d+ cooldown=\d+ capacity=\d+ distance=\d+ variety=\d+ floor=\d+ need=\d+ binding=/,
    );
    expect(failed.text).toMatch(/unmatched_by_month .+ \(all trials\) \| worst seed=\d+: /);
    expect(failed.text).toMatch(/unmatched_by_rule .+ \(all trials\) \| worst seed=\d+: /);
    expect(failed.text).toMatch(/unmatched_by_persona .+ \(all trials\) \| worst seed=\d+: /);
    expect(failed.shortfall).toHaveLength(8);
    for (const row of failed.shortfall) {
      expect(row.addAtLeast).toBeGreaterThan(0);
      expect(row.eligibleStatic5).toBe(row.persona === 'open' ? 7 : 6);
      expect(row.eligibleStatic15).toBe(row.eligibleStatic5);
      expect(failed.text).toContain(`shortfall persona=${row.persona} zip=${row.zip}`);
      expect(failed.text).toContain('lower bound');
      expect(failed.text).toContain(`kind="${row.kind}" lower bound`);
      expect(row.kind).toContain('published selectable offer version valid >= 2027-03+840h');
      if (row.persona === 'restricted') {
        expect(row.kind).toContain('vegan-compatible, no peanut, not italian');
      }
    }
    expect(failed.text).toContain('synthetic-05+synthetic-05-2');
    expect(failed.text).toContain('possible_duplicates=synthetic-05+synthetic-05-2');
    expect(failed.text).toMatch(/FAIL: E02 supply gate \(\d+ unmatched credits\)\n$/);
    expect(failed.seeds).toEqual(seeds);
  });

  it('repeats the same thin 20-seed report', () => {
    const thin = loadFixture();
    const first = runSupplyGate({ snapshot: thin, seeds });
    const again = runSupplyGate({ snapshot: thin, seeds });
    expect(again.text).toBe(first.text);
    expect(first.result).toBe('FAIL');
  });

  it('passes the padded fixture across 20 seeds', () => {
    const padded = runSupplyGate({ snapshot: padSnapshot(loadFixture(), PASS_PADDING), seeds });
    expect(padded.result).toBe('PASS');
    expect(padded.matchedMin).toBe(SUPPLY_GATE_DENOMINATOR);
    expect(padded.trialsFailed).toBe(0);
    expect(padded.text).toContain('PASS: E02 supply gate');
    expect(padded.seeds).toEqual(seeds);
  });

  it('prints a one-trial padded pass from the CLI', () => {
    const paddedPath = path.join(os.tmpdir(), `e02-padded-${process.pid}.json`);
    writeFileSync(paddedPath, JSON.stringify(padSnapshot(loadFixture(), PASS_PADDING)));
    const paddedCli = runCli(['--snapshot', paddedPath, '--trials', '1']);
    expect(paddedCli.status).toBe(0);
    expect(paddedCli.output).toContain('trials=1');
    expect(paddedCli.output).toContain('PASS: E02 supply gate');
  });
});

describe('single-cause catalogs', () => {
  it('binds no_offer_version when nothing has a current version', () => {
    const result = runSupplyGate({
      snapshot: makeSnapshot({ count: 8, noVersion: true, legacy: true }),
      seeds: [1],
    });
    expect(result.matchedMin).toBe(0);
    expect(result.funnel.every((line) => line.includes('binding=no_offer_version'))).toBe(true);
    expect(result.funnel.some((line) => line.includes('sub=legacy_offer_only'))).toBe(true);
  });

  it('binds offer_version_not_selectable starting at M3', () => {
    const result = runSupplyGate({
      snapshot: makeSnapshot({ count: 24, validUntil: '2027-02-01T00:00:00.000Z' }),
      seeds: [1],
    });
    expect(result.funnel.length).toBeGreaterThan(0);
    expect(result.funnel.every((line) => line.includes('binding=offer_version_not_selectable'))).toBe(true);
    expect(result.funnel.every((line) => line.includes('sub=expires_before_deadline'))).toBe(true);
    expect(result.funnel.every((line) => /month=2027-/.test(line))).toBe(true);
    expect(result.unmatchedByMonth.has('2026-10')).toBe(false);
    expect(result.unmatchedByMonth.has('2026-11')).toBe(false);
    expect(result.unmatchedByMonth.has('2026-12')).toBe(false);
    expect(result.unmatchedByMonth.has('2027-01')).toBe(true);
  });

  it('binds dietary_exclusion for restricted members only', () => {
    const result = runSupplyGate({
      snapshot: makeSnapshot({ count: 24, tags: ['cheese'] }),
      seeds: [1],
    });
    expect(result.unmatchedByPersona.get('open/new')).toBe(0);
    expect(result.unmatchedByPersona.get('open/tenured')).toBe(0);
    expect(result.unmatchedByPersona.get('restricted/new')).toBeGreaterThan(0);
    expect(result.unmatchedByPersona.get('restricted/tenured')).toBeGreaterThan(0);
    expect(result.funnel.every((line) => line.includes('persona=restricted/'))).toBe(true);
    expect(result.funnel.every((line) => line.includes('binding=dietary_exclusion'))).toBe(true);
  });

  it('binds missing_coordinates when half the rows have no coordinates and the rest are too few', () => {
    // The versioned half has null coordinates. The located half has no offer version, so it cannot refill the pool.
    const snapshot = makeSnapshot({ count: 4, discount: 2000 });
    for (const restaurant of snapshot.restaurants.slice(0, 2)) {
      restaurant.lat = null;
      restaurant.lon = null;
    }
    const located = snapshot.restaurants.slice(2);
    const locatedIds = new Set(located.map((restaurant) => restaurant.id));
    for (const restaurant of located) restaurant.current_offer_version_id = null;
    snapshot.offer_versions = snapshot.offer_versions.filter((version) => !locatedIds.has(version.restaurant_id));
    const result = runSupplyGate({ snapshot, seeds: [1] });
    expect(result.funnel.length).toBeGreaterThan(0);
    expect(result.funnel.every((line) => line.includes('binding=missing_coordinates'))).toBe(true);
    expect(result.unmatchedByRule.get('missing_coordinates')).toBeGreaterThan(0);
    expect(result.funnel.some((line) => line.includes('outside_distance'))).toBe(false);
  });

  it('binds outside_distance when every restaurant is beyond 40 miles', () => {
    const farLat = 33.194 + (50 / 3958.7613) * (180 / Math.PI);
    const result = runSupplyGate({
      snapshot: makeSnapshot({ count: 8, lat: farLat, lon: -96.65 }),
      seeds: [1],
    });
    expect(result.matchedMin).toBe(0);
    expect(result.funnel.every((line) => line.includes('binding=outside_distance'))).toBe(true);
  });

  it('binds capacity_full when capacity is 1 across 16 members', () => {
    const result = runSupplyGate({
      snapshot: makeSnapshot({ count: 24, capacity: 1, discount: 2000 }),
      seeds: [1],
    });
    expect(result.funnel.length).toBeGreaterThan(0);
    expect(result.funnel.every((line) => line.includes('binding=capacity_full'))).toBe(true);
    expect(result.unmatchedByRule.get('capacity_full')).toBeGreaterThan(0);
  });

  it('fails new members from M3 on exactly 6 eligible restaurants', () => {
    const result = runSupplyGate({
      snapshot: makeSnapshot({ count: 6, capacity: 80 }),
      seeds: [1],
    });
    const fresh = result.funnel.filter((line) => line.includes('/new'));
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((line) => /month=2027-/.test(line))).toBe(true);
    expect(
      fresh.every(
        (line) =>
          line.includes('binding=cooldown_recent_visit_6m') || line.includes('binding=variety_6m'),
      ),
    ).toBe(true);
  });

  it('binds pair_below_floor and carried_below_floor when every base is 900', () => {
    const result = runSupplyGate({
      snapshot: makeSnapshot({ count: 12, discount: 900 }),
      seeds: [1],
    });
    expect(result.funnel.some((line) => line.includes('attempt=pair') && line.includes('binding=pair_below_floor'))).toBe(
      true,
    );
    expect(
      result.funnel.some((line) => line.includes('attempt=carried') && line.includes('binding=carried_below_floor')),
    ).toBe(true);
    expect(result.unmatchedByRule.get('pair_below_floor')).toBeGreaterThan(0);
    expect(result.unmatchedByRule.get('carried_below_floor')).toBeGreaterThan(0);
  });

  it('binds cooldown_two_in_12m and variety_12m from tenured-style history', () => {
    const snapshot = makeSnapshot({ count: 4, capacity: 80 });
    const member = SUPPLY_GATE_COHORT[0];
    if (!member) throw new Error('missing member');
    const now = new Date('2026-10-15T18:00:00.000Z');
    const restaurantIds = snapshot.restaurants.map((row) => row.id);
    const twoVisits = explainSupplyBinding({
      snapshot,
      member,
      now,
      need: 2,
      floor: 'pair',
      redemptions: restaurantIds.flatMap((restaurantId) => [
        {
          restaurant_id: restaurantId,
          status: 'verified',
          verified_at: subMonths(now, 8).toISOString(),
          created_at: subMonths(now, 8).toISOString(),
        },
        {
          restaurant_id: restaurantId,
          status: 'verified',
          verified_at: subMonths(now, 10).toISOString(),
          created_at: subMonths(now, 10).toISOString(),
        },
      ]),
      cycles: [],
    });
    expect(twoVisits.binding).toBe('cooldown_two_in_12m');

    const twoCycles = explainSupplyBinding({
      snapshot,
      member,
      now,
      need: 2,
      floor: 'pair',
      redemptions: [],
      cycles: restaurantIds.flatMap((restaurantId) => [
        { cycleMonth: '2025-11-01', restaurantId },
        { cycleMonth: '2025-12-01', restaurantId },
      ]),
    });
    expect(twoCycles.binding).toBe('variety_12m');
  });
});

describe('snapshot loader', () => {
  it('rejects forbidden keys, unknown top-level keys, a wrong schema, and a missing file', () => {
    const thin = loadFixture();
    const secret = 'sentinel-pin-value-9f3a';
    const nested = structuredClone(thin) as unknown as Record<string, unknown>;
    const restaurants = nested.restaurants as Array<Record<string, unknown>>;
    restaurants[0] = { ...restaurants[0], pin_hash: secret };
    const nestedResult = parseSupplySnapshot(nested);
    expect(nestedResult.ok).toBe(false);
    if (!nestedResult.ok) expect(nestedResult.message).not.toContain(secret);

    const deep = structuredClone(thin) as unknown as {
      offer_versions: Array<{ tiers: Array<Record<string, unknown>> }>;
    };
    const tier = deep.offer_versions[0]?.tiers[0];
    if (!tier) throw new Error('missing tier');
    tier.verification_code = secret;
    const deepResult = parseSupplySnapshot(deep);
    expect(deepResult.ok).toBe(false);
    if (!deepResult.ok) expect(deepResult.message).not.toContain(secret);

    const extra = { ...thin, note: secret };
    const extraResult = parseSupplySnapshot(extra);
    expect(extraResult.ok).toBe(false);
    if (!extraResult.ok) {
      expect(extraResult.message).toBe('snapshot rejected: unknown top-level key');
      expect(extraResult.message).not.toContain(secret);
    }

    const wrong = { ...thin, schema: 'not-the-schema' };
    const wrongResult = parseSupplySnapshot(wrong);
    expect(wrongResult.ok).toBe(false);
    if (!wrongResult.ok) {
      expect(wrongResult.message).toBe('snapshot rejected: schema');
      expect(wrongResult.message).not.toContain('not-the-schema');
    }

    const labeled = structuredClone(thin) as unknown as {
      offer_versions: Array<{ tiers: Array<Record<string, unknown>> }>;
    };
    const labeledTier = labeled.offer_versions[3]?.tiers[0];
    if (!labeledTier) throw new Error('missing tier');
    labeledTier.label = { nested: secret };
    const labeledResult = parseSupplySnapshot(labeled);
    expect(labeledResult.ok).toBe(false);
    if (!labeledResult.ok) {
      expect(labeledResult.message).toBe('snapshot rejected: offer_versions[3].tiers[0].label');
      expect(labeledResult.message).not.toContain(secret);
    }

    const missing = runCli(['--snapshot', path.join(os.tmpdir(), 'e02-missing-snapshot.json')]);
    expect(missing.status).toBe(2);
    expect(missing.output).toContain('scripts/sql/e02-supply-snapshot.sql');
    expect(missing.output).toContain('.supply-gate/hosted-catalog.json');

    const forbidden = runCli([], {
      name: `e02-forbidden-${process.pid}.json`,
      body: nested,
    });
    expect(forbidden.status).toBe(2);
    expect(forbidden.output).not.toContain(secret);

    const unknown = runCli([], {
      name: `e02-unknown-${process.pid}.json`,
      body: extra,
    });
    expect(unknown.status).toBe(2);
    expect(unknown.output).not.toContain(secret);

    const schema = runCli([], {
      name: `e02-schema-${process.pid}.json`,
      body: wrong,
    });
    expect(schema.status).toBe(2);
    expect(schema.output).not.toContain('not-the-schema');

    const labeledCli = runCli([], {
      name: `e02-label-${process.pid}.json`,
      body: labeled,
    });
    expect(labeledCli.status).toBe(2);
    expect(labeledCli.output).toContain('offer_versions[3].tiers[0].label');
    expect(labeledCli.output).not.toContain(secret);

    const outsideJson = path.join(os.tmpdir(), `e02-json-${process.pid}.json`);
    const outside = runCli(['--json', outsideJson, '--snapshot', FIXTURE, '--trials', '1']);
    expect(outside.status).toBe(2);
    expect(outside.output).toContain('.supply-gate/');
    expect(outside.output).not.toContain('pin_hash');
    expect(existsSync(outsideJson)).toBe(false);
  }, 60_000);
});

describe('floor-aware supply gate', () => {
  const zips = ['75069', '75070', '75071', '75072'] as const;
  const origins = zips.map((zip) => {
    const origin = originFromZip(zip);
    if (!origin) throw new Error(`missing ${zip}`);
    return origin;
  });

  function farPoint(n: number): { lat: number; lon: number } {
    return { lat: 33.2 + n * 0.0001, lon: -96.5 };
  }

  const nearA = { lat: 33.188, lon: -96.65 };
  const nearB = { lat: 33.1882, lon: -96.65 };

  function assertDistances(): void {
    for (let n = 1; n <= 30; n += 1) {
      const point = farPoint(n);
      for (const origin of origins) {
        const miles = haversineMiles(origin, point);
        expect(miles).toBeGreaterThan(5);
        expect(miles).toBeLessThanOrEqual(15);
      }
    }
    for (const point of [nearA, nearB]) {
      for (const origin of origins) expect(haversineMiles(origin, point)).toBeLessThanOrEqual(5);
    }
  }

  function offerSnapshot(
    rows: Array<{ lat: number; lon: number; discount: number; validUntil?: string }>,
  ): SupplySnapshot {
    const restaurants = [];
    const versions = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row) continue;
      const restaurantId = `e0255800-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      const versionId = `e0255801-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      restaurants.push({
        id: restaurantId,
        slug: `placed-${index + 1}`,
        name: `Placed ${index + 1}`,
        status: 'active',
        market_id: MARKET,
        cuisine_tags: ['salad'],
        lat: row.lat,
        lon: row.lon,
        current_offer_version_id: versionId,
      });
      versions.push({
        id: versionId,
        restaurant_id: restaurantId,
        tiers: [{ threshold_cents: 4000, discount_cents: row.discount }],
        valid_from: '2020-01-01T00:00:00.000Z',
        valid_until: row.validUntil ?? '2030-01-01T00:00:00.000Z',
        withdrawn_from_selection_at: null,
        capacity_max_redemptions: 80,
        capacity_timezone: 'America/Chicago',
        capacity_window_kind: 'calendar_month',
      });
    }
    return {
      schema: 'wanderbite.e02.supply_snapshot.v1',
      exported_at: EXPORTED,
      launch_market: { id: MARKET, slug: 'mckinney-tx', status: 'active' },
      restaurants,
      offer_versions: versions,
      legacy_offers: [],
    };
  }

  function farTenDollarRows(): Array<{ lat: number; lon: number; discount: number }> {
    return Array.from({ length: 30 }, (_, index) => ({ ...farPoint(index + 1), discount: 1000 }));
  }

  const distanceSeeds = Array.from({ length: 20 }, (_, index) => index + 1);

  function expectDistancePass(rows: Array<{ lat: number; lon: number; discount: number }>): void {
    const result = runSupplyGate({ snapshot: offerSnapshot(rows), seeds: distanceSeeds });
    expect(result.result).toBe('PASS');
    expect(result.matchedMin).toBe(SUPPLY_GATE_DENOMINATOR);
    expect(result.seeds).toEqual(distanceSeeds);
  }

  it('places far rows between 5 and 15 miles and near rows inside 5', () => {
    assertDistances();
  });

  it('reaches 192/192 for 30 far $10 offers', () => {
    expectDistancePass(farTenDollarRows());
  });

  it('reaches 192/192 for 30 far $10 offers plus one near $9 offer', () => {
    expectDistancePass([...farTenDollarRows(), { ...nearA, discount: 900 }]);
  });

  it('reaches 192/192 for 30 far $10 offers plus two near $9 offers', () => {
    expectDistancePass([...farTenDollarRows(), { ...nearA, discount: 900 }, { ...nearB, discount: 900 }]);
  });

  it('finds far carried candidates and assigns one', () => {
    assertDistances();
    const farRows = Array.from({ length: 30 }, (_, index) => ({ ...farPoint(index + 1), discount: 2000 }));
    const snapshot = offerSnapshot([...farRows, { ...nearA, discount: 1500 }]);
    const member = SUPPLY_GATE_COHORT.find((row) => row.persona === 'open' && row.zip === '75069');
    if (!member) throw new Error('missing member');
    const now = new Date('2026-10-15T18:00:00.000Z');
    const deadline = new Date('2026-11-19T18:00:00.000Z');
    const blockedId = snapshot.restaurants[0]?.id;
    const expiredId = snapshot.restaurants[1]?.id;
    const nearId = snapshot.restaurants[30]?.id;
    if (!blockedId || !expiredId || !nearId) throw new Error('missing rows');
    const expired = snapshot.offer_versions.find((row) => row.restaurant_id === expiredId);
    if (!expired) throw new Error('missing version');
    expired.valid_until = '2026-10-01T00:00:00.000Z';
    const redemptions = [
      {
        restaurant_id: blockedId,
        status: 'verified',
        verified_at: '2026-09-01T18:00:00.000Z',
        created_at: '2026-09-01T18:00:00.000Z',
      },
    ];
    const selected = selectSupplyGateCandidates({
      snapshot,
      member,
      now,
      deadline,
      need: 1,
      floor: 'carried',
      redemptions,
      cycles: [],
    });
    expect(selected.usedMiles).toBe(15);
    expect(selected.ids).not.toContain(nearId);
    expect(selected.ids).not.toContain(blockedId);
    expect(selected.ids).not.toContain(expiredId);
    expect(selected.ids).toHaveLength(28);

    const origin = originFromZip(member.zip);
    if (!origin) throw new Error('missing origin');
    const compared = filterCarriedAssignCandidates({
      restaurants: snapshot.restaurants.map((row) => ({
        id: row.id,
        name: row.name,
        cuisine_tags: row.cuisine_tags,
        lat: row.lat,
        lon: row.lon,
        current_offer_version_id: row.current_offer_version_id,
      })),
      versionsById: new Map(snapshot.offer_versions.map((row) => [row.id, row])),
      origin,
      requestedMiles: 5,
      allergyFlags: member.allergyFlags,
      dietaryFlags: member.dietaryFlags,
      excludedCuisineIds: member.excludedCuisineIds,
      redemptions,
      now,
      deadline,
    });
    expect(compared.map((row) => row.id)).toEqual(selected.ids);

    const ledger = createLedger();
    const [credit] = issueTwoCredits(ledger, now, 0);
    if (!credit || !selected.ids[0]) throw new Error('missing credit');
    const assigned = assignLinkedRestaurant({
      ledger,
      credit,
      restaurantId: selected.ids[0],
      assignedAt: now,
      deadline,
      capacityMax: 80,
      discountCents: 2000,
      floor: 'carried',
    });
    expect(typeof assigned).toBe('object');
    if (typeof assigned === 'string') throw new Error(assigned);
    expect(assigned.restaurantId).toBe(selected.ids[0]);
  });
});

describe('supply gate source guard', () => {
  it('stays offline and gitignores the hosted snapshot directory', () => {
    for (const rel of ['src/lib/challenges/supply-gate.ts', 'scripts/e02-supply-gate.ts']) {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      expect(source).not.toContain('@supabase/');
      expect(source).not.toContain('supabase-admin');
      expect(source).not.toContain('process.env');
      expect(source).not.toContain('Math.random');
    }
    expect(readFileSync(path.join(ROOT, '.gitignore'), 'utf8')).toContain('/.supply-gate/');
    expect(readFileSync(FIXTURE, 'utf8')).not.toContain('pin_hash');
  });
});
