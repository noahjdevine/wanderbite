import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { subMonths } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { MEMBER_FLAGS } from '@/lib/challenges/supply-simulation';
import {
  SUPPLY_GATE_COHORT,
  SUPPLY_GATE_DENOMINATOR,
  explainSupplyBinding,
  firstScoredMonth,
  parseSupplySnapshot,
  runSupplyGate,
  type SupplySnapshot,
} from '@/lib/challenges/supply-gate';

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

  it('fails the thin fixture and passes once padded', () => {
    const thin = loadFixture();
    const failed = runSupplyGate({ snapshot: thin, seeds });
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

    const again = runSupplyGate({ snapshot: thin, seeds });
    expect(again.text).toBe(failed.text);

    const paddedSnapshot = padSnapshot(thin, PASS_PADDING);
    const padded = runSupplyGate({ snapshot: paddedSnapshot, seeds });
    expect(padded.result).toBe('PASS');
    expect(padded.matchedMin).toBe(SUPPLY_GATE_DENOMINATOR);
    expect(padded.trialsFailed).toBe(0);
    expect(padded.text).toContain('PASS: E02 supply gate');

    const paddedPath = path.join(os.tmpdir(), `e02-padded-${process.pid}.json`);
    writeFileSync(paddedPath, JSON.stringify(paddedSnapshot));
    const paddedCli = runCli(['--snapshot', paddedPath, '--trials', '20']);
    expect(paddedCli.status).toBe(0);
    expect(paddedCli.output).toContain('PASS: E02 supply gate');

    const removed = runSupplyGate({ snapshot: thin, seeds: [1] });
    expect(removed.result).toBe('FAIL');
  }, 180_000);
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
