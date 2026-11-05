-- E06-A2 first-visit briefing facts.
-- NOT applied to hosted. Forward-only. Adds one table. Noah approves any apply.
-- Members can read active rows only. Writes are service_role only.
-- No credits, offers, bookings, XP, or partner columns.
-- Sample rows are not inserted here. Local seed is scripts/fixtures/e06-sample-briefings.ts.
-- This migration does not change content_sources.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.restaurant_briefing_facts (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  field text not null,
  body text not null,
  source_url text not null,
  last_verified_at timestamptz not null,
  status text not null default 'paused',
  is_sample boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_briefing_facts_field_check check (
    field in (
      'parking',
      'arrival',
      'what_to_expect',
      'duration',
      'attire',
      'accessibility'
    )
  ),
  constraint restaurant_briefing_facts_body_check check (
    char_length(body) between 1 and 400
    and char_length(btrim(body)) between 1 and 400
  ),
  constraint restaurant_briefing_facts_source_url_check check (
    char_length(source_url) between 12 and 500
    and source_url ~ '^https://[^[:space:]]+$'
  ),
  constraint restaurant_briefing_facts_status_check check (
    status in ('active', 'paused')
  ),
  constraint restaurant_briefing_facts_version_check check (version >= 1),
  constraint restaurant_briefing_facts_restaurant_field_key unique (restaurant_id, field)
);

comment on table public.restaurant_briefing_facts is
  'Sourced first-visit facts for one restaurant. Not a credit, offer, booking, or visit. Client roles read active rows. service_role writes. Default status is paused.';

comment on column public.restaurant_briefing_facts.body is
  'The fact shown to the member. Missing facts are omitted by storing no row.';

comment on column public.restaurant_briefing_facts.source_url is
  'https page the fact was taken from. The UI links this URL.';

comment on column public.restaurant_briefing_facts.last_verified_at is
  'When the fact was last checked. The UI shows this instant as an America/Chicago date.';

comment on column public.restaurant_briefing_facts.is_sample is
  'True for local sample rows. The UI shows a Sample label. Not a real-venue claim.';

comment on column public.restaurant_briefing_facts.status is
  'active is visible to members. paused is hidden. Research writes stay paused until an operator flips them.';

create or replace function public.set_restaurant_briefing_facts_updated_at()
returns trigger
language plpgsql
set search_path to pg_catalog
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_restaurant_briefing_facts_updated_at() from public, anon, authenticated, service_role;
grant execute on function public.set_restaurant_briefing_facts_updated_at() to service_role;

create trigger set_restaurant_briefing_facts_updated_at_trigger
  before update on public.restaurant_briefing_facts
  for each row execute function public.set_restaurant_briefing_facts_updated_at();

alter table public.restaurant_briefing_facts enable row level security;

revoke all on table public.restaurant_briefing_facts from public, anon, authenticated, service_role;
grant select on table public.restaurant_briefing_facts to anon, authenticated;
grant select, insert, update, delete on table public.restaurant_briefing_facts to service_role;

create policy restaurant_briefing_facts_select_active
  on public.restaurant_briefing_facts
  for select
  to anon, authenticated
  using (status = 'active');

create policy restaurant_briefing_facts_service_all
  on public.restaurant_briefing_facts
  for all
  to service_role
  using (true)
  with check (true);
