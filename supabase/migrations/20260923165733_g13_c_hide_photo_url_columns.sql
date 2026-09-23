-- G13-C: stop Data API reads of google_photo_url and image_url.
-- Stored values stay for a later approved cleanup. Service role can still read them.
-- Do not edit the G8 migration. Do not change the restaurants SELECT policy.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

revoke select on table public.restaurants from public, anon, authenticated;

grant select (
  id,
  name,
  slug,
  status,
  cuisine_tags,
  neighborhood,
  address,
  description,
  price_range,
  google_place_id,
  is_dairy_free,
  is_vegan,
  is_halal
) on table public.restaurants to anon, authenticated;

create or replace view public.restaurants_public
with (security_invoker = true) as
select
  id,
  name,
  slug,
  status,
  cuisine_tags,
  neighborhood,
  address,
  description,
  price_range,
  null::text as image_url,
  null::text as google_photo_url,
  google_place_id,
  is_dairy_free,
  is_vegan,
  is_halal
from public.restaurants
where status = 'active';
