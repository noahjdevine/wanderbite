-- E06 restaurant fact fields.
-- NOT applied to hosted. Forward-only. Noah approves any apply.
-- Widens restaurant_briefing_facts.field and briefing_field_name() to eleven fields.
-- Does not change RLS, grants on the table, or existing rows.
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
      'reservations'
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
    'reservations'
  ) then
    raise exception 'briefing field is not storable' using errcode = '22023';
  end if;
  return p_field;
end;
$$;

comment on function public.briefing_field_name(text) is
  'Returns a first-visit field name. Accepts the eleven stored fields. Refuses any other field. Does not write.';

revoke all on function public.briefing_field_name(text) from public, anon, authenticated, service_role;
grant execute on function public.briefing_field_name(text) to service_role;
