-- E06 about paragraph.
-- NOT applied to hosted. Forward-only. Noah approves any apply.
-- Allows restaurant_briefing_facts.field = 'about'.
-- Adds optional internal sources jsonb. Client roles cannot select it.
-- Does not insert rows. Does not change existing RLS policies.
-- Does not write credits, offers, bookings, XP, or partner columns.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.restaurant_briefing_facts
  drop constraint restaurant_briefing_facts_field_check;

alter table public.restaurant_briefing_facts
  add constraint restaurant_briefing_facts_field_check
  check (
    field in (
      'parking',
      'arrival',
      'what_to_expect',
      'duration',
      'attire',
      'accessibility',
      'vibe',
      'known_for',
      'good_for',
      'seating',
      'reservations',
      'about'
    )
  );

create or replace function public.briefing_field_name(p_field text)
returns text
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
begin
  if p_field is null or p_field not in (
    'parking',
    'arrival',
    'what_to_expect',
    'duration',
    'attire',
    'accessibility',
    'vibe',
    'known_for',
    'good_for',
    'seating',
    'reservations',
    'about'
  ) then
    raise exception 'briefing field is not storable' using errcode = '22023';
  end if;
  return p_field;
end;
$$;

comment on function public.briefing_field_name(text) is
  'Returns a stored briefing field name. Accepts the twelve stored fields, including about. Refuses any other field. Does not write.';

revoke all on function public.briefing_field_name(text) from public, anon, authenticated, service_role;
grant execute on function public.briefing_field_name(text) to service_role;

alter table public.restaurant_briefing_facts
  add column sources jsonb;

comment on column public.restaurant_briefing_facts.sources is
  'Optional extra https sources for one fact. Used when an about paragraph has more than source_url. Internal only. Client roles cannot select this column.';

create or replace function public.briefing_fact_sources_ok(p_sources jsonb)
returns boolean
language sql
immutable
security invoker
set search_path to pg_catalog
as $$
  select p_sources is null
    or (
      jsonb_typeof(p_sources) = 'array'
      and jsonb_array_length(p_sources) between 1 and 8
      and not exists (
        select 1
        from jsonb_array_elements_text(p_sources) as extra(url)
        where char_length(url) < 12
          or char_length(url) > 500
          or url !~ '^https://[^[:space:]]+$'
      )
    );
$$;

comment on function public.briefing_fact_sources_ok(jsonb) is
  'True when sources is null or a list of one to eight https URLs. Does not write.';

revoke all on function public.briefing_fact_sources_ok(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.briefing_fact_sources_ok(jsonb) to service_role;

alter table public.restaurant_briefing_facts
  add constraint restaurant_briefing_facts_sources_check
  check (public.briefing_fact_sources_ok(sources));

-- Existing row policies stay. Client roles keep the columns they already read.
-- sources is omitted so a member select cannot return the extra URL list.
revoke select on table public.restaurant_briefing_facts from public, anon, authenticated;

grant select (
  id,
  restaurant_id,
  field,
  body,
  source_url,
  last_verified_at,
  status,
  is_sample,
  version,
  created_at,
  updated_at
) on table public.restaurant_briefing_facts to anon, authenticated;
