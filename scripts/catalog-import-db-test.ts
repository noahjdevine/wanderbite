// Disposable Docker Postgres only. No hosted URL, credentials, project link, or network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { offerVersionTermsProblem, type OfferVersionTerms } from '../src/lib/offers/catalog-conversion';
import { SUPPLY_GATE_SCHEMA_V2, parseSupplySnapshot, runSupplyGate, type SupplySnapshot } from '../src/lib/challenges/supply-gate';
import {
  TEST_OFFER_AUDIT_TARGET_TYPE,
  TEST_OFFER_MARK_ACTION,
  TEST_OFFER_PUBLISH_ACTION,
  isTestOfferAuditMarker,
  applyCatalogPlan,
  buildCatalogPlan,
  importRowsFromSnapshot,
  parseCatalogImportDocument,
  type CatalogDbSnapshot,
  type CatalogExecutor,
  type CatalogPlan,
  type CatalogRestaurantPatch,
  type Geocoder,
} from '../src/lib/catalog/import';

type Sql = (query: string) => string;

const ADMIN = 'c4710900-0000-4000-8000-0000000000aa';
const NOW = new Date();

const WITH_COORDS = [
  'hutchins-bbq',
  'ricks-chophouse',
  'local-yocal-bbq-grill',
  'the-yard',
  'smittys-bbq',
  'blue-corn-cafe',
] as const;

const WITHOUT_COORDS = [
  '1117',
  'bobs-steak-chop-house',
  'centro-on-the-square',
  'harvest-at-the-masonic',
  'hutchins-bbq-2',
  'kimiya-japanese-cuisine-mckinney',
  'kyoto-hibachi-sushi-bar',
  'lockwood-distilling-company-mckinney',
  'shun-by-yama-sushi',
  'sugarbacon-proper-kitchen',
  'the-common-table',
  'the-garage',
  'tupps-brewery',
  'umai-sushi',
  'uncorkd-bar-grill',
  'union-bear-brewing-mckinney',
  'urban-grill-and-wine-bar-mckinney',
  'zen-sushi-grill',
] as const;

function q(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function jsonb(value: unknown): string {
  const serialized = JSON.stringify(value);
  assert.ok(!serialized.includes('$cj$'));
  return `$cj$${serialized}$cj$::jsonb`;
}

function textArray(values: string[]): string {
  if (values.length === 0) return `'{}'::text[]`;
  return `array[${values.map((value) => q(value)).join(', ')}]::text[]`;
}

function num(value: number | null): string {
  return value == null ? 'null' : String(value);
}

function geocoder(): Geocoder {
  return async (request) => {
    if (request.kind === 'place_id') {
      let hash = 0;
      for (const char of request.placeId) hash = (hash + char.charCodeAt(0)) % 40;
      return { lat: 33.19 + hash / 1000, lon: -96.62 };
    }
    return { lat: 33.2, lon: -96.61 };
  };
}

function markedCurrentVersionIds(sql: Sql, action: string): string[] {
  const raw = sql(`
    select coalesce(json_agg(marked.id order by marked.id), '[]'::json)::text
    from (
      select distinct v.id::text as id
      from public.offer_versions v
      join public.restaurants r
        on r.current_offer_version_id = v.id
       and r.id = v.restaurant_id
      where r.status = 'active'
        and v.withdrawn_from_selection_at is null
        and exists (
          select 1
          from public.admin_audit_log a
          where a.target_type = ${q(TEST_OFFER_AUDIT_TARGET_TYPE)}
            and a.target_id = v.id::text
            and (a.metadata->'is_test') = 'true'::jsonb
            and a.action = ${q(action)}
        )
    ) marked;
  `);
  return JSON.parse(raw) as string[];
}

function readSupplySnapshot(sql: Sql, root: string): SupplySnapshot {
  const exportSql = readFileSync(path.join(root, 'scripts/sql/e02-supply-snapshot.sql'), 'utf8');
  const parsed = parseSupplySnapshot(JSON.parse(sql(exportSql)) as unknown);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.snapshot;
}

type SupplyPreflight = {
  schema: string;
  exported_at: string;
  string_true_test_markers: { count: number; target_ids: string[] };
  test_versions: number;
  active_restaurants: number;
  active_with_current_version: number;
  active_without_current_version: number;
  catalog_import_duplicate_candidates: number;
};

function readSupplyPreflight(sql: Sql, root: string): SupplyPreflight {
  const text = readFileSync(path.join(root, 'scripts/sql/e02-supply-preflight.sql'), 'utf8');
  return JSON.parse(sql(text)) as SupplyPreflight;
}

function activeRestaurantCount(sql: Sql, current: 'any' | 'with' | 'without'): number {
  const version =
    current === 'with'
      ? ' and current_offer_version_id is not null'
      : current === 'without'
        ? ' and current_offer_version_id is null'
        : '';
  return Number(sql(`select count(*)::int from public.restaurants where status = 'active'${version};`));
}

function assertTestOfferVersionIds(sql: Sql, snapshot: SupplySnapshot): void {
  assert.equal(snapshot.schema, SUPPLY_GATE_SCHEMA_V2);
  if (snapshot.schema !== SUPPLY_GATE_SCHEMA_V2) return;
  const expected = [
    ...new Set([
      ...markedCurrentVersionIds(sql, TEST_OFFER_MARK_ACTION),
      ...markedCurrentVersionIds(sql, TEST_OFFER_PUBLISH_ACTION),
    ]),
  ].sort();
  assert.deepEqual(snapshot.test_offer_version_ids, expected);
  const blocked = new Set(
    JSON.parse(
      sql(`
        select coalesce(json_agg(v.id::text), '[]'::json)::text
        from public.offer_versions v
        where v.withdrawn_from_selection_at is not null
           or not exists (
             select 1
             from public.restaurants r
             where r.current_offer_version_id = v.id
               and r.id = v.restaurant_id
               and r.status = 'active'
           );
      `),
    ) as string[],
  );
  for (const id of snapshot.test_offer_version_ids) {
    assert.equal(blocked.has(id), false);
  }
}

function loadSnapshot(sql: Sql): CatalogDbSnapshot {
  const raw = sql(`
    select json_build_object(
      'markets', coalesce((
        select json_agg(json_build_object(
          'id', id, 'slug', slug, 'name', name, 'state', state,
          'timezone', timezone, 'status', status
        )) from public.markets
      ), '[]'::json),
      'restaurants', coalesce((
        select json_agg(json_build_object(
          'id', r.id,
          'market_id', r.market_id,
          'name', r.name,
          'slug', r.slug,
          'address', r.address,
          'lat', r.lat,
          'lon', r.lon,
          'google_place_id', r.google_place_id,
          'cuisine_tags', to_json(r.cuisine_tags),
          'is_vegan', r.is_vegan,
          'is_dairy_free', r.is_dairy_free,
          'is_halal', r.is_halal,
          'price_range', r.price_range,
          'neighborhood', r.neighborhood,
          'status', r.status,
          'current_offer_version_id', r.current_offer_version_id,
          'challenge_item_count', (select count(*) from public.challenge_items ci where ci.restaurant_id = r.id),
          'offer_version_count', (select count(*) from public.offer_versions ov where ov.restaurant_id = r.id)
        )) from public.restaurants r
      ), '[]'::json),
      'test_offers', coalesce((
        select json_agg(json_build_object(
          'version_id', marked.version_id,
          'restaurant_id', r.id,
          'market_slug', m.slug
        ))
        from (
          select distinct on (a.target_id)
            a.target_id as version_id,
            a.metadata->>'restaurant_id' as restaurant_id
          from public.admin_audit_log a
          where a.target_type = 'offer_version'
            and (a.metadata->'is_test') = 'true'::jsonb
            and a.action in ('offer.test_mark', 'offer.publish')
          order by a.target_id, case when a.action = 'offer.test_mark' then 0 else 1 end
        ) marked
        join public.restaurants r on r.id::text = marked.restaurant_id
        join public.markets m on m.id = r.market_id
      ), '[]'::json)
    )::text;
  `);
  return JSON.parse(raw) as CatalogDbSnapshot;
}

function executor(sql: Sql): CatalogExecutor {
  return {
    loadSnapshot: async () => loadSnapshot(sql),
    async assertAdmin(actorId) {
      return sql(`select role from public.user_profiles where id = ${q(actorId)}::uuid;`) === 'admin';
    },
    async insertMarket(market) {
      const id = sql(`
        insert into public.markets (name, slug, state, timezone, country, currency, status)
        values (
          ${q(market.name)}, ${q(market.slug)}, ${q(market.state)}, ${q(market.timezone)},
          ${q(market.country)}, ${q(market.currency)}, ${q(market.status)}
        )
        returning id;
      `);
      return { id };
    },
    async insertOrg(org) {
      const id = sql(`
        insert into public.restaurant_orgs (name, market_id)
        values (${q(org.name)}, ${q(org.market_id)}::uuid)
        returning id;
      `);
      return { id };
    },
    async insertRestaurant(row) {
      const id = sql(`
        insert into public.restaurants (
          org_id, market_id, name, slug, address, lat, lon, google_place_id, cuisine_tags,
          is_vegan, is_dairy_free, is_halal, price_range, neighborhood, status
        ) values (
          ${q(row.org_id)}::uuid, ${q(row.market_id)}::uuid, ${q(row.name)}, ${q(row.slug)},
          ${q(row.address)}, ${num(row.lat)}, ${num(row.lon)},
          ${row.google_place_id ? q(row.google_place_id) : 'null'},
          ${row.cuisine_tags ? textArray(row.cuisine_tags) : 'null'},
          ${row.is_vegan}, ${row.is_dairy_free}, ${row.is_halal},
          ${row.price_range ? q(row.price_range) : 'null'},
          ${row.neighborhood ? q(row.neighborhood) : 'null'},
          ${q(row.status)}
        )
        returning id;
      `);
      return { id };
    },
    async updateRestaurant(id, patch: CatalogRestaurantPatch) {
      const sets: string[] = [];
      if (patch.name != null) sets.push(`name = ${q(patch.name)}`);
      if (patch.slug != null) sets.push(`slug = ${q(patch.slug)}`);
      if (patch.address != null) sets.push(`address = ${q(patch.address)}`);
      if (patch.lat != null) sets.push(`lat = ${num(patch.lat)}`);
      if (patch.lon != null) sets.push(`lon = ${num(patch.lon)}`);
      if (patch.google_place_id !== undefined) {
        sets.push(`google_place_id = ${patch.google_place_id ? q(patch.google_place_id) : 'null'}`);
      }
      if (patch.cuisine_tags !== undefined) {
        sets.push(`cuisine_tags = ${patch.cuisine_tags ? textArray(patch.cuisine_tags) : 'null'}`);
      }
      if (patch.is_vegan != null) sets.push(`is_vegan = ${patch.is_vegan}`);
      if (patch.is_dairy_free != null) sets.push(`is_dairy_free = ${patch.is_dairy_free}`);
      if (patch.is_halal != null) sets.push(`is_halal = ${patch.is_halal}`);
      if (patch.price_range !== undefined) {
        sets.push(`price_range = ${patch.price_range ? q(patch.price_range) : 'null'}`);
      }
      if (patch.neighborhood !== undefined) {
        sets.push(`neighborhood = ${patch.neighborhood ? q(patch.neighborhood) : 'null'}`);
      }
      if (patch.status != null) sets.push(`status = ${q(patch.status)}`);
      if (sets.length === 0) return;
      sql(`update public.restaurants set ${sets.join(', ')} where id = ${q(id)}::uuid;`);
    },
    async upsertDraft(draft) {
      const id = sql(`
        insert into public.offer_drafts (
          restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
          capacity_timezone, capacity_window_kind, capacity_max_redemptions, boost_session_minutes
        ) values (
          ${q(draft.restaurant_id)}::uuid,
          ${q(draft.terms.timezone ?? '')},
          ${q(draft.terms.valid_from ?? '')}::timestamptz,
          ${q(draft.terms.valid_until ?? '')}::timestamptz,
          ${jsonb(draft.terms.tiers)},
          ${jsonb(draft.terms.boosts)},
          ${jsonb(draft.exclusions)},
          ${q(draft.terms.capacity_timezone ?? '')},
          ${q(draft.terms.capacity_window_kind ?? '')},
          ${draft.terms.capacity_max_redemptions ?? 'null'},
          null
        )
        on conflict (restaurant_id) do update set
          timezone = excluded.timezone,
          valid_from = excluded.valid_from,
          valid_until = excluded.valid_until,
          tiers = excluded.tiers,
          boosts = excluded.boosts,
          exclusions = excluded.exclusions,
          capacity_timezone = excluded.capacity_timezone,
          capacity_window_kind = excluded.capacity_window_kind,
          capacity_max_redemptions = excluded.capacity_max_redemptions,
          updated_at = now()
        returning id;
      `);
      return { id };
    },
    async publishOfferVersion(draftId, actorId) {
      const raw = sql(
        `select public.publish_offer_version(${q(draftId)}::uuid, ${q(actorId)}::uuid)::text;`,
      );
      const body = JSON.parse(raw) as { published?: boolean; version_id?: string; error?: string };
      if (body.published !== true || !body.version_id) return { published: false, error: body.error ?? 'publish failed' };
      return { published: true, versionId: body.version_id };
    },
    async insertTestMark(versionId, actorId, metadata) {
      sql(`
        insert into public.admin_audit_log (actor_user_id, action, target_type, target_id, metadata)
        values (
          ${q(actorId)}::uuid, 'offer.test_mark', 'offer_version', ${q(versionId)},
          ${jsonb(metadata)}
        );
      `);
    },
    async retireRestaurant(restaurantId, actorId) {
      const raw = sql(
        `select public.retire_restaurant(${q(restaurantId)}::uuid, ${q(actorId)}::uuid)::text;`,
      );
      const body = JSON.parse(raw) as { ok?: boolean; result?: string; error?: string };
      return { ok: body.ok === true, result: body.result, error: body.error };
    },
    async pauseRestaurant(restaurantId, actorId, metadata) {
      sql(`update public.restaurants set status = 'paused' where id = ${q(restaurantId)}::uuid;`);
      sql(`
        insert into public.admin_audit_log (actor_user_id, action, target_type, target_id, metadata)
        values (
          ${q(actorId)}::uuid, 'restaurant.deactivate', 'restaurant', ${q(restaurantId)},
          ${jsonb({ ...metadata, source: 'catalog-import', result: 'paused' })}
        );
      `);
    },
    async withdrawOfferVersion(versionId, actorId) {
      const raw = sql(
        `select public.withdraw_offer_version(${q(versionId)}::uuid, ${q(actorId)}::uuid)::text;`,
      );
      const body = JSON.parse(raw) as { withdrawn?: boolean; error?: string };
      return { withdrawn: body.withdrawn === true, error: body.error };
    },
  };
}

async function planFile(
  rows: unknown[],
  sql: Sql,
  overrides: Partial<Parameters<typeof buildCatalogPlan>[0]['options']> = {},
): Promise<CatalogPlan> {
  const parsed = parseCatalogImportDocument(JSON.stringify(rows), 'json');
  if (!parsed.ok) throw new Error(parsed.message);
  return buildCatalogPlan({
    document: parsed.document,
    snapshot: loadSnapshot(sql),
    options: {
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
      sourceLabel: 'db-test',
      outboundDisabled: false,
      apiKeyPresent: true,
      ...overrides,
    },
    geocoder: geocoder(),
  });
}

function cleanup(sql: Sql): void {
  sql(`
    update public.restaurants
    set current_offer_version_id = null
    where market_id in (select id from public.markets where slug in ('catalog-import-test', 'catalog-import-marks', 'mckinney-tx'));
    delete from public.capacity_reservations
    where restaurant_id in (
      select id from public.restaurants
      where market_id in (select id from public.markets where slug in ('catalog-import-test', 'catalog-import-marks', 'mckinney-tx'))
    );
    delete from public.challenge_items
    where restaurant_id in (
      select id from public.restaurants
      where market_id in (select id from public.markets where slug in ('catalog-import-test', 'catalog-import-marks', 'mckinney-tx'))
    );
    delete from public.challenge_cycles where user_id = ${q(ADMIN)}::uuid;
    delete from public.offer_versions
    where restaurant_id in (
      select id from public.restaurants
      where market_id in (select id from public.markets where slug in ('catalog-import-test', 'catalog-import-marks', 'mckinney-tx'))
    );
    delete from public.offer_drafts
    where restaurant_id in (
      select id from public.restaurants
      where market_id in (select id from public.markets where slug in ('catalog-import-test', 'catalog-import-marks', 'mckinney-tx'))
    );
    delete from public.restaurants
    where market_id in (select id from public.markets where slug in ('catalog-import-test', 'catalog-import-marks', 'mckinney-tx'));
    delete from public.restaurant_orgs
    where market_id in (select id from public.markets where slug in ('catalog-import-test', 'catalog-import-marks', 'mckinney-tx'));
    delete from public.markets where slug in ('catalog-import-test', 'catalog-import-marks', 'mckinney-tx');
    delete from public.admin_audit_log where actor_user_id = ${q(ADMIN)}::uuid;
    delete from public.user_profiles where id = ${q(ADMIN)}::uuid;
    delete from auth.users where id = ${q(ADMIN)}::uuid;
  `);
}

function ensureAdmin(sql: Sql): void {
  sql(`
    insert into auth.users (id) values (${q(ADMIN)}::uuid);
    insert into public.user_profiles (id, email, role)
    values (${q(ADMIN)}::uuid, 'catalog-import-test@example.com', 'admin');
  `);
}

const NEW_MARKET_ROWS = [
  {
    market_slug: 'catalog-import-test',
    market_name: 'Catalog Import Test',
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
    market_slug: 'catalog-import-test',
    market_name: 'Catalog Import Test',
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
    market_slug: 'catalog-import-test',
    market_name: 'Catalog Import Test',
    market_state: 'TX',
    market_timezone: 'America/Chicago',
    name: 'Place Grill',
    address: '300 Place Street',
    city: 'Catalog',
    zip: '75001',
    google_place_id: 'place-catalog-grill',
    cuisine_tags: 'cafe',
  },
];

function shapedRow(slug: string, index: number, withCoords: boolean) {
  const hutchins = slug === 'hutchins-bbq' || slug === 'hutchins-bbq-2';
  return {
    slug,
    name: hutchins ? 'Hutchins BBQ' : slug.replaceAll('-', ' '),
    address: hutchins
      ? '1301 Test Street, McKinney, TX 75069'
      : `${100 + index} Test Street, McKinney, TX 75069`,
    placeId: hutchins ? 'place-hutchins' : `place-${slug}`,
    lat: withCoords ? 33.2 + index / 1000 : null,
    lon: withCoords ? -96.61 - index / 1000 : null,
    cuisine: slug.includes('sushi') || slug.includes('japanese') || slug.includes('hibachi') ? 'sushi' : 'american',
    explicitOffer: slug === 'ricks-chophouse',
  };
}

function seedShaped(sql: Sql): void {
  const marketId = 'c4710900-0000-4000-8000-000000000001';
  sql(`
    insert into public.markets (id, name, slug, state, timezone, status, country, currency)
    values (
      ${q(marketId)}::uuid, 'McKinney', 'mckinney-tx', 'TX', 'America/Chicago', 'active', 'US', 'USD'
    );
  `);
  const rows = [
    ...WITH_COORDS.map((slug, index) => shapedRow(slug, index, true)),
    ...WITHOUT_COORDS.map((slug, index) => shapedRow(slug, index + WITH_COORDS.length, false)),
  ];
  assert.equal(rows.length, 24);
  assert.equal(rows.filter((row) => row.lat == null).length, 18);
  rows.forEach((row, index) => {
    const orgId = `c4710900-0000-4000-8000-${(0x100 + index).toString(16).padStart(12, '0')}`;
    const restaurantId = `c4710900-0000-4000-8000-${(0x200 + index).toString(16).padStart(12, '0')}`;
    sql(`
      insert into public.restaurant_orgs (id, name, market_id)
      values (${q(orgId)}::uuid, ${q(row.name)}, ${q(marketId)}::uuid);
      insert into public.restaurants (
        id, org_id, market_id, name, slug, address, lat, lon, google_place_id, cuisine_tags, status
      ) values (
        ${q(restaurantId)}::uuid, ${q(orgId)}::uuid, ${q(marketId)}::uuid, ${q(row.name)}, ${q(row.slug)},
        ${q(row.address)}, ${num(row.lat)}, ${num(row.lon)}, ${q(row.placeId)},
        ${textArray([row.cuisine])}, 'active'
      );
    `);
  });
  const keepId = sql(`select id from public.restaurants where slug = 'hutchins-bbq';`);
  for (let month = 1; month <= 5; month += 1) {
    const cycleId = `c4710900-0000-4000-8000-${(0x300 + month).toString(16).padStart(12, '0')}`;
    sql(`
      insert into public.challenge_cycles (id, user_id, cycle_month, status)
      values (
        ${q(cycleId)}::uuid, ${q(ADMIN)}::uuid, ${q(`2026-0${month}-01`)}::date, 'active'
      );
      insert into public.challenge_items (cycle_id, restaurant_id, slot_number, status)
      values (${q(cycleId)}::uuid, ${q(keepId)}::uuid, 1, 'assigned');
    `);
  }
}

function importRowsForShaped(): Record<string, unknown>[] {
  const coordIndex = new Map<string, number>(WITH_COORDS.map((slug, index) => [slug, index]));
  return [...WITH_COORDS, ...WITHOUT_COORDS.filter((slug) => slug !== 'hutchins-bbq-2')].map((slug) => {
    const row = shapedRow(slug, coordIndex.get(slug) ?? 0, coordIndex.has(slug));
    const record: Record<string, unknown> = {
      market_slug: 'mckinney-tx',
      name: row.name,
      slug: row.slug,
      address: row.address,
      city: 'McKinney',
      zip: '75069',
      google_place_id: row.placeId,
      cuisine_tags: row.cuisine,
    };
    if (row.lat != null && row.lon != null) {
      record.lat = row.lat;
      record.lon = row.lon;
    }
    if (row.explicitOffer) {
      record.base_discount_cents = 1000;
      record.is_test_offer = false;
    }
    return record;
  });
}

export async function runCatalogImportDbTest(args: { sql: Sql; root: string }): Promise<void> {
  cleanup(args.sql);
  try {
    ensureAdmin(args.sql);
    const exec = executor(args.sql);
    const created = await planFile(NEW_MARKET_ROWS, args.sql);
    assert.equal(created.counts.market_create, 1, 'new market');
    assert.equal(created.counts.create, 3, 'three restaurant creates');
    assert.equal(created.accepted, true);
    args.sql(`
      insert into public.markets (name, slug, state, timezone, status, country, currency)
      values ('Intruder', 'catalog-import-test', 'TX', 'America/Chicago', 'active', 'US', 'USD');
    `);
    await assert.rejects(
      () => applyCatalogPlan({ plan: created, confirm: created.markets, actorId: ADMIN, applyEnv: '1', exec }),
      /database changed since plan/,
    );
    args.sql(`delete from public.markets where slug = 'catalog-import-test';`);
    await applyCatalogPlan({ plan: created, confirm: created.markets, actorId: ADMIN, applyEnv: '1', exec });
    assert.equal(
      args.sql(`
        select count(*) from public.restaurants r
        join public.markets m on m.id = r.market_id
        where m.slug = 'catalog-import-test'
          and r.lat is not null and r.lon is not null and r.location is not null;
      `),
      '3',
    );
    const rerun = await planFile(NEW_MARKET_ROWS, args.sql);
    assert.equal(rerun.counts.unchanged, 3);
    assert.equal(rerun.counts.create, 0);
    assert.equal(rerun.counts.update, 0);
    assert.deepEqual(rerun.actions, []);
    cleanup(args.sql);
    ensureAdmin(args.sql);

    seedShaped(args.sql);
    args.sql(`
      insert into public.restaurant_orgs (id, name, market_id)
      values (
        'c4710900-0000-4000-8000-0000000000c1'::uuid,
        'Not In File',
        (select id from public.markets where slug = 'mckinney-tx')
      );
      insert into public.restaurants (
        id, org_id, market_id, name, slug, address, lat, lon, google_place_id, cuisine_tags, status
      ) values (
        'c4710900-0000-4000-8000-0000000000c2'::uuid,
        'c4710900-0000-4000-8000-0000000000c1'::uuid,
        (select id from public.markets where slug = 'mckinney-tx'),
        'Not In File', 'not-in-file', '900 Outside File Street, McKinney, TX 75069',
        33.22, -96.6, 'place-not-in-file', array['american']::text[], 'active'
      );
    `);
    const fileRows = importRowsForShaped();
    assert.equal(fileRows.length, 23);
    const fileOnly = await planFile(fileRows, args.sql, {
      testOffers: true,
      markets: ['mckinney-tx'],
      resolveDuplicates: [{ keep: 'hutchins-bbq', drop: 'hutchins-bbq-2' }],
    });
    assert.equal(
      fileOnly.actions.some((action) => action.kind === 'publish_offer' && action.restaurant_slug === 'not-in-file'),
      false,
    );
    assert.ok(fileOnly.refused_real_offers.some((row) => row.slug === 'ricks-chophouse'));
    assert.equal(
      fileOnly.actions.some((action) => action.kind === 'publish_offer' && action.restaurant_slug === 'ricks-chophouse'),
      false,
    );
    assert.ok(fileOnly.warnings.some((warning) => warning.message.includes('--publish-real-offers')));
    const marketWide = await planFile(fileRows, args.sql, {
      testOffers: true,
      testOffersAllInMarket: true,
      publishRealOffers: true,
      markets: ['mckinney-tx'],
      resolveDuplicates: [{ keep: 'hutchins-bbq', drop: 'hutchins-bbq-2' }],
    });
    assert.equal(
      marketWide.actions.some((action) => action.kind === 'publish_offer' && action.restaurant_slug === 'not-in-file'),
      true,
    );
    args.sql(`
      delete from public.restaurants where id = 'c4710900-0000-4000-8000-0000000000c2'::uuid;
      delete from public.restaurant_orgs where id = 'c4710900-0000-4000-8000-0000000000c1'::uuid;
    `);
    const shaped = await planFile(fileRows, args.sql, {
      testOffers: true,
      publishRealOffers: true,
      markets: ['mckinney-tx'],
      resolveDuplicates: [{ keep: 'hutchins-bbq', drop: 'hutchins-bbq-2' }],
    });
    assert.equal(shaped.accepted, true, shaped.errors.map((error) => error.message).join('; '));
    assert.ok(shaped.possible_duplicates.some((pair) => pair.right_slug === 'hutchins-bbq-2' || pair.left_slug === 'hutchins-bbq-2'));
    const pause = shaped.actions.find((action) => action.kind === 'pause_duplicate');
    assert.ok(pause && pause.kind === 'pause_duplicate');
    assert.equal(pause.slug, 'hutchins-bbq-2');
    assert.equal(pause.method, 'direct_pause');
    const keepItemsBefore = args.sql(`
      select count(*) from public.challenge_items ci
      join public.restaurants r on r.id = ci.restaurant_id
      where r.slug = 'hutchins-bbq';
    `);
    assert.equal(keepItemsBefore, '5');
    await applyCatalogPlan({
      plan: shaped,
      confirm: ['mckinney-tx'],
      actorId: ADMIN,
      applyEnv: '1',
      exec,
    });
    assert.equal(args.sql(`select status from public.restaurants where slug = 'hutchins-bbq-2';`), 'paused');
    assert.equal(args.sql(`select count(*) from public.restaurants where slug = 'hutchins-bbq-2';`), '1');
    assert.equal(
      args.sql(`
        select count(*) from public.challenge_items ci
        join public.restaurants r on r.id = ci.restaurant_id
        where r.slug = 'hutchins-bbq';
      `),
      '5',
    );
    assert.equal(
      args.sql(`
        select count(*) from public.restaurants r
        join public.markets m on m.id = r.market_id
        where m.slug = 'mckinney-tx';
      `),
      '24',
    );
    assert.equal(
      args.sql(`
        select count(*) from public.restaurants r
        join public.markets m on m.id = r.market_id
        where m.slug = 'mckinney-tx' and r.status = 'active'
          and (r.lat is null or r.lon is null or r.location is null);
      `),
      '0',
    );
    const published = JSON.parse(
      args.sql(`
        select coalesce(json_agg(json_build_object(
          'slug', r.slug,
          'terms_problem', coalesce(public.offer_version_terms_ok(
            v.tiers, v.boosts, v.timezone, v.valid_from, v.valid_until,
            v.capacity_timezone, v.capacity_window_kind, v.capacity_max_redemptions
          ), ''),
          'selectable', public.version_selection_ok(v.id, now()),
          'tiers', v.tiers,
          'boosts', v.boosts,
          'timezone', v.timezone,
          'valid_from', v.valid_from,
          'valid_until', v.valid_until,
          'capacity_timezone', v.capacity_timezone,
          'capacity_window_kind', v.capacity_window_kind,
          'capacity_max_redemptions', v.capacity_max_redemptions,
          'is_test', coalesce((
            select mark.metadata->>'is_test'
            from public.admin_audit_log mark
            where mark.action = 'offer.test_mark' and mark.target_id = v.id::text
            limit 1
          ), '')
        )), '[]'::json)::text
        from public.offer_versions v
        join public.restaurants r on r.current_offer_version_id = v.id and r.id = v.restaurant_id
        where r.market_id = (select id from public.markets where slug = 'mckinney-tx');
      `),
    ) as Array<{
      slug: string;
      terms_problem: string;
      selectable: boolean;
      tiers: OfferVersionTerms['tiers'];
      boosts: OfferVersionTerms['boosts'];
      timezone: string;
      valid_from: string;
      valid_until: string;
      capacity_timezone: string;
      capacity_window_kind: string;
      capacity_max_redemptions: number;
      is_test: string;
    }>;
    assert.equal(published.length, 23);
    for (const version of published) {
      assert.equal(version.terms_problem, '', version.slug);
      assert.equal(version.selectable, true, version.slug);
      assert.equal(
        offerVersionTermsProblem({
          tiers: version.tiers,
          boosts: version.boosts,
          timezone: version.timezone,
          valid_from: version.valid_from,
          valid_until: version.valid_until,
          capacity_timezone: version.capacity_timezone,
          capacity_window_kind: version.capacity_window_kind,
          capacity_max_redemptions: version.capacity_max_redemptions,
        }),
        null,
        version.slug,
      );
    }
    assert.equal(published.filter((version) => version.is_test === 'true').length, 22);
    assert.equal(published.filter((version) => version.slug === 'ricks-chophouse' && version.is_test !== 'true').length, 1);
    assert.equal(
      args.sql(`
        select coalesce(a.metadata->>'is_test', '')
        from public.admin_audit_log a
        join public.restaurants r on r.current_offer_version_id::text = a.target_id
        where r.slug = 'ricks-chophouse' and a.action = 'offer.publish';
      `),
      '',
    );

    const again = await planFile(fileRows, args.sql, {
      testOffers: true,
      markets: ['mckinney-tx'],
      resolveDuplicates: [{ keep: 'hutchins-bbq', drop: 'hutchins-bbq-2' }],
    });
    assert.equal(again.counts.create, 0);
    assert.equal(again.counts.update, 0);
    assert.equal(again.counts.publish, 0);
    assert.equal(again.counts.pause, 0);
    assert.equal(again.counts.unchanged, 23);

    const parsedSnapshot = readSupplySnapshot(args.sql, args.root);
    assertTestOfferVersionIds(args.sql, parsedSnapshot);
    if (parsedSnapshot.schema === SUPPLY_GATE_SCHEMA_V2) {
      const ricks = args.sql(`select current_offer_version_id::text from public.restaurants where slug = 'ricks-chophouse';`);
      assert.equal(parsedSnapshot.test_offer_version_ids.includes(ricks), false);
      assert.equal(parsedSnapshot.test_offer_version_ids.length, 22);
    }
    const gate = runSupplyGate({
      snapshot: parsedSnapshot,
      seeds: Array.from({ length: 20 }, (_, index) => index + 1),
    });
    process.stdout.write(gate.text);
    assert.match(gate.catalogLine, /selectable_offer_version=([1-9]\d*)/);
    assert.match(gate.catalogLine, /missing_coordinates=0/);
    assert.match(gate.text, /test_supply selectable=\d+ of \d+/);
    assert.match(gate.text, /result=(PASS|FAIL) \(all supply\) /);
    assert.match(gate.text, /real_supply_result=(PASS|FAIL) matched_min=\d+\/192 trials_failed=\d+\/20 /);

    const withdraw = await buildCatalogPlan({
      document: { rows: [], errors: [] },
      snapshot: loadSnapshot(args.sql),
      options: {
        skipInvalid: false,
        refreshCoordinates: false,
        testOffers: false,
        testOffersAllInMarket: false,
        publishRealOffers: false,
        testOfferCapacity: 50,
        resolveDuplicates: [],
        withdrawTestOffers: true,
        markets: ['mckinney-tx'],
        now: NOW,
        sourceLabel: 'db-test',
        outboundDisabled: true,
        apiKeyPresent: false,
      },
      geocoder: null,
    });
    assert.equal(withdraw.counts.withdraw, 22);
    await applyCatalogPlan({
      plan: withdraw,
      confirm: ['mckinney-tx'],
      actorId: ADMIN,
      applyEnv: '1',
      exec,
    });
    assert.equal(
      args.sql(`
        select count(*) from public.offer_versions v
        join public.restaurants r on r.id = v.restaurant_id
        join public.admin_audit_log a
          on a.target_type = 'offer_version'
         and a.target_id = v.id::text
         and (a.metadata->'is_test') = 'true'::jsonb
         and a.action in ('offer.test_mark', 'offer.publish')
        where r.market_id = (select id from public.markets where slug = 'mckinney-tx')
          and v.withdrawn_from_selection_at is not null;
      `),
      '22',
    );
    assert.equal(
      args.sql(`
        select r.slug || ':' || (public.version_selection_ok(r.current_offer_version_id, now()))::text
        from public.restaurants r
        where r.slug = 'ricks-chophouse';
      `),
      'ricks-chophouse:true',
    );
    assert.equal(
      args.sql(`
        select count(*) from public.restaurants
        where slug <> 'ricks-chophouse'
          and market_id = (select id from public.markets where slug = 'mckinney-tx')
          and current_offer_version_id is not null;
      `),
      '0',
    );
    await runMarkFailureAndBothStyles(args.sql, args.root);
  } finally {
    cleanup(args.sql);
  }
}

async function runMarkFailureAndBothStyles(sql: Sql, root: string): Promise<void> {
  const market = 'c4710900-0000-4000-8000-0000000000d1';
  sql(`
    insert into public.markets (id, name, slug, state, timezone, status, country, currency)
    values (
      ${q(market)}::uuid, 'Mark Test', 'catalog-import-marks', 'TX', 'America/Chicago', 'active', 'US', 'USD'
    );
    insert into public.restaurant_orgs (id, name, market_id)
    values ('c4710900-0000-4000-8000-0000000000d2'::uuid, 'Fail Mark', ${q(market)}::uuid);
    insert into public.restaurants (
      id, org_id, market_id, name, slug, address, lat, lon, cuisine_tags, status
    ) values (
      'c4710900-0000-4000-8000-0000000000d3'::uuid,
      'c4710900-0000-4000-8000-0000000000d2'::uuid,
      ${q(market)}::uuid, 'Fail Mark Grill', 'fail-mark-grill',
      '1 Fail Street, Marks, TX 75001', 33.2, -96.61, array['american']::text[], 'active'
    );
  `);
  const failPlan = await planFile(
    [
      {
        market_slug: 'catalog-import-marks',
        name: 'Fail Mark Grill',
        slug: 'fail-mark-grill',
        address: '1 Fail Street, Marks, TX 75001',
        city: 'Marks',
        zip: '75001',
        lat: 33.2,
        lon: -96.61,
        cuisine_tags: 'american',
      },
    ],
    sql,
    { testOffers: true, markets: ['catalog-import-marks'] },
  );
  assert.equal(failPlan.counts.publish, 1);
  const real = executor(sql);
  const failing: CatalogExecutor = {
    ...real,
    async insertTestMark() {
      throw new Error('stamp failed');
    },
  };
  await assert.rejects(
    () =>
      applyCatalogPlan({
        plan: failPlan,
        confirm: failPlan.markets,
        actorId: ADMIN,
        applyEnv: '1',
        exec: failing,
      }),
    /withdrew version/,
  );
  assert.equal(
    sql(`select current_offer_version_id is null from public.restaurants where slug = 'fail-mark-grill';`),
    't',
  );
  assert.equal(
    sql(`
      select withdrawn_from_selection_at is not null
      from public.offer_versions
      where restaurant_id = (select id from public.restaurants where slug = 'fail-mark-grill');
    `),
    't',
  );
  assert.equal(
    sql(`
      select count(*) from public.admin_audit_log
      where action = 'offer.test_mark'
        and target_id = (
          select id::text from public.offer_versions
          where restaurant_id = (select id from public.restaurants where slug = 'fail-mark-grill')
        );
    `),
    '0',
  );

  for (const [slug, name, id, org] of [
    ['legacy-mark-grill', 'Legacy Mark Grill', 'c4710900-0000-4000-8000-0000000000d4', 'c4710900-0000-4000-8000-0000000000d5'],
    ['new-mark-grill', 'New Mark Grill', 'c4710900-0000-4000-8000-0000000000d6', 'c4710900-0000-4000-8000-0000000000d7'],
    ['string-mark-grill', 'String Mark Grill', 'c4710900-0000-4000-8000-0000000000d8', 'c4710900-0000-4000-8000-0000000000d9'],
  ] as const) {
    sql(`
      insert into public.restaurant_orgs (id, name, market_id)
      values (${q(org)}::uuid, ${q(name)}, ${q(market)}::uuid);
      insert into public.restaurants (
        id, org_id, market_id, name, slug, address, lat, lon, cuisine_tags, status
      ) values (
        ${q(id)}::uuid, ${q(org)}::uuid, ${q(market)}::uuid, ${q(name)}, ${q(slug)},
        ${q(`2 ${name} Street, Marks, TX 75001`)}, 33.21, -96.62, array['bbq']::text[], 'active'
      );
    `);
  }
  const both = await planFile(
    [
      {
        market_slug: 'catalog-import-marks',
        name: 'Legacy Mark Grill',
        slug: 'legacy-mark-grill',
        address: '2 Legacy Mark Grill Street, Marks, TX 75001',
        city: 'Marks',
        zip: '75001',
        lat: 33.21,
        lon: -96.62,
        cuisine_tags: 'bbq',
      },
      {
        market_slug: 'catalog-import-marks',
        name: 'New Mark Grill',
        slug: 'new-mark-grill',
        address: '2 New Mark Grill Street, Marks, TX 75001',
        city: 'Marks',
        zip: '75001',
        lat: 33.21,
        lon: -96.62,
        cuisine_tags: 'bbq',
      },
      {
        market_slug: 'catalog-import-marks',
        name: 'String Mark Grill',
        slug: 'string-mark-grill',
        address: '2 String Mark Grill Street, Marks, TX 75001',
        city: 'Marks',
        zip: '75001',
        lat: 33.21,
        lon: -96.62,
        cuisine_tags: 'bbq',
      },
    ],
    sql,
    { testOffers: true, markets: ['catalog-import-marks'] },
  );
  assert.equal(both.actions.filter((action) => action.kind === 'publish_offer').length, 3);
  await applyCatalogPlan({
    plan: both,
    confirm: both.markets,
    actorId: ADMIN,
    applyEnv: '1',
    exec: real,
  });
  sql(`
    update public.admin_audit_log
    set metadata = coalesce(metadata, '{}'::jsonb) || '{"is_test": true}'::jsonb
    where action = 'offer.publish'
      and target_id = (
        select current_offer_version_id::text from public.restaurants where slug = 'legacy-mark-grill'
      );
    delete from public.admin_audit_log
    where action = 'offer.test_mark'
      and target_id = (
        select current_offer_version_id::text from public.restaurants where slug = 'legacy-mark-grill'
      );
    update public.admin_audit_log
    set metadata = '{"is_test": "true", "restaurant_id": "c4710900-0000-4000-8000-0000000000d8"}'::jsonb
    where action = 'offer.publish'
      and target_id = (
        select current_offer_version_id::text from public.restaurants where slug = 'string-mark-grill'
      );
    delete from public.admin_audit_log
    where action = 'offer.test_mark'
      and target_id = (
        select current_offer_version_id::text from public.restaurants where slug = 'string-mark-grill'
      );
  `);
  assert.equal(
    sql(`
      select coalesce(metadata->>'is_test', '')
      from public.admin_audit_log
      where action = 'offer.publish'
        and target_id = (
          select current_offer_version_id::text from public.restaurants where slug = 'new-mark-grill'
        );
    `),
    '',
  );
  const markedSnapshot = readSupplySnapshot(sql, root);
  assertTestOfferVersionIds(sql, markedSnapshot);
  if (markedSnapshot.schema === SUPPLY_GATE_SCHEMA_V2) {
    const legacyId = sql(`select current_offer_version_id::text from public.restaurants where slug = 'legacy-mark-grill';`);
    const newId = sql(`select current_offer_version_id::text from public.restaurants where slug = 'new-mark-grill';`);
    const withdrawnId = sql(`
      select id::text from public.offer_versions
      where restaurant_id = (select id from public.restaurants where slug = 'fail-mark-grill');
    `);
    const stringId = sql(`select current_offer_version_id::text from public.restaurants where slug = 'string-mark-grill';`);
    const legacyIsTest = JSON.parse(
      sql(`
        select (metadata->'is_test')::text
        from public.admin_audit_log
        where action = 'offer.publish' and target_id = ${q(legacyId)};
      `),
    ) as unknown;
    const stringIsTest = JSON.parse(
      sql(`
        select (metadata->'is_test')::text
        from public.admin_audit_log
        where action = 'offer.publish' and target_id = ${q(stringId)};
      `),
    ) as unknown;
    assert.equal(legacyIsTest, true);
    assert.equal(stringIsTest, 'true');
    assert.equal(
      isTestOfferAuditMarker({
        action: TEST_OFFER_PUBLISH_ACTION,
        targetType: TEST_OFFER_AUDIT_TARGET_TYPE,
        isTest: legacyIsTest,
      }),
      markedSnapshot.test_offer_version_ids.includes(legacyId),
    );
    assert.equal(
      isTestOfferAuditMarker({
        action: TEST_OFFER_PUBLISH_ACTION,
        targetType: TEST_OFFER_AUDIT_TARGET_TYPE,
        isTest: stringIsTest,
      }),
      markedSnapshot.test_offer_version_ids.includes(stringId),
    );
    assert.deepEqual(markedSnapshot.test_offer_version_ids, [legacyId, newId].sort());
    assert.equal(markedSnapshot.test_offer_version_ids.includes(withdrawnId), false);
    assert.equal(markedSnapshot.test_offer_version_ids.includes(stringId), false);
    const preflight = readSupplyPreflight(sql, root);
    assert.equal(preflight.schema, 'wanderbite.e02.supply_preflight.v1');
    assert.equal(typeof preflight.exported_at, 'string');
    assert.equal(preflight.string_true_test_markers.count, 1);
    assert.deepEqual(preflight.string_true_test_markers.target_ids, [stringId]);
    assert.equal(preflight.test_versions, markedSnapshot.test_offer_version_ids.length);
    assert.equal(preflight.active_restaurants, activeRestaurantCount(sql, 'any'));
    assert.equal(preflight.active_with_current_version, activeRestaurantCount(sql, 'with'));
    assert.equal(preflight.active_without_current_version, activeRestaurantCount(sql, 'without'));
    assert.equal(
      preflight.active_with_current_version + preflight.active_without_current_version,
      preflight.active_restaurants,
    );
    assert.ok(preflight.active_with_current_version > 0);
    assert.ok(preflight.active_without_current_version > 0);
  }
  const withdraw = await buildCatalogPlan({
    document: { rows: [], errors: [] },
    snapshot: loadSnapshot(sql),
    options: {
      skipInvalid: false,
      refreshCoordinates: false,
      testOffers: false,
      testOffersAllInMarket: false,
      publishRealOffers: false,
      testOfferCapacity: 50,
      resolveDuplicates: [],
      withdrawTestOffers: true,
      markets: ['catalog-import-marks'],
      now: NOW,
      sourceLabel: 'db-test',
      outboundDisabled: true,
      apiKeyPresent: false,
    },
    geocoder: null,
  });
  assert.equal(withdraw.counts.withdraw, 2);
  const slugs = withdraw.actions
    .filter((action) => action.kind === 'withdraw_test_offer')
    .map((action) => action.restaurant_id)
    .sort();
  const expected = [
    sql(`select id from public.restaurants where slug = 'legacy-mark-grill';`),
    sql(`select id from public.restaurants where slug = 'new-mark-grill';`),
  ].sort();
  assert.deepEqual(slugs, expected);
  await applyCatalogPlan({
    plan: withdraw,
    confirm: ['catalog-import-marks'],
    actorId: ADMIN,
    applyEnv: '1',
    exec: real,
  });
  assert.equal(
    sql(`
      select count(*) from public.restaurants
      where slug in ('legacy-mark-grill', 'new-mark-grill')
        and current_offer_version_id is null;
    `),
    '2',
  );
  assert.equal(
    sql(`select current_offer_version_id is not null from public.restaurants where slug = 'string-mark-grill';`),
    't',
  );
  const duplicatesBefore = readSupplyPreflight(sql, root).catalog_import_duplicate_candidates;
  sql(`
    insert into public.restaurants (market_id, name, slug, address, status)
    values
      (
        ${q(market)}::uuid,
        'Preflight & Grill',
        'preflight-amp-grill',
        '1 Same Street, Marks, TX 75001',
        'active'
      ),
      (
        ${q(market)}::uuid,
        'Preflight and Grill',
        'preflight-and-grill',
        '1 Same Street, Marks, TX 75001',
        'active'
      );
  `);
  assert.equal(
    readSupplyPreflight(sql, root).catalog_import_duplicate_candidates,
    duplicatesBefore + 2,
  );
  sql(`
    insert into public.restaurant_orgs (id, name, market_id)
    values ('c4710900-0000-4000-8000-0000000000da'::uuid, 'Legacy Tags', ${q(market)}::uuid);
    insert into public.restaurants (
      id, org_id, market_id, name, slug, address, lat, lon, google_place_id, cuisine_tags, status
    ) values (
      'c4710900-0000-4000-8000-0000000000db'::uuid,
      'c4710900-0000-4000-8000-0000000000da'::uuid,
      ${q(market)}::uuid,
      'Legacy Tag Grill',
      'legacy-tag-grill',
      '9 Legacy Tag Street, Marks, TX 75001',
      33.22,
      -96.63,
      'place-legacy-tag',
      array['bar', 'Live-Music', 'meat', 'worth-trip', 'fine-dining', 'breakfast', 'patio', 'bbq']::text[],
      'active'
    );
  `);
  const legacySnapshot = loadSnapshot(sql);
  const exported = importRowsFromSnapshot(legacySnapshot, 'catalog-import-marks');
  const legacyRow = exported.rows.find((row) => row.slug === 'legacy-tag-grill');
  assert.ok(legacyRow);
  assert.equal(legacyRow.cuisine_tags, 'bar|Live-Music|meat|worth-trip|fine-dining|breakfast|patio|bbq');
  const legacyPlan = await planFile([legacyRow], sql, {
    testOffers: true,
    markets: ['catalog-import-marks'],
  });
  assert.equal(legacyPlan.accepted, true, legacyPlan.errors.map((error) => error.message).join('; '));
  assert.equal(legacyPlan.counts.errors, 0);
  assert.equal(legacyPlan.counts.update, 0);
  assert.equal(legacyPlan.counts.unchanged, 1);
  assert.equal(
    legacyPlan.actions.some((action) => action.kind === 'update_restaurant'),
    false,
  );
  const addedPlan = await planFile(
    [{ ...legacyRow, cuisine_tags: `${String(legacyRow.cuisine_tags)}|not-a-cuisine` }],
    sql,
  );
  assert.equal(addedPlan.accepted, false);
  assert.equal(
    addedPlan.errors.some((error) => error.message === 'cuisine tag not-a-cuisine is not in the cuisine list'),
    true,
  );
  const newPlan = await planFile(
    [
      {
        ...legacyRow,
        name: 'Brand New Grill',
        slug: 'brand-new-grill',
        address: '99 New Street, Marks, TX 75001',
        google_place_id: 'place-brand-new',
        cuisine_tags: 'not-a-cuisine',
      },
    ],
    sql,
  );
  assert.equal(newPlan.accepted, false);
  assert.equal(
    newPlan.errors.some((error) => error.message === 'cuisine tag not-a-cuisine is not in the cuisine list'),
    true,
  );
}
