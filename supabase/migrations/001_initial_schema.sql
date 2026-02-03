-- WANDERBITE INITIAL SCHEMA
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Requires: uuid-ossp, postgis (Supabase has both; enable PostGIS in Database → Extensions if needed).

-- ENABLE EXTENSIONS
create extension if not exists "uuid-ossp";
create extension if not exists "postgis";

-- 1. MARKETS (Cities)
create table public.markets (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  timezone text default 'America/Chicago',
  status text check (status in ('active', 'paused')) default 'active'
);

-- 2. RESTAURANTS & ORGS
create table public.restaurant_orgs (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  market_id uuid references public.markets(id)
);

create table public.restaurants (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references public.restaurant_orgs(id),
  market_id uuid references public.markets(id),
  name text not null,
  cuisine_tags text[],
  address text,
  lat double precision,
  lon double precision,
  location geography(Point, 4326),
  status text check (status in ('active', 'paused')) default 'active',
  created_at timestamp with time zone default now()
);

-- Populate location from lat/lon so GIST index is useful for distance queries
create or replace function public.set_restaurant_location()
returns trigger as $$
begin
  if new.lat is not null and new.lon is not null then
    new.location := st_setsrid(st_makepoint(new.lon, new.lat), 4326)::geography;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger set_restaurant_location_trigger
  before insert or update of lat, lon on public.restaurants
  for each row execute function public.set_restaurant_location();

-- 3. OFFERS (The Deal)
create table public.restaurant_offers (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid references public.restaurants(id),
  discount_amount_cents int default 1000,
  min_spend_cents int default 4000,
  max_redemptions_per_month int default 50,
  active boolean default true,
  created_at timestamp with time zone default now()
);

-- 4. USERS & PREFERENCES
create table public.user_profiles (
  id uuid references auth.users(id) primary key,
  email text,
  role text check (role in ('subscriber', 'admin', 'partner')) default 'subscriber',
  dietary_flags text[],
  allergy_flags text[],
  cuisine_opt_out text[],
  distance_band text check (distance_band in ('close', 'worth_trip', 'adventure')) default 'worth_trip'
);

-- 5. CHALLENGES (The Monthly Cycle)
create table public.challenge_cycles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.user_profiles(id),
  cycle_month date,
  status text check (status in ('active', 'completed')) default 'active',
  swap_count_used int default 0,
  created_at timestamp with time zone default now()
);

create table public.challenge_items (
  id uuid primary key default uuid_generate_v4(),
  cycle_id uuid references public.challenge_cycles(id),
  restaurant_id uuid references public.restaurants(id),
  slot_number int check (slot_number in (1, 2)),
  status text check (status in ('assigned', 'swapped_out', 'redeemed')) default 'assigned',
  swapped_from_item_id uuid references public.challenge_items(id)
);

-- 6. REDEMPTIONS (The Verification)
create table public.redemptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.user_profiles(id),
  restaurant_id uuid references public.restaurants(id),
  challenge_item_id uuid references public.challenge_items(id),
  token_hash text,
  status text check (status in ('issued', 'verified', 'expired')) default 'issued',
  verified_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

-- INDEXES
create index idx_restaurants_location on public.restaurants using GIST(location);
create unique index idx_challenge_cycles_user_month on public.challenge_cycles(user_id, cycle_month);

-- ROW LEVEL SECURITY
alter table public.user_profiles enable row level security;
create policy "Users can view own profile" on public.user_profiles for select using (auth.uid() = id);
create policy "Users can insert own profile" on public.user_profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile" on public.user_profiles for update using (auth.uid() = id);

alter table public.challenge_cycles enable row level security;
create policy "Users view own cycles" on public.challenge_cycles for select using (auth.uid() = user_id);

alter table public.challenge_items enable row level security;
create policy "Users view own items" on public.challenge_items for select using (
  exists ( select 1 from public.challenge_cycles where id = challenge_items.cycle_id and user_id = auth.uid() )
);

alter table public.redemptions enable row level security;
create policy "Users view own redemptions" on public.redemptions for select using (auth.uid() = user_id);
