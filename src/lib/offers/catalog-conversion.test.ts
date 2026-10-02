import { afterEach, describe, expect, it } from 'vitest';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CATALOG_CONVERSION_SCHEMA,
  OFFER_VERSION_TERMS_PARITY_CASES,
  buildCatalogConversionManifest,
  offerVersionTermsProblem,
  parseCatalogConversionInput,
  parseSyntheticCatalogConversionInput,
  type SyntheticCatalogConversionInput,
} from '@/lib/offers/catalog-conversion';
import {
  confinedConversionPath,
  parseCatalogConversionArgs,
} from '../../../scripts/e02-catalog-conversion';

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = path.join(
  ROOT,
  'scripts/fixtures/e02-catalog-conversion-synthetic.json',
);
const TEST_DIR = path.join(ROOT, '.supply-gate/catalog-conversion-vitest');

function syntheticFixture(): SyntheticCatalogConversionInput {
  const parsed = parseSyntheticCatalogConversionInput(
    JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown,
  );
  if (!parsed.ok) throw new Error(parsed.message);
  return structuredClone(parsed.input);
}

function onlyRestaurants(
  input: SyntheticCatalogConversionInput,
  restaurantIds: string[],
): SyntheticCatalogConversionInput {
  const ids = new Set(restaurantIds);
  input.restaurants = input.restaurants.filter((row) => ids.has(row.id));
  input.legacy_offers = input.legacy_offers.filter(
    (row) => row.restaurant_id != null && ids.has(row.restaurant_id),
  );
  input.decisions = input.decisions.filter((row) => ids.has(row.restaurant_id));
  input.coordinate_decisions = input.coordinate_decisions.filter((row) =>
    ids.has(row.restaurant_id),
  );
  input.mock_coordinate_results = input.mock_coordinate_results.filter((row) =>
    ids.has(row.restaurant_id),
  );
  return input;
}

function asRealInput(input: SyntheticCatalogConversionInput): Record<string, unknown> {
  const { mock_coordinate_results: _mock, ...rest } = input;
  return { ...rest, schema: CATALOG_CONVERSION_SCHEMA };
}

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('catalog conversion manifest', () => {
  it('maps legacy tiers exactly and keeps pair and carried floors separate', () => {
    const input = syntheticFixture();
    const manifest = buildCatalogConversionManifest(input);
    const byId = new Map(manifest.restaurants.map((row) => [row.restaurant_id, row]));
    const ten = byId.get('e0200000-0000-4000-8000-000000000011');
    const mocked = byId.get('e0200000-0000-4000-8000-000000000012');
    const twenty = byId.get('e0200000-0000-4000-8000-000000000013');
    const ambiguous = byId.get('e0200000-0000-4000-8000-000000000014');

    expect(ten?.status).toBe('ready');
    expect(ten?.source_legacy_offer_id).toBe('e0200000-0000-4000-8000-000000000111');
    expect(ten?.proposed_terms?.tiers).toEqual([
      { threshold_cents: 4000, discount_cents: 1000 },
    ]);
    expect(ten?.proposed_terms?.capacity_max_redemptions).toBe(50);
    expect(ten?.provenance.capacity).toContain('unapproved');
    expect(mocked?.status).toBe('ready');
    expect(mocked?.coordinates.status).toBe('mock_proposed');
    expect(twenty?.diagnostics.carried_candidate).toBe(true);
    expect(ambiguous?.status).toBe('ambiguous');
    expect(ambiguous?.unresolved_decisions).toContain('legacy_offer:multiple');
    expect(manifest.diagnostics.pair.passes).toBe(true);
    expect(manifest.diagnostics.carried).toEqual({
      passes: true,
      qualifying_restaurants: 1,
      floor_cents: 2000,
    });
  });

  it('requires two distinct $10 restaurants for pair, while neither passes carried', () => {
    const input = syntheticFixture();
    onlyRestaurants(input, [
      'e0200000-0000-4000-8000-000000000011',
      'e0200000-0000-4000-8000-000000000012',
    ]);
    const manifest = buildCatalogConversionManifest(input);
    expect(manifest.diagnostics.pair).toEqual({
      passes: true,
      distinct_candidates: 2,
      qualifying_pairs: 1,
      floor_cents: 2000,
    });
    expect(manifest.diagnostics.carried.passes).toBe(false);

    onlyRestaurants(input, ['e0200000-0000-4000-8000-000000000011']);
    expect(buildCatalogConversionManifest(input).diagnostics.pair.passes).toBe(false);
  });

  it('classifies missing, inactive, invalid, and multiple offers without selecting one', () => {
    const base = syntheticFixture();
    const restaurantId = 'e0200000-0000-4000-8000-000000000011';
    onlyRestaurants(base, [restaurantId]);

    const missing = structuredClone(base);
    missing.legacy_offers = [];
    expect(buildCatalogConversionManifest(missing).restaurants[0]).toMatchObject({
      status: 'blocked',
      source_legacy_offer_id: null,
      unresolved_decisions: ['legacy_offer:missing'],
    });

    const inactive = structuredClone(base);
    inactive.legacy_offers[0]!.active = false;
    expect(
      buildCatalogConversionManifest(inactive).restaurants[0]?.unresolved_decisions,
    ).toContain('legacy_offer:inactive');

    const invalid = structuredClone(base);
    invalid.legacy_offers[0]!.discount_amount_cents = 5000;
    expect(buildCatalogConversionManifest(invalid).restaurants[0]).toMatchObject({
      status: 'blocked',
      diagnostics: { publication: { ok: false, reason: 'tier_above_threshold' } },
    });

    const multiple = structuredClone(base);
    multiple.legacy_offers.push({
      ...structuredClone(multiple.legacy_offers[0]!),
      id: 'e0200000-0000-4000-8000-000000000199',
      active: false,
    });
    expect(buildCatalogConversionManifest(multiple).restaurants[0]).toMatchObject({
      status: 'ambiguous',
      source_legacy_offer_id: null,
      unresolved_decisions: ['legacy_offer:multiple'],
    });
  });

  it('blocks missing partner terms, provenance, publication, and capacity approval', () => {
    const input = syntheticFixture();
    onlyRestaurants(input, ['e0200000-0000-4000-8000-000000000011']);
    const decision = input.decisions[0]!;
    decision.timezone = null;
    decision.exclusions = null;
    decision.boosts = null;
    decision.provenance_ref = null;
    decision.capacity_max_redemptions_approved = false;
    decision.publication_approved = false;
    const [row] = buildCatalogConversionManifest(input).restaurants;
    expect(row?.status).toBe('blocked');
    expect(row?.unresolved_decisions).toEqual(
      expect.arrayContaining([
        'partner_terms:missing_timezone',
        'partner_terms:missing_exclusions',
        'partner_terms:missing_boost_decision',
        'partner_terms:missing_provenance',
        'capacity:reviewed_approval_required',
        'publication:reviewed_approval_required',
      ]),
    );
  });

  it('uses only serialized evaluation_at for validity boundaries', () => {
    const input = syntheticFixture();
    onlyRestaurants(input, ['e0200000-0000-4000-8000-000000000011']);
    input.evaluation_at = '2026-10-15T18:00:00.000Z';
    const boundary = new Date(
      Date.parse(input.evaluation_at) + 840 * 60 * 60 * 1000,
    ).toISOString();
    input.decisions[0]!.valid_from = input.evaluation_at;
    input.decisions[0]!.valid_until = boundary;
    expect(
      buildCatalogConversionManifest(input).restaurants[0]?.diagnostics.validity.reason,
    ).toBe('expires_before_deadline');

    input.decisions[0]!.valid_until = new Date(Date.parse(boundary) + 1).toISOString();
    expect(
      buildCatalogConversionManifest(input).restaurants[0]?.diagnostics.validity,
    ).toEqual({ ok: true, reason: 'ok' });

    input.evaluation_at = '2028-01-01T00:00:00.000Z';
    expect(
      buildCatalogConversionManifest(input).restaurants[0]?.diagnostics.validity.reason,
    ).toBe('expires_before_deadline');
  });

  it('preserves valid coordinates and requires reviewed evidence for real invalid rows', () => {
    const synthetic = syntheticFixture();
    const preserved = buildCatalogConversionManifest(synthetic).restaurants.find(
      (row) => row.restaurant_id === 'e0200000-0000-4000-8000-000000000011',
    );
    expect(preserved?.coordinates).toEqual({
      status: 'preserved',
      lat: 33.1984,
      lon: -96.6397,
    });

    const parsedReal = parseCatalogConversionInput(asRealInput(synthetic));
    if (!parsedReal.ok) throw new Error(parsedReal.message);
    const realMissing = buildCatalogConversionManifest(parsedReal.input).restaurants.find(
      (row) => row.restaurant_id === 'e0200000-0000-4000-8000-000000000012',
    );
    expect(realMissing).toMatchObject({
      status: 'blocked',
      coordinates: { status: 'missing' },
      diagnostics: { geography: { ok: false, reason: 'missing_coordinates' } },
    });

    parsedReal.input.coordinate_decisions.push({
      restaurant_id: 'e0200000-0000-4000-8000-000000000012',
      lat: 33.199,
      lon: -96.638,
      provenance_ref: 'review:coordinate-12',
    });
    expect(
      buildCatalogConversionManifest(parsedReal.input).restaurants.find(
        (row) => row.restaurant_id === 'e0200000-0000-4000-8000-000000000012',
      ),
    ).toMatchObject({
      status: 'ready',
      coordinates: { status: 'reviewed' },
      provenance: { coordinates: 'review:coordinate-12' },
    });
  });

  it('keeps mock matching synthetic-only and marks multiple matches ambiguous', () => {
    const input = syntheticFixture();
    const mock = input.mock_coordinate_results[0]!;
    mock.matches.push({
      ...mock.matches[0]!,
      place_id: mock.matches[0]!.place_id,
      lat: 33.21,
    });
    const row = buildCatalogConversionManifest(input).restaurants.find(
      (entry) => entry.restaurant_id === mock.restaurant_id,
    );
    expect(row).toMatchObject({
      status: 'ambiguous',
      coordinates: { status: 'mock_ambiguous' },
    });

    const realWithMockKey = {
      ...structuredClone(input),
      schema: CATALOG_CONVERSION_SCHEMA,
    };
    const rejected = parseCatalogConversionInput(realWithMockKey);
    expect(rejected).toEqual({
      ok: false,
      message: 'catalog conversion input rejected: (root)',
    });
  });
});

describe('catalog conversion parsing and publication parity cases', () => {
  it('reports paths, not rejected values, for bad input', () => {
    const fixture = syntheticFixture();
    const missingEvaluation = { ...asRealInput(fixture), evaluation_at: undefined };
    const parsed = parseCatalogConversionInput(missingEvaluation);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('expected rejection');
    expect(parsed.message).toContain('evaluation_at');
    expect(parsed.message).not.toContain('Synthetic Ten');

    const forbidden = { ...asRealInput(fixture), service_role_secret: 'do-not-print-me' };
    expect(parseCatalogConversionInput(forbidden)).toEqual({
      ok: false,
      message: 'catalog conversion input rejected: forbidden key',
    });
  });

  it('matches every declared TypeScript publication expectation', () => {
    for (const testCase of OFFER_VERSION_TERMS_PARITY_CASES) {
      expect(offerVersionTermsProblem(testCase.terms), testCase.name).toBe(
        testCase.expected,
      );
    }
  });
});

describe('catalog conversion CLI boundaries', () => {
  it('confines all paths to .supply-gate and exposes no mock option', () => {
    expect(confinedConversionPath('.supply-gate/input.json')).toContain(
      `${path.sep}.supply-gate${path.sep}`,
    );
    expect(() => confinedConversionPath('outside.json')).toThrow(
      'catalog conversion path rejected',
    );
    expect(parseCatalogConversionArgs([])).toEqual({
      input: '.supply-gate/catalog-conversion-input.json',
      output: '.supply-gate/catalog-conversion-manifest.json',
    });
    expect(() => parseCatalogConversionArgs(['--mock', 'fixture.json'])).toThrow(
      'catalog conversion unknown argument',
    );
  });

  it('writes only a confined manifest and prints aggregate values', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const synthetic = syntheticFixture();
    const real = asRealInput(synthetic);
    const inputPath = path.join(TEST_DIR, 'input.json');
    const unchangedPath = path.join(TEST_DIR, 'input-copy.json');
    const outputPath = path.join(TEST_DIR, 'manifest.json');
    writeFileSync(inputPath, `${JSON.stringify(real)}\n`, { mode: 0o600 });
    copyFileSync(inputPath, unchangedPath);
    const tsx = path.join(
      ROOT,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
    );
    const result = spawnSync(
      tsx,
      [
        'scripts/e02-catalog-conversion.ts',
        '--input',
        path.relative(ROOT, inputPath),
        '--output',
        path.relative(ROOT, outputPath),
      ],
      { cwd: ROOT, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('catalog_conversion evaluation_at=');
    for (const forbiddenValue of [
      'Synthetic Ten',
      'Fixture Street',
      'synthetic-place-20',
      'e0200000-0000-4000-8000-000000000011',
    ]) {
      expect(result.stdout).not.toContain(forbiddenValue);
      expect(result.stderr).not.toContain(forbiddenValue);
    }
    expect(readFileSync(inputPath, 'utf8')).toBe(readFileSync(unchangedPath, 'utf8'));
    expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toMatchObject({
      schema: 'wanderbite.e02.catalog_conversion_manifest.v1',
      source_schema: CATALOG_CONVERSION_SCHEMA,
      synthetic: false,
    });
  });

  it('keeps source and export offline, independent, and privacy allowlisted', () => {
    const core = readFileSync(
      path.join(ROOT, 'src/lib/offers/catalog-conversion.ts'),
      'utf8',
    );
    const cli = readFileSync(
      path.join(ROOT, 'scripts/e02-catalog-conversion.ts'),
      'utf8',
    );
    for (const source of [core, cli]) {
      expect(source).not.toContain('@supabase/');
      expect(source).not.toContain('supabase-admin');
      expect(source).not.toContain('process.env');
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toContain('Date.now(');
      expect(source).not.toMatch(/new Date\(\s*\)/);
    }
    const sql = readFileSync(
      path.join(ROOT, 'scripts/sql/e02-catalog-conversion-export.sql'),
      'utf8',
    );
    expect(sql).toContain('begin transaction read only');
    expect(sql).toContain("'wanderbite.e02.catalog_conversion.v1'");
    expect(sql).toContain("'google_place_id', r.google_place_id");
    expect(sql).toContain("'address', r.address");
    expect(sql).toContain("'id', o.id");
    expect(sql).not.toMatch(/user_profiles|entitlement_credits|pin_hash|verification_code|photo_url/);
    expect(readFileSync(path.join(ROOT, '.gitignore'), 'utf8')).toContain(
      '/.supply-gate/',
    );
  });
});
