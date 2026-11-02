-- Run by Noah only (Supabase SQL editor or another read-only session). Never by an agent or CI.
-- Supabase SQL editor: highlight only the select statement and use "Run selected"
-- (the editor shows only the last statement's result). Copy only the single cell value,
-- not "Export as JSON", which wraps it in [{"preflight":...}].
-- Read-only. One JSON object. Does not return pins, verification codes, addresses, photos, or member rows.
-- If string_true_test_markers.count is greater than 0, stop. Report the cell. Do not edit hosted rows.
--
-- test_versions uses the same predicate as test_offer_version_ids in
-- scripts/sql/e02-supply-snapshot.sql: current offer version of an active restaurant,
-- not withdrawn, with an offer.test_mark or offer.publish row whose metadata is_test
-- is JSON boolean true ((metadata->'is_test') = 'true'::jsonb).
--
-- catalog_import_duplicate_candidates counts distinct active restaurants that have a
-- slug and that possibleDuplicates in src/lib/catalog/import.ts would pair inside one
-- market: shared google_place_id, the same normalized name and address
-- (lower case, "&" to " and ", non-alphanumerics to spaces), or a slug and that slug
-- with "-2" appended. public.restaurants has no zip column, so this is not a name+zip count.

begin transaction read only;

select jsonb_build_object(
  'schema', 'wanderbite.e02.supply_preflight.v1',
  'exported_at', now(),
  'string_true_test_markers', (
    select jsonb_build_object(
      'count', (
        select count(*)::int
        from public.admin_audit_log audit_log
        where audit_log.metadata->>'is_test' = 'true'
          and (audit_log.metadata->'is_test') <> 'true'::jsonb
      ),
      'target_ids', coalesce((
        select jsonb_agg(marked.target_id order by marked.target_id)
        from (
          select distinct audit_log.target_id
          from public.admin_audit_log audit_log
          where audit_log.metadata->>'is_test' = 'true'
            and (audit_log.metadata->'is_test') <> 'true'::jsonb
            and audit_log.target_id is not null
        ) marked
      ), '[]'::jsonb)
    )
  ),
  'test_versions', (
    select count(*)::int
    from (
      select distinct offer_versions.id
      from public.offer_versions
      join public.restaurants
        on restaurants.current_offer_version_id = offer_versions.id
       and restaurants.id = offer_versions.restaurant_id
      where restaurants.status = 'active'
        and offer_versions.withdrawn_from_selection_at is null
        and exists (
          select 1
          from public.admin_audit_log audit_log
          where audit_log.target_type = 'offer_version'
            and audit_log.target_id = offer_versions.id::text
            and (audit_log.metadata->'is_test') = 'true'::jsonb
            and audit_log.action in ('offer.test_mark', 'offer.publish')
        )
    ) marked
  ),
  'active_restaurants', (
    select count(*)::int
    from public.restaurants
    where restaurants.status = 'active'
  ),
  'active_with_current_version', (
    select count(*)::int
    from public.restaurants
    where restaurants.status = 'active'
      and restaurants.current_offer_version_id is not null
  ),
  'active_without_current_version', (
    select count(*)::int
    from public.restaurants
    where restaurants.status = 'active'
      and restaurants.current_offer_version_id is null
  ),
  'catalog_import_duplicate_candidates', (
    with active as (
      select
        restaurants.id,
        restaurants.market_id,
        restaurants.slug,
        restaurants.google_place_id,
        trim(both from regexp_replace(
          regexp_replace(replace(lower(restaurants.name), '&', ' and '), '[^a-z0-9]+', ' ', 'g'),
          '\s+',
          ' ',
          'g'
        )) || '|' || trim(both from regexp_replace(
          regexp_replace(replace(lower(coalesce(restaurants.address, '')), '&', ' and '), '[^a-z0-9]+', ' ', 'g'),
          '\s+',
          ' ',
          'g'
        )) as name_address
      from public.restaurants
      where restaurants.status = 'active'
        and restaurants.slug is not null
        and restaurants.market_id is not null
    )
    select count(*)::int
    from (
      select distinct hit.id
      from (
        select left_row.id
        from active left_row
        join active right_row
          on right_row.market_id = left_row.market_id
         and right_row.id <> left_row.id
         and left_row.google_place_id is not null
         and left_row.google_place_id <> ''
         and left_row.google_place_id = right_row.google_place_id
        union
        select left_row.id
        from active left_row
        join active right_row
          on right_row.market_id = left_row.market_id
         and right_row.id <> left_row.id
         and left_row.name_address = right_row.name_address
        union
        select left_row.id
        from active left_row
        join active right_row
          on right_row.market_id = left_row.market_id
         and right_row.slug = left_row.slug || '-2'
        union
        select right_row.id
        from active left_row
        join active right_row
          on right_row.market_id = left_row.market_id
         and right_row.slug = left_row.slug || '-2'
      ) hit
    ) candidates
  )
) as preflight;

rollback;
