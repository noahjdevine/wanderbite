-- E06-A1 optional nearby activities.
-- NOT applied to hosted. Forward-only. Adds one table. Noah approves any apply.
-- Members can read active rows that are not past valid_until in America/Chicago.
-- Writes are service_role only. No credits, offers, bookings, or partner columns.
-- Sample rows are not inserted here. Local seed is scripts/fixtures/e06-sample-activities.ts.
-- Later E06-B can register an activity source_url on content_sources
-- (kind venue_page or event_page). This migration does not change that table.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.activities (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category text not null,
  source_url text,
  lat double precision,
  lon double precision,
  zip text,
  typical_duration_minutes integer,
  cost_category text not null,
  hours_note text,
  valid_from date,
  valid_until date,
  weather_dependent boolean not null default false,
  booking_required boolean not null default false,
  last_verified_at timestamptz,
  status text not null default 'active',
  is_sample boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint activities_category_check check (
    category in ('museum', 'walk', 'class', 'sports', 'arts')
  ),
  constraint activities_source_url_check check (
    source_url is null
    or (
      char_length(source_url) between 12 and 500
      and source_url ~ '^https://[^[:space:]]+$'
    )
  ),
  constraint activities_coordinates_check check (
    (lat is null and lon is null)
    or (
      lat is not null
      and lon is not null
      and lat between -90 and 90
      and lon between -180 and 180
    )
  ),
  constraint activities_location_check check (
    (lat is not null and lon is not null)
    or zip is not null
  ),
  constraint activities_zip_check check (zip is null or zip ~ '^[0-9]{5}$'),
  constraint activities_duration_check check (
    typical_duration_minutes is null
    or typical_duration_minutes between 1 and 1440
  ),
  constraint activities_cost_category_check check (
    cost_category in ('free', '$', '$$', '$$$', 'unknown')
  ),
  constraint activities_hours_note_check check (
    hours_note is null or char_length(btrim(hours_note)) between 1 and 240
  ),
  constraint activities_validity_check check (
    valid_from is null or valid_until is null or valid_from <= valid_until
  ),
  constraint activities_status_check check (
    status in ('active', 'paused', 'expired')
  ),
  constraint activities_version_check check (version >= 1)
);

create index activities_status_idx on public.activities (status);

comment on table public.activities is
  'Optional nearby ideas for a restaurant challenge. Not a partner, benefit, booking, or credit. Client roles read active rows whose valid_until is null or still today in America/Chicago. service_role writes.';

comment on column public.activities.lat is
  'WGS84 latitude, same column name as restaurants.lat. Pair with lon. Not a driving-time estimate.';

comment on column public.activities.lon is
  'WGS84 longitude, same column name as restaurants.lon.';

comment on column public.activities.zip is
  'Five-digit ZIP used only when coordinates are missing. Restaurants store ZIP inside address, not a zip column.';

comment on column public.activities.hours_note is
  'Optional note. Null means the member should check hours on the official site. Not an exact schedule.';

comment on column public.activities.is_sample is
  'True for local sample rows. The UI shows a Sample label. Not a real-venue claim.';

create or replace function public.set_activities_updated_at()
returns trigger
language plpgsql
set search_path to pg_catalog
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_activities_updated_at() from public, anon, authenticated, service_role;
grant execute on function public.set_activities_updated_at() to service_role;

create trigger set_activities_updated_at_trigger
  before update on public.activities
  for each row execute function public.set_activities_updated_at();

alter table public.activities enable row level security;

revoke all on table public.activities from public, anon, authenticated, service_role;
grant select on table public.activities to anon, authenticated;
grant select, insert, update, delete on table public.activities to service_role;

create policy activities_select_current
  on public.activities
  for select
  to anon, authenticated
  using (
    status = 'active'
    and (
      valid_until is null
      or valid_until >= (timezone('America/Chicago', now()))::date
    )
  );

create policy activities_service_all
  on public.activities
  for all
  to service_role
  using (true)
  with check (true);
