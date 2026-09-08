-- SEC-06 / G8 / M5: hide partner secrets and cron logs from the Data API.
-- Public restaurant catalog is a frozen 15-column allowlist plus an invoker view.
-- markets / restaurant_orgs / restaurant_offers are service-role only (no client policies).
-- Do not rewrite historical migrations. Do not change ALTER DEFAULT PRIVILEGES.
-- Let the migration runner own the transaction so the schema change and its
-- migration-history entry commit together. Direct psql replay must use -1 -f.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- restaurants: RLS + column SELECT + invoker view
-- ---------------------------------------------------------------------------
alter table public.restaurants enable row level security;

drop policy if exists "Public can read active restaurants" on public.restaurants;
create policy "Public can read active restaurants"
  on public.restaurants
  for select
  to anon, authenticated
  using (status = 'active');

revoke all on table public.restaurants
  from public, anon, authenticated, service_role;

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
  image_url,
  google_photo_url,
  google_place_id,
  is_dairy_free,
  is_vegan,
  is_halal
) on table public.restaurants to anon, authenticated;

grant select, insert, update, delete on table public.restaurants to service_role;

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
  image_url,
  google_photo_url,
  google_place_id,
  is_dairy_free,
  is_vegan,
  is_halal
from public.restaurants
where status = 'active';

revoke all on table public.restaurants_public
  from public, anon, authenticated, service_role;

grant select on table public.restaurants_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- cron_runs: keep RLS, no policies, revoke client grants, explicit service_role
-- ---------------------------------------------------------------------------
revoke all on table public.cron_runs
  from public, anon, authenticated, service_role;
revoke all on sequence public.cron_runs_id_seq
  from public, anon, authenticated, service_role;

grant select, insert, update on table public.cron_runs to service_role;
grant usage, select, update on sequence public.cron_runs_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- markets / restaurant_orgs / restaurant_offers: service-role only
-- ---------------------------------------------------------------------------
alter table public.markets enable row level security;
alter table public.restaurant_orgs enable row level security;
alter table public.restaurant_offers enable row level security;

revoke all on table public.markets
  from public, anon, authenticated, service_role;
revoke all on table public.restaurant_orgs
  from public, anon, authenticated, service_role;
revoke all on table public.restaurant_offers
  from public, anon, authenticated, service_role;

grant select, insert on table public.markets to service_role;
grant select, insert, delete on table public.restaurant_orgs to service_role;
grant select, insert, delete on table public.restaurant_offers to service_role;
