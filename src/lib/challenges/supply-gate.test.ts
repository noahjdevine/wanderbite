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
  SUPPLY_GATE_SCHEMA_V1,
  SUPPLY_GATE_SCHEMA_V2,
  explainSupplyBinding,
  firstScoredMonth,
  parseSupplySnapshot,
  runSupplyGate,
  selectSupplyGateCandidates,
  type SupplySnapshot,
} from '@/lib/challenges/supply-gate';
import { TEST_OFFER_AUDIT_ACTIONS, TEST_OFFER_AUDIT_TARGET_TYPE } from '@/lib/catalog/import';
import { haversineMiles, originFromZip } from '@/lib/launch-market';

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = path.join(ROOT, 'scripts/fixtures/e02-supply-gate-synthetic.json');
const ALL_TEST_FIXTURE = path.join(ROOT, 'scripts/fixtures/e02-supply-gate-all-test.json');
const MIXED_FIXTURE = path.join(ROOT, 'scripts/fixtures/e02-supply-gate-mixed.json');
const LINKED_NOT_SELECTABLE_FIXTURE = path.join(
  ROOT,
  'scripts/fixtures/e02-supply-gate-linked-not-selectable.json',
);
const WITHDRAWN_TEST_VERSION = 'e0255117-0000-4000-8000-000000000002';
const MARKET = 'e0255200-0000-4000-8000-0000000000aa';
const EXPORTED = '2026-10-10T15:00:00.000Z';

/** Restaurants added on top of the thin fixture so every trial can hit 192/192. */
const PASS_PADDING = 24;

function loadSnapshotFile(file: string): SupplySnapshot {
  const parsed = parseSupplySnapshot(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.snapshot;
}

function loadFixture(): SupplySnapshot {
  return loadSnapshotFile(FIXTURE);
}

function gateBody(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.startsWith('test_supply=') && !line.startsWith('test_supply ') && !line.startsWith('real_supply_result='))
    .join('\n');
}

function lineStarting(text: string, prefix: string): string {
  const line = text.split('\n').find((entry) => entry.startsWith(prefix));
  if (!line) throw new Error(`missing line ${prefix}`);
  return line;
}

/** Current test versions become restaurants with no offer version. */
function catalogWithoutTestVersions(snapshot: SupplySnapshot): SupplySnapshot {
  if (snapshot.schema !== SUPPLY_GATE_SCHEMA_V2) return snapshot;
  const testIds = new Set(snapshot.test_offer_version_ids);
  return {
    ...snapshot,
    test_offer_version_ids: [],
    restaurants: snapshot.restaurants.map((restaurant) =>
      restaurant.current_offer_version_id && testIds.has(restaurant.current_offer_version_id)
        ? { ...restaurant, current_offer_version_id: null }
        : restaurant,
    ),
  };
}

function asV2(snapshot: SupplySnapshot, testOfferVersionIds: string[]): SupplySnapshot {
  const { schema: _schema, ...rest } = snapshot;
  return {
    ...rest,
    schema: SUPPLY_GATE_SCHEMA_V2,
    test_offer_version_ids: testOfferVersionIds,
  };
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

  it('binds below_floor when every base is 900', () => {
    const result = runSupplyGate({
      snapshot: makeSnapshot({ count: 12, discount: 900 }),
      seeds: [1],
    });
    expect(result.funnel.some((line) => line.includes('attempt=pair') && line.includes('binding=below_floor'))).toBe(
      true,
    );
    expect(
      result.funnel.some((line) => line.includes('attempt=carried') && line.includes('binding=below_floor')),
    ).toBe(true);
    expect(result.unmatchedByRule.get('below_floor')).toBeGreaterThan(0);
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
    const snapshot = offerSnapshot([...farRows, { ...nearA, discount: 900 }]);
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

describe('test supply split', () => {
  const seeds = Array.from({ length: 20 }, (_, index) => index + 1);

  it('keeps a v1 report byte-identical aside from the unknown test_supply line', () => {
    const failed = runSupplyGate({ snapshot: loadFixture(), seeds: [1] });
    expect(failed.result).toBe('FAIL');
    expect(failed.realSupplyResult).toBeNull();
    expect(failed.text).toContain('test_supply=unknown (v1 snapshot)\n');
    expect(failed.text).not.toContain('real_supply_result=');
    expect(failed.text).not.toContain('(all supply)');
    expect(failed.text).not.toContain('full_run_diagnostics include test supply');
    expect(failed.text).not.toContain('real_unmatched_by_month');
    expect(failed.text).not.toContain('real_shortfall');
    expect(failed.realDiagnostics).toBeNull();
    expect(failed.selectableTestSupply).toBe(false);
    expect(failed.text).toContain(
      'result=FAIL matched_min=104/192 matched_via_carry=50 worst_seed=1 trials_failed=1/1\n',
    );
    expect(failed.text).toContain(
      'catalog selectable_offer_version=15 no_offer_version=7 legacy_offer_only=3 not_selectable=2 missing_coordinates=2 possible_duplicates=synthetic-05+synthetic-05-2\n',
    );
    expect(failed.text).toMatch(/FAIL: E02 supply gate \(88 unmatched credits\)\n$/);
    const lines = failed.text.trimEnd().split('\n');
    expect(lines.filter((line) => line.startsWith('test_supply'))).toEqual(['test_supply=unknown (v1 snapshot)']);
  });

  it('reports real_supply_result equal to result when a v2 snapshot has no test ids', () => {
    const v1 = runSupplyGate({ snapshot: loadFixture(), seeds });
    const empty = asV2(loadFixture(), []);
    const v2 = runSupplyGate({ snapshot: empty, seeds });
    expect(v2.testSupplyLine).toBe('test_supply selectable=0 of 15');
    expect(v2.realSupplyResult).toBe(v2.result);
    expect(v2.realMatchedMin).toBe(v2.matchedMin);
    expect(v2.realTrialsFailed).toBe(v2.trialsFailed);
    expect(v2.text).toContain(`real_supply_result=${v2.result} matched_min=${v2.matchedMin}/${SUPPLY_GATE_DENOMINATOR}`);
    expect(v2.text).toContain('(excluding 0 test versions)');
    expect(v2.text).not.toContain('(all supply)');
    expect(v2.text).not.toContain('full_run_diagnostics include test supply');
    expect(v2.text).not.toContain('real_unmatched_by_month');
    expect(v2.text).not.toContain('real_shortfall');
    expect(v2.realDiagnostics).toBeNull();
    expect(v2.selectableTestSupply).toBe(false);
    expect(gateBody(v2.text)).toBe(gateBody(v1.text));
  }, 60_000);

  it('fails real supply when every selectable version is test', () => {
    const snapshot = loadSnapshotFile(ALL_TEST_FIXTURE);
    expect(snapshot.schema).toBe(SUPPLY_GATE_SCHEMA_V2);
    const result = runSupplyGate({ snapshot, seeds });
    expect(result.result).toBe('PASS');
    expect(result.realSupplyResult).toBe('FAIL');
    expect(result.realMatchedMin).toBe(0);
    expect(result.text).toContain('test_supply selectable=39 of 39\n');
    expect(result.text).toContain(
      `result=PASS (all supply) matched_min=${SUPPLY_GATE_DENOMINATOR}/${SUPPLY_GATE_DENOMINATOR}`,
    );
    expect(result.text).toContain(
      'real_supply_result=FAIL matched_min=0/192 trials_failed=20/20 unmatched_by_rule=no_offer_version=192 (excluding 41 test versions)',
    );
    expect(result.text).toContain('not a real-supply result');
    expect(result.text).toContain('full_run_diagnostics include test supply\n');
    expect(result.text).toContain('real_unmatched_by_month ');
    expect(result.text).toContain('real_unmatched_by_persona ');
    expect(result.text).toContain('real_shortfall ');
    expect(result.selectableTestSupply).toBe(true);
    expect(result.realDiagnostics).not.toBeNull();
    const bare = runSupplyGate({ snapshot: catalogWithoutTestVersions(snapshot), seeds: [1] });
    expect(result.realDiagnostics?.shortfall).toEqual(bare.shortfall);
    expect(result.text).not.toMatch(/^PASS: E02 supply gate\n/m);

    const cli = runCli(['--trials', '1'], {
      name: `e02-all-test-${process.pid}.json`,
      body: snapshot,
    });
    expect(cli.status).toBe(1);
    expect(cli.output).toContain('result=PASS (all supply) ');
    expect(cli.output).toContain('real_supply_result=FAIL matched_min=0/192');
    expect(cli.output).toContain('unmatched_by_rule=no_offer_version');
  }, 60_000);

  it('splits a mixed catalog into all-supply and real-supply results', () => {
    const snapshot = loadSnapshotFile(MIXED_FIXTURE);
    expect(snapshot.schema).toBe(SUPPLY_GATE_SCHEMA_V2);
    if (snapshot.schema !== SUPPLY_GATE_SCHEMA_V2) return;
    const result = runSupplyGate({ snapshot, seeds });
    expect(result.result).toBe('PASS');
    expect(result.testSupplyIncluded).toBe(true);
    expect(result.realSupplyResult).toBe('FAIL');
    expect(result.text).toContain('test_supply selectable=37 of 39\n');
    expect(result.text).toContain('result=PASS (all supply) ');
    expect(result.text).toContain('real_supply_result=FAIL ');
    expect(result.text).toContain('(excluding 39 test versions)');
    expect(snapshot.test_offer_version_ids).toHaveLength(39);
    const realIds = snapshot.offer_versions
      .map((version) => version.id)
      .filter((id) => !snapshot.test_offer_version_ids.includes(id))
      .sort();
    expect(realIds).toEqual([
      'e0255901-0000-4000-8000-000000000023',
      'e0255901-0000-4000-8000-000000000024',
    ]);
    expect(result.selectableTestSupply).toBe(true);
    expect(result.text).toContain('full_run_diagnostics include test supply\n');
    expect(result.text).toContain('real_unmatched_by_month ');
    expect(result.text).toContain('real_shortfall ');
    expect(result.realDiagnostics).not.toBeNull();
    const larger = result.realDiagnostics?.shortfall.some(
      (row, index) => row.addAtLeast > (result.shortfall[index]?.addAtLeast ?? 0),
    );
    expect(larger).toBe(true);
  }, 60_000);

  it('prints real month, persona, and shortfall lines from the test-excluded run', () => {
    for (const file of [MIXED_FIXTURE, ALL_TEST_FIXTURE]) {
      const snapshot = loadSnapshotFile(file);
      const result = runSupplyGate({ snapshot, seeds: [1] });
      const bare = runSupplyGate({ snapshot: catalogWithoutTestVersions(snapshot), seeds: [1] });
      expect(result.realDiagnostics?.shortfall).toEqual(bare.shortfall);
      expect(lineStarting(result.text, 'real_unmatched_by_month ')).toBe(
        `real_${lineStarting(bare.text, 'unmatched_by_month ')}`,
      );
      expect(lineStarting(result.text, 'real_unmatched_by_persona ')).toBe(
        `real_${lineStarting(bare.text, 'unmatched_by_persona ')}`,
      );
      for (const row of result.shortfall) {
        expect(result.text).toContain(
          `shortfall persona=${row.persona} zip=${row.zip} eligible_static_5mi=${row.eligibleStatic5} eligible_static_15mi=${row.eligibleStatic15} needed_distinct_6mo=12 base>=1000=${row.baseAtLeast1000} add_at_least=${row.addAtLeast} `,
        );
      }
    }
  });

  it('keeps a linked non-selectable test version off the qualifier and the real diagnostic lines', () => {
    const snapshot = loadSnapshotFile(LINKED_NOT_SELECTABLE_FIXTURE);
    expect(snapshot.schema).toBe(SUPPLY_GATE_SCHEMA_V2);
    if (snapshot.schema !== SUPPLY_GATE_SCHEMA_V2) return;
    expect(snapshot.test_offer_version_ids).toEqual([WITHDRAWN_TEST_VERSION]);
    const version = snapshot.offer_versions.find((row) => row.id === WITHDRAWN_TEST_VERSION);
    expect(version?.withdrawn_from_selection_at).toBeTruthy();
    const linked = snapshot.restaurants.find(
      (row) => row.current_offer_version_id === WITHDRAWN_TEST_VERSION,
    );
    expect(linked).toBeTruthy();
    const v1 = runSupplyGate({ snapshot: loadFixture(), seeds: [1] });
    const result = runSupplyGate({ snapshot, seeds: [1] });
    expect(result.testSupplyLine).toBe('test_supply selectable=0 of 15');
    expect(result.selectableTestSupply).toBe(false);
    expect(result.testSupplyIncluded).toBe(true);
    expect(result.realDiagnostics).toBeNull();
    expect(result.text).not.toContain('(all supply)');
    expect(result.text).not.toContain('full_run_diagnostics include test supply');
    expect(result.text).not.toContain('real_unmatched_by_month');
    expect(result.text).not.toContain('real_unmatched_by_persona');
    expect(result.text).not.toContain('real_shortfall');
    expect(lineStarting(result.text, 'result=')).toBe(lineStarting(v1.text, 'result='));
    expect(result.text).toContain('all supply including test versions');
    expect(result.text).toContain('(excluding 1 test versions)');
    const shared = (text: string) =>
      text
        .split('\n')
        .filter(
          (line) =>
            !line.startsWith('test_supply') &&
            !line.startsWith('real_supply_result=') &&
            !line.startsWith('FAIL:') &&
            !line.startsWith('PASS:'),
        )
        .join('\n');
    expect(shared(result.text)).toBe(shared(v1.text));
  });
});

describe('snapshot loader v2', () => {
  it('rejects an unknown test id, an extra key, and a forbidden key without printing values', () => {
    const thin = loadFixture();
    const secret = 'sentinel-pin-value-9f3a';
    const missingId = 'e0255000-0000-4000-8000-00000000ffff';
    const missing = asV2(thin, [missingId]);
    const missingResult = parseSupplySnapshot(missing);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) {
      expect(missingResult.message).toBe('snapshot rejected: test_offer_version_ids');
      expect(missingResult.message).not.toContain(missingId);
    }
    const missingCli = runCli([], { name: `e02-v2-missing-${process.pid}.json`, body: missing });
    expect(missingCli.status).toBe(2);
    expect(missingCli.output).not.toContain(missingId);
    expect(missingCli.output).not.toContain('test_supply');

    const extra = { ...asV2(thin, []), note: secret };
    const extraResult = parseSupplySnapshot(extra);
    expect(extraResult.ok).toBe(false);
    if (!extraResult.ok) {
      expect(extraResult.message).toBe('snapshot rejected: unknown top-level key');
      expect(extraResult.message).not.toContain(secret);
    }
    const extraCli = runCli([], { name: `e02-v2-extra-${process.pid}.json`, body: extra });
    expect(extraCli.status).toBe(2);
    expect(extraCli.output).not.toContain(secret);

    const nested = structuredClone(asV2(thin, [])) as unknown as { restaurants: Array<Record<string, unknown>> };
    const restaurant = nested.restaurants[0];
    if (!restaurant) throw new Error('missing restaurant');
    restaurant.pin_hash = secret;
    const nestedResult = parseSupplySnapshot(nested);
    expect(nestedResult.ok).toBe(false);
    if (!nestedResult.ok) expect(nestedResult.message).not.toContain(secret);
    const nestedCli = runCli([], { name: `e02-v2-secret-${process.pid}.json`, body: nested });
    expect(nestedCli.status).toBe(2);
    expect(nestedCli.output).toContain('forbidden key');
    expect(nestedCli.output).not.toContain(secret);

    const v1WithIds = { ...thin, test_offer_version_ids: [] };
    const v1Result = parseSupplySnapshot(v1WithIds);
    expect(v1Result.ok).toBe(false);
    if (!v1Result.ok) expect(v1Result.message).toBe('snapshot rejected: unknown top-level key');
  }, 60_000);
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
    const sql = readFileSync(path.join(ROOT, 'scripts/sql/e02-supply-snapshot.sql'), 'utf8');
    expect(sql).toContain(SUPPLY_GATE_SCHEMA_V2);
    expect(sql).toContain('begin transaction read only;');
    expect(sql).toContain('rollback;');
    for (const action of TEST_OFFER_AUDIT_ACTIONS) expect(sql).toContain(`'${action}'`);
    expect(sql).toContain(`target_type = '${TEST_OFFER_AUDIT_TARGET_TYPE}'`);
    expect(sql).toContain("(audit_log.metadata->'is_test') = 'true'::jsonb");
    expect(sql).not.toContain("metadata->>'is_test'");
    expect(sql).toContain('target_id = offer_versions.id::text');
    expect(sql).toContain('json_agg(marked.version_id order by marked.version_id)');
    expect(sql).not.toContain('audit_log.actor_user_id');
    expect(sql).not.toContain('audit_log.created_at');
    expect(sql).not.toContain("'metadata'");
    expect(sql).not.toContain('pin_hash');
    expect(readFileSync(ALL_TEST_FIXTURE, 'utf8')).toContain(SUPPLY_GATE_SCHEMA_V2);
    expect(readFileSync(MIXED_FIXTURE, 'utf8')).toContain(SUPPLY_GATE_SCHEMA_V2);
    expect(readFileSync(LINKED_NOT_SELECTABLE_FIXTURE, 'utf8')).toContain(SUPPLY_GATE_SCHEMA_V2);
    expect(readFileSync(LINKED_NOT_SELECTABLE_FIXTURE, 'utf8')).toContain(WITHDRAWN_TEST_VERSION);
    expect(readFileSync(FIXTURE, 'utf8')).toContain(SUPPLY_GATE_SCHEMA_V1);
  });
});
