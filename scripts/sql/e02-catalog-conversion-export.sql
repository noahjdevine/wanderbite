-- Noah-run read-only conversion export. Never run against hosted Supabase from an agent or CI.
-- In the Supabase SQL editor, run only the SELECT and copy its single JSON cell to:
-- .supply-gate/catalog-conversion-input.json
-- The output is gitignored and contains addresses/place IDs. Never paste it into logs or a PR.
-- It excludes members, credentials, pins, verification material, and photo fields.

begin transaction read only;

select json_build_object(
  'schema', 'wanderbite.e02.catalog_conversion.v1',
  'exported_at', transaction_timestamp(),
  'evaluation_at', transaction_timestamp(),
  'evaluation_at_provenance', 'conversion_export.transaction_timestamp',
  'launch_market', (
    select json_build_object(
      'id', m.id,
      'slug', m.slug,
      'status', m.status,
      'timezone', m.timezone
    )
    from public.markets m
    where m.slug = 'mckinney-tx'
  ),
  'restaurants', (
    select coalesce(json_agg(json_build_object(
      'id', r.id,
      'slug', r.slug,
      'name', r.name,
      'status', r.status,
      'market_id', r.market_id,
      'address', r.address,
      'lat', r.lat,
      'lon', r.lon,
      'google_place_id', r.google_place_id,
      'current_offer_version_id', r.current_offer_version_id
    ) order by r.id), '[]'::json)
    from public.restaurants r
    where r.market_id = (
      select m.id from public.markets m where m.slug = 'mckinney-tx'
    )
  ),
  'legacy_offers', (
    select coalesce(json_agg(json_build_object(
      'id', o.id,
      'restaurant_id', o.restaurant_id,
      'discount_amount_cents', o.discount_amount_cents,
      'min_spend_cents', o.min_spend_cents,
      'max_redemptions_per_month', o.max_redemptions_per_month,
      'active', o.active,
      'created_at', o.created_at
    ) order by o.restaurant_id, o.id), '[]'::json)
    from public.restaurant_offers o
    join public.restaurants r on r.id = o.restaurant_id
    where r.market_id = (
      select m.id from public.markets m where m.slug = 'mckinney-tx'
    )
  ),
  'offer_versions', (
    select coalesce(json_agg(json_build_object(
      'id', v.id,
      'restaurant_id', v.restaurant_id,
      'timezone', v.timezone,
      'valid_from', v.valid_from,
      'valid_until', v.valid_until,
      'tiers', v.tiers,
      'boosts', v.boosts,
      'exclusions', v.exclusions,
      'capacity_timezone', v.capacity_timezone,
      'capacity_window_kind', v.capacity_window_kind,
      'capacity_max_redemptions', v.capacity_max_redemptions,
      'boost_session_minutes', v.boost_session_minutes,
      'withdrawn_from_selection_at', v.withdrawn_from_selection_at,
      'published_at', v.published_at,
      'published_by', v.published_by
    ) order by v.id), '[]'::json)
    from public.offer_versions v
    join public.restaurants r
      on r.id = v.restaurant_id
     and r.current_offer_version_id = v.id
    where r.market_id = (
      select m.id from public.markets m where m.slug = 'mckinney-tx'
    )
  ),
  'decisions', '[]'::json,
  'coordinate_decisions', '[]'::json
) as conversion_input;

rollback;
