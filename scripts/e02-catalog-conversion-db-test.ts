// Disposable Docker Postgres only. No hosted URL, credentials, project link, or network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  OFFER_VERSION_TERMS_PARITY_CASES,
  offerVersionTermsProblem,
  parseCatalogConversionInput,
  type OfferVersionTerms,
} from '../src/lib/offers/catalog-conversion';

type Sql = (query: string) => string;

const MARKET = 'e020db00-0000-4000-8000-000000000001';
const ORG = 'e020db00-0000-4000-8000-000000000002';
const RESTAURANT = 'e020db00-0000-4000-8000-000000000003';
const ACTIVE_OFFER = 'e020db00-0000-4000-8000-000000000004';
const INACTIVE_OFFER = 'e020db00-0000-4000-8000-000000000005';
const VERSION = 'e020db00-0000-4000-8000-000000000006';

function text(value: string | null): string {
  if (value == null) return 'null';
  return `'${value.replaceAll("'", "''")}'`;
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value);
  assert.ok(!serialized.includes('$catalog$'));
  return `$catalog$${serialized}$catalog$::jsonb`;
}

function sqlTermsCall(terms: OfferVersionTerms): string {
  return `select coalesce(public.offer_version_terms_ok(
    ${json(terms.tiers)},
    ${json(terms.boosts)},
    ${text(terms.timezone)},
    ${text(terms.valid_from)}::timestamptz,
    ${text(terms.valid_until)}::timestamptz,
    ${text(terms.capacity_timezone)},
    ${text(terms.capacity_window_kind)},
    ${terms.capacity_max_redemptions == null ? 'null' : terms.capacity_max_redemptions}
  ), '');`;
}

export function runE02CatalogConversionDbTest(args: {
  sql: Sql;
  root: string;
}): void {
  for (const testCase of OFFER_VERSION_TERMS_PARITY_CASES) {
    const typescriptResult = offerVersionTermsProblem(testCase.terms);
    assert.equal(typescriptResult, testCase.expected, `${testCase.name}: TypeScript expectation`);
    const databaseResult = args.sql(sqlTermsCall(testCase.terms));
    assert.equal(
      databaseResult,
      testCase.expected ?? '',
      `${testCase.name}: SQL and TypeScript publication validators differ`,
    );
  }

  args.sql(`
    insert into public.markets (id, name, timezone, status, slug, state, country, currency)
    values (
      '${MARKET}', 'Synthetic Conversion Market', 'America/Chicago', 'active',
      'mckinney-tx', 'TX', 'US', 'USD'
    );
    insert into public.restaurant_orgs (id, name, market_id)
    values ('${ORG}', 'Synthetic Conversion Org', '${MARKET}');
    insert into public.restaurants (
      id, org_id, market_id, name, slug, address, lat, lon, status, google_place_id
    ) values (
      '${RESTAURANT}', '${ORG}', '${MARKET}', 'Synthetic Export Restaurant',
      'synthetic-export-restaurant', '100 Synthetic Export Street, McKinney, TX',
      33.1984, -96.6397, 'active', 'synthetic-export-place'
    );
    insert into public.restaurant_offers (
      id, restaurant_id, discount_amount_cents, min_spend_cents,
      max_redemptions_per_month, active
    ) values
      ('${ACTIVE_OFFER}', '${RESTAURANT}', 1000, 4000, 50, true),
      ('${INACTIVE_OFFER}', '${RESTAURANT}', 1200, 4500, 25, false);
    insert into public.offer_versions (
      id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
      capacity_timezone, capacity_window_kind, capacity_max_redemptions,
      boost_session_minutes, published_by
    ) values (
      '${VERSION}', '${RESTAURANT}', 'America/Chicago',
      '2026-01-01T00:00:00Z', '2028-01-01T00:00:00Z',
      '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb,
      '[]'::jsonb,
      '{"exclude_tax":true,"exclude_tip":true,"categories":[]}'::jsonb,
      'America/Chicago', 'calendar_month', 50, null, null
    );
    update public.restaurants
    set current_offer_version_id = '${VERSION}'
    where id = '${RESTAURANT}';
  `);

  try {
    const exportSql = readFileSync(
      path.join(args.root, 'scripts/sql/e02-catalog-conversion-export.sql'),
      'utf8',
    );
    const raw = args.sql(exportSql);
    const parsedJson = JSON.parse(raw) as unknown;
    const parsed = parseCatalogConversionInput(parsedJson);
    assert.ok(parsed.ok, parsed.ok ? undefined : parsed.message);
    assert.equal(parsed.input.schema, 'wanderbite.e02.catalog_conversion.v1');
    assert.equal(parsed.input.launch_market.id, MARKET);
    assert.equal(parsed.input.restaurants.length, 1);
    assert.equal(parsed.input.restaurants[0]?.id, RESTAURANT);
    assert.equal(parsed.input.restaurants[0]?.address, '100 Synthetic Export Street, McKinney, TX');
    assert.equal(parsed.input.restaurants[0]?.google_place_id, 'synthetic-export-place');
    assert.deepEqual(
      parsed.input.legacy_offers.map((offer) => [offer.id, offer.active]),
      [
        [ACTIVE_OFFER, true],
        [INACTIVE_OFFER, false],
      ],
    );
    assert.equal(parsed.input.offer_versions[0]?.id, VERSION);
    assert.deepEqual(parsed.input.offer_versions[0]?.tiers, [
      { threshold_cents: 4000, discount_cents: 1000 },
    ]);
    assert.deepEqual(parsed.input.decisions, []);
    assert.deepEqual(parsed.input.coordinate_decisions, []);
  } finally {
    args.sql(`
      update public.restaurants set current_offer_version_id = null where id = '${RESTAURANT}';
      delete from public.offer_versions where id = '${VERSION}';
      delete from public.restaurant_offers where restaurant_id = '${RESTAURANT}';
      delete from public.restaurants where id = '${RESTAURANT}';
      delete from public.restaurant_orgs where id = '${ORG}';
      delete from public.markets where id = '${MARKET}';
    `);
  }
}
