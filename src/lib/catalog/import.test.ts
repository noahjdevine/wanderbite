import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { offerVersionTermsProblem } from '@/lib/offers/catalog-conversion';
import {
  applyCatalogPlan,
  applyGuardProblem,
  buildCatalogPlan,
  buildTestOfferTerms,
  catalogSnapshotHash,
  fetchGooglePlaceCoordinates,
  geocodeWithCache,
  emptyGeocodeCache,
  isTestOfferAuditMarker,
  parseCatalogImportArgs,
  parseCatalogImportDocument,
  TEST_OFFER_AUDIT_TARGET_TYPE,
  TEST_OFFER_MARK_ACTION,
  TEST_OFFER_PUBLISH_ACTION,
  TEST_OFFER_SOURCE,
  type CatalogDbSnapshot,
  type CatalogPlan,
  type CatalogPlanOptions,
  type Geocoder,
} from '@/lib/catalog/import';

const NOW = new Date('2026-06-15T18:00:00.000Z');

function options(overrides: Partial<CatalogPlanOptions> = {}): CatalogPlanOptions {
  return {
    skipInvalid: false,
    refreshCoordinates: false,
    testOffers: false,
    testOffersAllInMarket: false,
    publishRealOffers: false,
    testOfferCapacity: 50,
    resolveDuplicates: [],
    withdrawTestOffers: false,
    markets: [],
    now: NOW,
    sourceLabel: 'fixture',
    outboundDisabled: false,
    apiKeyPresent: true,
    ...overrides,
  };
}

function snapshot(extra?: Partial<CatalogDbSnapshot>): CatalogDbSnapshot {
  return {
    markets: [],
    restaurants: [],
    test_offers: [],
    ...extra,
  };
}

const NEW_MARKET_JSON = JSON.stringify([
  {
    market_slug: 'catalog-test-tx',
    market_name: 'Catalog Test',
    market_state: 'TX',
    market_timezone: 'America/Chicago',
    name: 'North Grill',
    address: '100 North Street',
    city: 'Catalog',
    zip: '75001',
    lat: 33.2,
    lon: -96.7,
    cuisine_tags: 'american',
  },
  {
    market_slug: 'catalog-test-tx',
    market_name: 'Catalog Test',
    market_state: 'TX',
    market_timezone: 'America/Chicago',
    name: 'South Grill',
    address: '200 South Street',
    city: 'Catalog',
    zip: '75002',
    lat: 33.21,
    lon: -96.71,
    cuisine_tags: 'bbq',
  },
  {
    market_slug: 'catalog-test-tx',
    market_name: 'Catalog Test',
    market_state: 'TX',
    market_timezone: 'America/Chicago',
    name: 'East Grill',
    address: '300 East Street',
    city: 'Catalog',
    zip: '75001',
    lat: 33.22,
    lon: -96.69,
    cuisine_tags: 'cafe',
  },
]);

function documentFrom(text: string, format: 'csv' | 'json' = 'json') {
  const parsed = parseCatalogImportDocument(text, format);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

async function planOf(
  text: string,
  snap: CatalogDbSnapshot = snapshot(),
  overrides: Partial<CatalogPlanOptions> = {},
  geocoder: Geocoder | null = null,
  format: 'csv' | 'json' = 'json',
): Promise<CatalogPlan> {
  return buildCatalogPlan({
    document: documentFrom(text, format),
    snapshot: snap,
    options: options(overrides),
    geocoder,
  });
}

describe('catalog import parse', () => {
  it('parses JSON and CSV into the same rows', () => {
    const csv = [
      'market_slug,market_name,market_state,market_timezone,name,address,city,zip,lat,lon,cuisine_tags,is_vegan',
      'catalog-test-tx,Catalog Test,TX,America/Chicago,"North, Grill",100 North Street,Catalog,75001,33.2,-96.7,american|bbq,true',
    ].join('\n');
    const json = JSON.stringify([
      {
        market_slug: 'catalog-test-tx',
        market_name: 'Catalog Test',
        market_state: 'TX',
        market_timezone: 'America/Chicago',
        name: 'North, Grill',
        address: '100 North Street',
        city: 'Catalog',
        zip: '75001',
        lat: 33.2,
        lon: -96.7,
        cuisine_tags: ['american', 'bbq'],
        is_vegan: true,
      },
    ]);
    const fromCsv = documentFrom(csv, 'csv');
    const fromJson = documentFrom(json, 'json');
    expect(fromCsv.errors).toEqual([]);
    expect(fromJson.errors).toEqual([]);
    expect(fromCsv.rows[0]?.name).toBe('North, Grill');
    expect(fromJson.rows[0]?.cuisine_tags).toEqual(['american', 'bbq']);
    expect(fromJson.rows[0]?.is_vegan).toBe(true);
    expect(fromCsv.rows[0]?.zip).toBe('75001');
  });

  it('rejects a bad zip, a one-sided coordinate, an unknown cuisine, and a bad time zone', () => {
    const parsed = parseCatalogImportDocument(
      JSON.stringify([
        {
          market_slug: 'catalog-test-tx',
          name: 'Bad Grill',
          address: '1 Main',
          city: 'Catalog',
          zip: '7500',
          lat: 33.2,
          cuisine_tags: 'not-a-cuisine',
          market_timezone: 'Not/A_Timezone',
          status: 'closed',
        },
      ]),
      'json',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const messages = parsed.document.errors.map((error) => error.message);
    expect(messages).toContain('zip must be a 5-digit US ZIP');
    expect(messages).toContain('lat and lon must both be set or both be empty');
    expect(messages).toContain('cuisine tag not-a-cuisine is not in the cuisine list');
    expect(messages).toContain('market_timezone is not an IANA time zone');
    expect(messages).toContain('status must be active or paused');
  });
});

describe('catalog import plan', () => {
  it('plans a new market and three creates, then a rerun is unchanged', async () => {
    const created = await planOf(NEW_MARKET_JSON);
    expect(created.accepted).toBe(true);
    expect(created.counts.market_create).toBe(1);
    expect(created.counts.create).toBe(3);
    expect(created.actions.filter((action) => action.kind === 'create_market')).toHaveLength(1);
    const market = created.actions.find((action) => action.kind === 'create_market');
    expect(market && market.kind === 'create_market' ? market.timezone : '').toBe('America/Chicago');

    const restaurants = created.actions.flatMap((action) =>
      action.kind === 'create_restaurant' ? [action.restaurant] : [],
    );
    const rerun = await planOf(
      NEW_MARKET_JSON,
      snapshot({
        markets: [
          {
            id: 'market-1',
            slug: 'catalog-test-tx',
            name: 'Catalog Test',
            state: 'TX',
            timezone: 'America/Chicago',
            status: 'active',
          },
        ],
        restaurants: restaurants.map((restaurant, index) => ({
          id: `rest-${index}`,
          market_id: 'market-1',
          name: restaurant.name,
          slug: restaurant.slug,
          address: restaurant.address,
          lat: restaurant.lat,
          lon: restaurant.lon,
          google_place_id: restaurant.google_place_id,
          cuisine_tags: restaurant.cuisine_tags,
          is_vegan: restaurant.is_vegan,
          is_dairy_free: restaurant.is_dairy_free,
          is_halal: restaurant.is_halal,
          price_range: restaurant.price_range,
          neighborhood: restaurant.neighborhood,
          status: restaurant.status,
          current_offer_version_id: null,
          challenge_item_count: 0,
          offer_version_count: 0,
        })),
      }),
    );
    expect(rerun.accepted).toBe(true);
    expect(rerun.counts.create).toBe(0);
    expect(rerun.counts.update).toBe(0);
    expect(rerun.counts.unchanged).toBe(3);
    expect(rerun.actions).toEqual([]);
  });

  it('geocodes a place id, records provenance, and errors when outbound is disabled', async () => {
    const text = JSON.stringify([
      {
        market_slug: 'catalog-test-tx',
        market_name: 'Catalog Test',
        market_state: 'TX',
        market_timezone: 'America/Chicago',
        name: 'Place Grill',
        address: '300 Place Street',
        city: 'Catalog',
        zip: '75001',
        google_place_id: 'place-catalog',
        cuisine_tags: 'cafe',
      },
    ]);
    const geocoder = vi.fn<Geocoder>(async () => ({ lat: 33.25, lon: -96.65 }));
    const planned = await planOf(text, snapshot(), {}, geocoder);
    expect(geocoder).toHaveBeenCalledTimes(1);
    expect(geocoder.mock.calls[0]?.[0]).toEqual({ kind: 'place_id', placeId: 'place-catalog' });
    const create = planned.actions.find((action) => action.kind === 'create_restaurant');
    expect(create && create.kind === 'create_restaurant' ? create.coordinate_provenance : '').toBe(
      'places:place_id',
    );
    expect(create && create.kind === 'create_restaurant' ? create.restaurant.lat : 0).toBe(33.25);

    const disabled = await planOf(text, snapshot(), { outboundDisabled: true }, geocoder);
    expect(disabled.accepted).toBe(false);
    expect(disabled.errors.map((error) => error.message).join(' ')).toMatch(/outbound is disabled/);
    expect(geocoder).toHaveBeenCalledTimes(1);
  });

  it('rejects two rows that share a google place id and names both lines', async () => {
    const planned = await planOf(
      JSON.stringify([
        {
          market_slug: 'catalog-test-tx',
          market_name: 'Catalog Test',
          market_state: 'TX',
          market_timezone: 'America/Chicago',
          name: 'One',
          address: '1 Main',
          city: 'Catalog',
          zip: '75001',
          lat: 33.2,
          lon: -96.7,
          google_place_id: 'same-place',
        },
        {
          market_slug: 'catalog-test-tx',
          market_name: 'Catalog Test',
          market_state: 'TX',
          market_timezone: 'America/Chicago',
          name: 'Two',
          address: '2 Main',
          city: 'Catalog',
          zip: '75002',
          lat: 33.21,
          lon: -96.71,
          google_place_id: 'same-place',
        },
      ]),
    );
    expect(planned.accepted).toBe(false);
    expect(planned.actions).toEqual([]);
    expect(planned.errors.map((error) => error.message).join('\n')).toMatch(/lines 1 and 2/);
  });

  it('reports a hutchins-style duplicate and pauses only the dropped row', async () => {
    const snap = snapshot({
      markets: [
        {
          id: 'market-1',
          slug: 'mckinney-tx',
          name: 'McKinney',
          state: 'TX',
          timezone: 'America/Chicago',
          status: 'active',
        },
      ],
      restaurants: [
        {
          id: 'keep-id',
          market_id: 'market-1',
          name: 'Hutchins BBQ',
          slug: 'hutchins-bbq',
          address: '1301 Test Street, McKinney, TX 75069',
          lat: 33.2113,
          lon: -96.6124,
          google_place_id: 'place-hutchins',
          cuisine_tags: ['bbq'],
          is_vegan: false,
          is_dairy_free: false,
          is_halal: false,
          price_range: null,
          neighborhood: null,
          status: 'active',
          current_offer_version_id: null,
          challenge_item_count: 5,
          offer_version_count: 0,
        },
        {
          id: 'drop-id',
          market_id: 'market-1',
          name: 'Hutchins BBQ',
          slug: 'hutchins-bbq-2',
          address: '1301 Test Street, McKinney, TX 75069',
          lat: null,
          lon: null,
          google_place_id: 'place-hutchins',
          cuisine_tags: ['bbq'],
          is_vegan: false,
          is_dairy_free: false,
          is_halal: false,
          price_range: null,
          neighborhood: null,
          status: 'active',
          current_offer_version_id: null,
          challenge_item_count: 0,
          offer_version_count: 0,
        },
      ],
    });
    const text = JSON.stringify([
      {
        market_slug: 'mckinney-tx',
        name: 'Hutchins BBQ',
        slug: 'hutchins-bbq',
        address: '1301 Test Street, McKinney, TX 75069',
        city: 'McKinney',
        zip: '75069',
        lat: 33.2113,
        lon: -96.6124,
        google_place_id: 'place-hutchins',
        cuisine_tags: 'bbq',
      },
    ]);
    const reported = await planOf(text, snap);
    expect(reported.possible_duplicates.some((pair) => pair.left_slug === 'hutchins-bbq')).toBe(true);
    expect(reported.actions.some((action) => action.kind === 'pause_duplicate')).toBe(false);

    const resolved = await planOf(text, snap, {
      resolveDuplicates: [{ keep: 'hutchins-bbq', drop: 'hutchins-bbq-2' }],
    });
    const pause = resolved.actions.find((action) => action.kind === 'pause_duplicate');
    expect(pause).toMatchObject({
      kind: 'pause_duplicate',
      restaurant_id: 'drop-id',
      slug: 'hutchins-bbq-2',
      keep_slug: 'hutchins-bbq',
      method: 'direct_pause',
    });
    expect(resolved.actions.some((action) => action.kind === 'pause_duplicate' && action.slug === 'hutchins-bbq')).toBe(
      false,
    );
  });

  it('warns when a row is more than 50 km from the market centroid', async () => {
    const planned = await planOf(
      JSON.stringify([
        {
          market_slug: 'catalog-test-tx',
          market_name: 'Catalog Test',
          market_state: 'TX',
          market_timezone: 'America/Chicago',
          name: 'Near Grill',
          address: '1 Main',
          city: 'Catalog',
          zip: '75001',
          lat: 33.2,
          lon: -96.7,
        },
        {
          market_slug: 'catalog-test-tx',
          market_name: 'Catalog Test',
          market_state: 'TX',
          market_timezone: 'America/Chicago',
          name: 'Far Grill',
          address: '9 Main',
          city: 'Catalog',
          zip: '75002',
          lat: 32.7,
          lon: -96.7,
        },
      ]),
    );
    expect(planned.accepted).toBe(true);
    expect(planned.warnings.some((warning) => warning.message.includes('far-grill'))).toBe(true);
    expect(planned.counts.create).toBe(2);
  });

  it('publishes test offers only for active rows that lack a version', async () => {
    const snap = snapshot({
      markets: [
        {
          id: 'market-1',
          slug: 'mckinney-tx',
          name: 'McKinney',
          state: 'TX',
          timezone: 'America/Chicago',
          status: 'active',
        },
      ],
      restaurants: [
        {
          id: 'open-id',
          market_id: 'market-1',
          name: 'Open Grill',
          slug: 'open-grill',
          address: '1 Main, McKinney, TX 75069',
          lat: 33.2,
          lon: -96.6,
          google_place_id: null,
          cuisine_tags: ['american'],
          is_vegan: false,
          is_dairy_free: false,
          is_halal: false,
          price_range: null,
          neighborhood: null,
          status: 'active',
          current_offer_version_id: null,
          challenge_item_count: 0,
          offer_version_count: 0,
        },
        {
          id: 'versioned-id',
          market_id: 'market-1',
          name: 'Versioned Grill',
          slug: 'versioned-grill',
          address: '2 Main, McKinney, TX 75069',
          lat: 33.21,
          lon: -96.61,
          google_place_id: null,
          cuisine_tags: ['bbq'],
          is_vegan: false,
          is_dairy_free: false,
          is_halal: false,
          price_range: null,
          neighborhood: null,
          status: 'active',
          current_offer_version_id: 'version-1',
          challenge_item_count: 0,
          offer_version_count: 1,
        },
      ],
    });
    const fileOnly = await buildCatalogPlan({
      document: { rows: [], errors: [] },
      snapshot: snap,
      options: options({ testOffers: true, markets: ['mckinney-tx'] }),
      geocoder: null,
    });
    expect(fileOnly.actions.filter((action) => action.kind === 'publish_offer')).toHaveLength(0);
    const planned = await buildCatalogPlan({
      document: { rows: [], errors: [] },
      snapshot: snap,
      options: options({ testOffers: true, testOffersAllInMarket: true, markets: ['mckinney-tx'] }),
      geocoder: null,
    });
    const publishes = planned.actions.filter((action) => action.kind === 'publish_offer');
    expect(publishes).toHaveLength(1);
    expect(publishes[0]).toMatchObject({
      restaurant_slug: 'open-grill',
      is_test: true,
      source: TEST_OFFER_SOURCE,
    });
    if (publishes[0]?.kind === 'publish_offer') {
      expect(offerVersionTermsProblem(publishes[0].terms)).toBeNull();
    }
  });

  it('targets only import-file restaurants unless --test-offers-all-in-market is set', async () => {
    const snap = snapshot({
      markets: [
        {
          id: 'market-1',
          slug: 'mckinney-tx',
          name: 'McKinney',
          state: 'TX',
          timezone: 'America/Chicago',
          status: 'active',
        },
      ],
      restaurants: [
        {
          id: 'open-id',
          market_id: 'market-1',
          name: 'Open Grill',
          slug: 'open-grill',
          address: '1 Main, McKinney, TX 75069',
          lat: 33.2,
          lon: -96.6,
          google_place_id: null,
          cuisine_tags: ['american'],
          is_vegan: false,
          is_dairy_free: false,
          is_halal: false,
          price_range: null,
          neighborhood: null,
          status: 'active',
          current_offer_version_id: null,
          challenge_item_count: 0,
          offer_version_count: 0,
        },
        {
          id: 'other-id',
          market_id: 'market-1',
          name: 'Other Grill',
          slug: 'other-grill',
          address: '9 Main, McKinney, TX 75069',
          lat: 33.22,
          lon: -96.62,
          google_place_id: null,
          cuisine_tags: ['bbq'],
          is_vegan: false,
          is_dairy_free: false,
          is_halal: false,
          price_range: null,
          neighborhood: null,
          status: 'active',
          current_offer_version_id: null,
          challenge_item_count: 0,
          offer_version_count: 0,
        },
      ],
    });
    const text = JSON.stringify([
      {
        market_slug: 'mckinney-tx',
        name: 'Open Grill',
        slug: 'open-grill',
        address: '1 Main, McKinney, TX 75069',
        city: 'McKinney',
        zip: '75069',
        lat: 33.2,
        lon: -96.6,
        cuisine_tags: 'american',
      },
    ]);
    const fileOnly = await planOf(text, snap, { testOffers: true, markets: ['mckinney-tx'] });
    expect(
      fileOnly.actions
        .filter((action) => action.kind === 'publish_offer')
        .map((action) => action.restaurant_slug),
    ).toEqual(['open-grill']);
    const marketWide = await planOf(text, snap, {
      testOffers: true,
      testOffersAllInMarket: true,
      markets: ['mckinney-tx'],
    });
    expect(
      marketWide.actions
        .filter((action) => action.kind === 'publish_offer')
        .map((action) => action.restaurant_slug)
        .sort(),
    ).toEqual(['open-grill', 'other-grill']);
  });

  it('refuses below-floor offer terms', async () => {
    const planned = await planOf(
      JSON.stringify([
        {
          market_slug: 'catalog-test-tx',
          market_name: 'Catalog Test',
          market_state: 'TX',
          market_timezone: 'America/Chicago',
          name: 'Cheap Grill',
          address: '1 Main',
          city: 'Catalog',
          zip: '75001',
          lat: 33.2,
          lon: -96.7,
          base_discount_cents: 999,
        },
      ]),
    );
    expect(planned.accepted).toBe(false);
    expect(planned.errors.map((error) => error.message).join(' ')).toMatch(/lowest_tier_below_credit_floor/);
  });
});

describe('catalog import guards', () => {
  it('refuses apply without the env flag, a mismatched confirm, or a stale hash', async () => {
    const planned = await planOf(NEW_MARKET_JSON);
    expect(
      applyGuardProblem({
        applyEnv: undefined,
        confirm: planned.markets,
        plan: planned,
        currentHash: planned.snapshot_hash,
      }),
    ).toMatch(/WANDERBITE_CATALOG_APPLY=1/);
    expect(
      applyGuardProblem({
        applyEnv: '1',
        confirm: ['other-market'],
        plan: planned,
        currentHash: planned.snapshot_hash,
      }),
    ).toMatch(/confirm does not match/);
    expect(
      applyGuardProblem({
        applyEnv: '1',
        confirm: planned.markets,
        plan: planned,
        currentHash: 'stale',
      }),
    ).toMatch(/database changed since plan/);
    expect(
      applyGuardProblem({
        applyEnv: '1',
        confirm: planned.markets,
        plan: planned,
        currentHash: planned.snapshot_hash,
      }),
    ).toBeNull();
    expect(catalogSnapshotHash(snapshot(), planned.markets)).toBe(planned.snapshot_hash);
  });

  it('refuses a non-test offer unless --publish-real-offers is set', async () => {
    const text = JSON.stringify([
      {
        market_slug: 'catalog-test-tx',
        market_name: 'Catalog Test',
        market_state: 'TX',
        market_timezone: 'America/Chicago',
        name: 'Real Grill',
        address: '1 Main',
        city: 'Catalog',
        zip: '75001',
        lat: 33.2,
        lon: -96.7,
        base_discount_cents: 1000,
        is_test_offer: false,
      },
    ]);
    const refused = await planOf(text);
    expect(refused.accepted).toBe(true);
    expect(refused.actions.some((action) => action.kind === 'publish_offer')).toBe(false);
    expect(refused.refused_real_offers.map((row) => row.slug)).toEqual(['real-grill']);
    expect(refused.warnings.map((warning) => warning.message).join(' ')).toMatch(/--publish-real-offers/);
    const allowed = await planOf(text, snapshot(), { publishRealOffers: true });
    const publish = allowed.actions.find((action) => action.kind === 'publish_offer');
    expect(publish).toMatchObject({ is_test: false, restaurant_slug: 'real-grill' });
  });

  it('withdraws a test offer when the mark insert fails', async () => {
    const planned = await planOf(
      JSON.stringify([
        {
          market_slug: 'catalog-test-tx',
          market_name: 'Catalog Test',
          market_state: 'TX',
          market_timezone: 'America/Chicago',
          name: 'Mark Grill',
          address: '1 Main',
          city: 'Catalog',
          zip: '75001',
          lat: 33.2,
          lon: -96.7,
          is_test_offer: true,
        },
      ]),
    );
    const snap = snapshot();
    const withdrawn: string[] = [];
    await expect(
      applyCatalogPlan({
        plan: planned,
        confirm: planned.markets,
        actorId: '00000000-0000-4000-8000-000000000001',
        applyEnv: '1',
        exec: {
          loadSnapshot: async () => snap,
          assertAdmin: async () => true,
          insertMarket: async () => ({ id: 'market-1' }),
          insertOrg: async () => ({ id: 'org-1' }),
          insertRestaurant: async () => ({ id: 'rest-1' }),
          updateRestaurant: async () => undefined,
          upsertDraft: async () => ({ id: 'draft-1' }),
          publishOfferVersion: async () => ({ published: true, versionId: 'version-1' }),
          insertTestMark: async () => {
            throw new Error('stamp failed');
          },
          retireRestaurant: async () => ({ ok: true, result: 'paused' }),
          pauseRestaurant: async () => undefined,
          withdrawOfferVersion: async (versionId) => {
            withdrawn.push(versionId);
            return { withdrawn: true };
          },
        },
      }),
    ).rejects.toThrow(/withdrew version version-1/);
    expect(withdrawn).toEqual(['version-1']);
    expect(catalogSnapshotHash(snap, planned.markets)).toBe(planned.snapshot_hash);
  });

  it('parses resolve-duplicate and the default plan mode', () => {
    const args = parseCatalogImportArgs([
      '--file',
      'rows.json',
      '--resolve-duplicate',
      'keep=hutchins-bbq',
      'drop=hutchins-bbq-2',
      '--test-offers',
      '--confirm',
      'mckinney-tx',
    ]);
    expect(args.mode).toBe('plan');
    expect(args.resolveDuplicates).toEqual([{ keep: 'hutchins-bbq', drop: 'hutchins-bbq-2' }]);
    expect(args.testOffers).toBe(true);
    expect(args.testOffersAllInMarket).toBe(false);
    expect(args.publishRealOffers).toBe(false);
    expect(args.confirm).toEqual(['mckinney-tx']);
    const wide = parseCatalogImportArgs(['--test-offers-all-in-market', '--publish-real-offers']);
    expect(wide.testOffers).toBe(true);
    expect(wide.testOffersAllInMarket).toBe(true);
    expect(wide.publishRealOffers).toBe(true);
  });
});

describe('catalog import geocode http', () => {
  it('reads place details and address search without calling the network in the test', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).not.toContain('live.example');
      const body = url.includes('/place/details/')
        ? { status: 'OK', result: { geometry: { location: { lat: 33.1, lng: -96.2 } } } }
        : { status: 'OK', candidates: [{ geometry: { location: { lat: 33.3, lng: -96.4 } } }] };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const details = await fetchGooglePlaceCoordinates(
      { kind: 'place_id', placeId: 'place-1' },
      'test-key',
      fetchImpl as typeof fetch,
    );
    const address = await fetchGooglePlaceCoordinates(
      { kind: 'address', query: '1 Main, Catalog, 75001' },
      'test-key',
      fetchImpl as typeof fetch,
    );
    expect(details).toEqual({ lat: 33.1, lon: -96.2 });
    expect(address).toEqual({ lat: 33.3, lon: -96.4 });
    const fetchPlace = vi.fn<Geocoder>(async () => ({ lat: 33.1, lon: -96.2 }));
    const cached = await geocodeWithCache(
      { kind: 'place_id', placeId: 'place-1' },
      emptyGeocodeCache(),
      fetchPlace,
    );
    const again = await geocodeWithCache(
      { kind: 'place_id', placeId: 'place-1' },
      cached.cache,
      vi.fn<Geocoder>(async () => {
        throw new Error('cache miss');
      }),
    );
    expect(fetchPlace).toHaveBeenCalledTimes(1);
    expect(again.result).toEqual({ lat: 33.1, lon: -96.2 });
  });
});

describe('catalog import test offer terms', () => {
  it('is identical in UTC and America/Chicago and passes the publication checks', () => {
    const script = `
      import { buildTestOfferTerms } from './src/lib/catalog/import.ts';
      const terms = buildTestOfferTerms({
        now: new Date('2026-03-08T08:30:00.000Z'),
        timezone: 'America/Chicago',
        capacityMaxRedemptions: 50,
      });
      process.stdout.write(JSON.stringify(terms));
    `;
    const outputs = ['UTC', 'America/Chicago'].map((timeZone) => {
      const result = spawnSync('node_modules/.bin/tsx', ['-e', script], {
        cwd: process.cwd(),
        env: { ...process.env, TZ: timeZone },
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout;
    });
    expect(outputs[0]).toBe(outputs[1]);
    const terms = buildTestOfferTerms({
      now: new Date('2026-03-08T08:30:00.000Z'),
      timezone: 'America/Chicago',
      capacityMaxRedemptions: 50,
    });
    expect(terms.timezone).toBe('America/Chicago');
    expect(terms.capacity_timezone).toBe('America/Chicago');
    expect(terms.tiers).toEqual([{ threshold_cents: 4000, discount_cents: 1000 }]);
    expect(offerVersionTermsProblem(terms)).toBeNull();
    const until = Date.parse(terms.valid_until ?? '');
    const from = Date.parse(terms.valid_from ?? '');
    expect(until).toBeGreaterThan(from + 840 * 60 * 60 * 1000);
  });
});

describe('test offer audit marker', () => {
  it('matches offer.test_mark and a legacy offer.publish row with boolean is_test', () => {
    expect(
      isTestOfferAuditMarker({
        action: TEST_OFFER_MARK_ACTION,
        targetType: TEST_OFFER_AUDIT_TARGET_TYPE,
        isTest: true,
      }),
    ).toBe(true);
    expect(
      isTestOfferAuditMarker({
        action: TEST_OFFER_PUBLISH_ACTION,
        targetType: TEST_OFFER_AUDIT_TARGET_TYPE,
        isTest: true,
      }),
    ).toBe(true);
    expect(
      isTestOfferAuditMarker({
        action: TEST_OFFER_PUBLISH_ACTION,
        targetType: TEST_OFFER_AUDIT_TARGET_TYPE,
        isTest: false,
      }),
    ).toBe(false);
    expect(
      isTestOfferAuditMarker({
        action: TEST_OFFER_PUBLISH_ACTION,
        targetType: TEST_OFFER_AUDIT_TARGET_TYPE,
        isTest: 'true',
      }),
    ).toBe(false);
    expect(
      isTestOfferAuditMarker({
        action: TEST_OFFER_MARK_ACTION,
        targetType: TEST_OFFER_AUDIT_TARGET_TYPE,
        isTest: 'true',
      }),
    ).toBe(false);
    expect(
      isTestOfferAuditMarker({
        action: TEST_OFFER_PUBLISH_ACTION,
        targetType: TEST_OFFER_AUDIT_TARGET_TYPE,
        isTest: undefined,
      }),
    ).toBe(false);
    expect(
      isTestOfferAuditMarker({
        action: TEST_OFFER_PUBLISH_ACTION,
        targetType: TEST_OFFER_AUDIT_TARGET_TYPE,
        isTest: null,
      }),
    ).toBe(false);
    expect(
      isTestOfferAuditMarker({
        action: 'offer.withdraw',
        targetType: TEST_OFFER_AUDIT_TARGET_TYPE,
        isTest: true,
      }),
    ).toBe(false);
    expect(
      isTestOfferAuditMarker({
        action: TEST_OFFER_MARK_ACTION,
        targetType: 'restaurant',
        isTest: true,
      }),
    ).toBe(false);
  });
});
