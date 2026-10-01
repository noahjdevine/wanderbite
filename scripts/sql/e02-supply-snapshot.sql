-- Run by Noah only (Supabase SQL editor or another read-only session). Never by an agent or CI. Save the single JSON cell to .supply-gate/hosted-catalog.json.
-- Read-only. One JSON object. Does not select pins, verification codes, addresses, photos, or member rows.

begin transaction read only;

select json_build_object(
  'schema', 'wanderbite.e02.supply_snapshot.v1',
  'exported_at', now(),
  'launch_market', (
    select json_build_object(
      'id', markets.id,
      'slug', markets.slug,
      'status', markets.status
    )
    from public.markets
    where markets.slug = 'mckinney-tx'
  ),
  'restaurants', (
    select coalesce(json_agg(json_build_object(
      'id', restaurants.id,
      'slug', restaurants.slug,
      'name', restaurants.name,
      'status', restaurants.status,
      'market_id', restaurants.market_id,
      'cuisine_tags', restaurants.cuisine_tags,
      'lat', restaurants.lat,
      'lon', restaurants.lon,
      'current_offer_version_id', restaurants.current_offer_version_id
    ) order by restaurants.id), '[]'::json)
    from public.restaurants
    where restaurants.status = 'active'
  ),
  'offer_versions', (
    select coalesce(json_agg(json_build_object(
      'id', offer_versions.id,
      'restaurant_id', offer_versions.restaurant_id,
      'tiers', offer_versions.tiers,
      'valid_from', offer_versions.valid_from,
      'valid_until', offer_versions.valid_until,
      'withdrawn_from_selection_at', offer_versions.withdrawn_from_selection_at,
      'capacity_max_redemptions', offer_versions.capacity_max_redemptions,
      'capacity_timezone', offer_versions.capacity_timezone,
      'capacity_window_kind', offer_versions.capacity_window_kind
    ) order by offer_versions.id), '[]'::json)
    from public.offer_versions
    join public.restaurants
      on restaurants.current_offer_version_id = offer_versions.id
     and restaurants.id = offer_versions.restaurant_id
    where restaurants.status = 'active'
  ),
  'legacy_offers', (
    select coalesce(json_agg(json_build_object(
      'restaurant_id', restaurant_offers.restaurant_id,
      'discount_amount_cents', restaurant_offers.discount_amount_cents,
      'min_spend_cents', restaurant_offers.min_spend_cents,
      'max_redemptions_per_month', restaurant_offers.max_redemptions_per_month,
      'active', restaurant_offers.active
    ) order by restaurant_offers.restaurant_id), '[]'::json)
    from public.restaurant_offers
    join public.restaurants on restaurants.id = restaurant_offers.restaurant_id
    where restaurants.status = 'active'
      and restaurant_offers.active is true
  )
) as snapshot;

rollback;
