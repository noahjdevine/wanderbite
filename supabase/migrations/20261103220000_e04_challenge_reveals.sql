-- E04-B persistent monthly reveal. Not applied to hosted until separately approved.
-- The old generator does not write this table. A later reveal attaches one
-- legacy_generate row to a cycle that already exists. generate_challenge_cycle
-- is unchanged and is called inside this function's transaction.

create table public.challenge_reveals (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  period_key date not null,
  cycle_id uuid not null references public.challenge_cycles (id) on delete cascade,
  brief jsonb not null,
  selection_source text not null,
  item_reasons jsonb not null,
  eligibility_facts jsonb not null,
  source_version text not null,
  created_at timestamptz not null default now(),
  constraint challenge_reveals_user_period_key unique (user_id, period_key),
  constraint challenge_reveals_source_check check (
    selection_source in ('deterministic_fallback', 'ai_ranked', 'legacy_generate')
  ),
  constraint challenge_reveals_brief_check check (
    jsonb_typeof(brief) = 'object'
    and jsonb_typeof(brief -> 'surprise_me') = 'boolean'
    and char_length(coalesce(brief ->> 'summary', '')) <= 280
    and char_length(coalesce(brief ->> 'occasion', '')) <= 80
    and char_length(coalesce(brief ->> 'discovery_level', '')) <= 80
  )
);

create index challenge_reveals_cycle_id_idx on public.challenge_reveals (cycle_id);

alter table public.challenge_reveals enable row level security;

revoke all on table public.challenge_reveals from public, anon, authenticated, service_role;
grant select on table public.challenge_reveals to authenticated;
grant select on table public.challenge_reveals to service_role;

create policy challenge_reveals_select_own
  on public.challenge_reveals
  for select
  to authenticated
  using (user_id = (select auth.uid()));

comment on table public.challenge_reveals is
  'One saved monthly reveal per member period. Client roles cannot insert, update, or delete.';

create or replace function public.reveal_monthly_challenge(
  p_user_id uuid,
  p_cycle_month date,
  p_market_id uuid,
  p_restaurant_ids uuid[],
  p_brief jsonb,
  p_selection_source text,
  p_item_reasons jsonb,
  p_eligibility_facts jsonb,
  p_source_version text
)
returns table (outcome text, cycle_id uuid, reveal_id uuid, restaurant_ids uuid[])
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  profile_status text;
  existing_reveal public.challenge_reveals%rowtype;
  existing_cycle_id uuid;
  generated_outcome text;
  generated_cycle uuid;
  saved_ids uuid[];
  stored_brief jsonb;
  stored_source text;
  new_reveal_id uuid;
begin
  if p_user_id is null or p_cycle_month is null or p_market_id is null then
    return query select 'invalid_restaurants'::text, null::uuid, null::uuid, null::uuid[];
    return;
  end if;

  select up.subscription_status into profile_status
  from public.user_profiles up
  where up.id = p_user_id
  for update;
  if not found or profile_status is distinct from 'active' then
    return query select 'inactive_subscription'::text, null::uuid, null::uuid, null::uuid[];
    return;
  end if;

  stored_brief := jsonb_build_object(
    'occasion', left(coalesce(p_brief ->> 'occasion', ''), 80),
    'discovery_level', left(coalesce(p_brief ->> 'discovery_level', ''), 80),
    'summary', left(coalesce(p_brief ->> 'summary', ''), 280),
    'surprise_me', case
      when jsonb_typeof(p_brief -> 'surprise_me') = 'boolean' then (p_brief ->> 'surprise_me')::boolean
      else false
    end
  );

  select cr.* into existing_reveal
  from public.challenge_reveals cr
  where cr.user_id = p_user_id and cr.period_key = p_cycle_month
  for update;
  if found then
    select array_agg(ci.restaurant_id order by ci.slot_number) into saved_ids
    from public.challenge_items ci
    where ci.cycle_id = existing_reveal.cycle_id
      and ci.status in ('assigned', 'redeemed', 'expired');
    return query select 'existing'::text, existing_reveal.cycle_id, existing_reveal.id, saved_ids;
    return;
  end if;

  select cc.id into existing_cycle_id
  from public.challenge_cycles cc
  where cc.user_id = p_user_id and cc.cycle_month = p_cycle_month
  for update;

  if existing_cycle_id is null then
    select g.outcome, g.cycle_id into generated_outcome, generated_cycle
    from public.generate_challenge_cycle(
      p_user_id, p_cycle_month, p_market_id, p_restaurant_ids
    ) as g;
    if generated_outcome is distinct from 'created' and generated_outcome is distinct from 'existing' then
      return query select generated_outcome, generated_cycle, null::uuid, null::uuid[];
      return;
    end if;
    existing_cycle_id := generated_cycle;
    stored_source := case
      when p_selection_source = 'ai_ranked' then 'ai_ranked'
      else 'deterministic_fallback'
    end;
  else
    stored_source := 'legacy_generate';
  end if;

  select array_agg(ci.restaurant_id order by ci.slot_number) into saved_ids
  from public.challenge_items ci
  where ci.cycle_id = existing_cycle_id
    and ci.status in ('assigned', 'redeemed', 'expired');

  begin
    insert into public.challenge_reveals (
      user_id, period_key, cycle_id, brief, selection_source,
      item_reasons, eligibility_facts, source_version
    ) values (
      p_user_id,
      p_cycle_month,
      existing_cycle_id,
      stored_brief,
      stored_source,
      coalesce(p_item_reasons, '[]'::jsonb),
      coalesce(p_eligibility_facts, '{}'::jsonb),
      coalesce(nullif(p_source_version, ''), 'e04b.deterministic.v1')
    )
    returning id into new_reveal_id;
  exception
    when unique_violation then
      select cr.id into new_reveal_id
      from public.challenge_reveals cr
      where cr.user_id = p_user_id and cr.period_key = p_cycle_month;
  end;

  return query select
    case when stored_source = 'legacy_generate' then 'existing' else coalesce(generated_outcome, 'existing') end,
    existing_cycle_id,
    new_reveal_id,
    saved_ids;
end;
$$;

revoke all on function public.reveal_monthly_challenge(uuid, date, uuid, uuid[], jsonb, text, jsonb, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reveal_monthly_challenge(uuid, date, uuid, uuid[], jsonb, text, jsonb, jsonb, text)
  to service_role;

comment on function public.reveal_monthly_challenge(uuid, date, uuid, uuid[], jsonb, text, jsonb, jsonb, text) is
  'Commits one cycle and one reveal for a member period. Retries and an existing generator cycle return the saved pair.';
