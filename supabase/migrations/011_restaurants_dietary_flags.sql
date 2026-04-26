-- Roulette / discovery: explicit dietary flags (admin-editable).
-- Backfill: UPDATE restaurants SET is_vegan = true WHERE 'vegan' = ANY(cuisine_tags); etc.
-- Until flags or matching cuisine_tags exist, quick filters may return no matches.

alter table public.restaurants
  add column if not exists is_dairy_free boolean not null default false,
  add column if not exists is_vegan boolean not null default false,
  add column if not exists is_halal boolean not null default false;

comment on column public.restaurants.is_dairy_free is 'Accommodates dairy-free dining (Wanderbite Roulette filter).';
comment on column public.restaurants.is_vegan is 'Vegan-friendly / plant-based options (Wanderbite Roulette filter).';
comment on column public.restaurants.is_halal is 'Halal options available (Wanderbite Roulette filter).';

-- Optional backfill examples (run manually after reviewing data):
-- update public.restaurants set is_vegan = true where exists (
--   select 1 from unnest(cuisine_tags) t where lower(t::text) like '%vegan%');
-- update public.restaurants set is_halal = true where exists (
--   select 1 from unnest(cuisine_tags) t where lower(t::text) like '%halal%');
-- update public.restaurants set is_dairy_free = true where exists (
--   select 1 from unnest(cuisine_tags) t where lower(t::text) like '%dairy-free%' or lower(t::text) like '%dairy free%');
