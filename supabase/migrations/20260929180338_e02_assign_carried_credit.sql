-- E02 carried assignment: place one restaurant on one carried credit.
-- Does not roll credits, swap, expire a due credit, or set workflow_version.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.assign_carried_credit(
  p_user_id uuid,
  p_credit_id uuid,
  p_market_id uuid,
  p_restaurant_id uuid
)
returns table (outcome text, cycle_id uuid)
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  profile public.user_profiles%rowtype;
  credit public.entitlement_credits%rowtype;
  item public.challenge_items%rowtype;
  origin_cycle public.challenge_cycles%rowtype;
  item_cycle public.challenge_cycles%rowtype;
  v_now timestamptz;
  v_t2 timestamptz;
  v_deadline timestamptz;
  rest_status text;
  rest_market uuid;
  version_id uuid;
  v_valid_from timestamptz;
  v_valid_until timestamptz;
  v_withdrawn timestamptz;
  one_base integer;
  inserted_cycle_id uuid;
  new_item_id uuid;
  n integer;
begin
  v_now := now();

  select up.* into profile
  from public.user_profiles up
  where up.id = p_user_id
  for update;
  if not found or profile.workflow_version is distinct from 'credits' then
    return query select 'legacy_workflow'::text, null::uuid;
    return;
  end if;
  if profile.subscription_status is distinct from 'active' then
    return query select 'inactive_subscription'::text, null::uuid;
    return;
  end if;

  select * into credit
  from public.entitlement_credits
  where id = p_credit_id
    and user_id = p_user_id
  for update;
  if not found then
    return query select 'not_carried'::text, null::uuid;
    return;
  end if;

  v_t2 := (credit.issue_period + interval '2 months')::timestamp at time zone 'America/Chicago';

  origin_cycle := null;
  select * into origin_cycle
  from public.challenge_cycles cc
  where cc.user_id = p_user_id
    and cc.cycle_month = credit.issue_period
  for update;
  if not found then
    origin_cycle := null;
  end if;

  if credit.status = 'linked' then
    item := null;
    select * into item
    from public.challenge_items
    where id = credit.challenge_item_id;
    if not found then
      return query select 'not_carried'::text, null::uuid;
      return;
    end if;
    item_cycle := null;
    select * into item_cycle
    from public.challenge_cycles
    where id = item.cycle_id;
    if not found then
      return query select 'not_carried'::text, null::uuid;
      return;
    end if;
    if item.slot_number is distinct from credit.slot_number::integer
       or item_cycle.user_id is distinct from p_user_id
       or item_cycle.cycle_month is distinct from credit.issue_period
       or item.credit_id is distinct from credit.id
       or credit.challenge_item_id is distinct from item.id
    then
      return query select 'not_carried'::text, null::uuid;
      return;
    end if;
    return query select 'existing'::text, item_cycle.id;
    return;
  end if;

  if not (
    credit.issue_period < public.chicago_month_start(v_now)
    and credit.status = 'pending'
    and credit.challenge_item_id is null
    and credit.expires_at is not distinct from v_t2
    and v_now < v_t2
  ) then
    if credit.status = 'pending'
       and credit.challenge_item_id is null
       and credit.expires_at is not distinct from v_t2
       and v_now >= v_t2
    then
      return query select 'carried_due'::text, null::uuid;
      return;
    end if;
    return query select 'not_carried'::text, null::uuid;
    return;
  end if;

  if p_restaurant_id is not null then
    perform 1
    from public.restaurants
    where id = p_restaurant_id
    for update;
  end if;

  v_deadline := least(v_now + interval '840 hours', credit.expires_at);

  select r.status, r.market_id, r.current_offer_version_id,
         v.valid_from, v.valid_until, v.withdrawn_from_selection_at,
         public.offer_lowest_tier_cents(v.tiers)
    into rest_status, rest_market, version_id,
         v_valid_from, v_valid_until, v_withdrawn, one_base
  from public.restaurants r
  left join public.offer_versions v
    on v.id = r.current_offer_version_id
   and v.restaurant_id = r.id
  where r.id = p_restaurant_id;
  if not found
     or rest_status is distinct from 'active'
     or rest_market is distinct from p_market_id
     or version_id is null
     or v_withdrawn is not null
     or v_valid_from is null
     or v_valid_from > v_now
     or v_valid_until is null
     or not (v_now < v_valid_until)
     or not (v_valid_until > v_deadline)
  then
    return query select 'invalid_restaurant'::text, null::uuid;
    return;
  end if;

  if one_base is null or one_base < 2000 then
    return query select 'below_floor'::text, null::uuid;
    return;
  end if;

  if origin_cycle.id is not null and exists (
    select 1
    from public.challenge_items ci
    where ci.cycle_id = origin_cycle.id
      and ci.restaurant_id = p_restaurant_id
      and ci.status in ('assigned', 'redeemed', 'expired')
  ) then
    return query select 'duplicate_restaurant'::text, null::uuid;
    return;
  end if;

  if origin_cycle.id is not null and exists (
    select 1
    from public.challenge_items ci
    left join public.entitlement_credits ec on ec.id = ci.credit_id
    where ci.cycle_id = origin_cycle.id
      and ci.status in ('assigned', 'redeemed', 'expired')
      and (
        ci.credit_id is null
        or ec.user_id is distinct from p_user_id
        or ec.issue_period is distinct from credit.issue_period
      )
  ) then
    return query select 'legacy_cycle_present'::text, null::uuid;
    return;
  end if;

  if origin_cycle.id is not null and exists (
    select 1
    from public.challenge_items ci
    where ci.cycle_id = origin_cycle.id
      and ci.slot_number = credit.slot_number::integer
      and ci.status in ('assigned', 'redeemed', 'expired')
  ) then
    return query select 'slot_taken'::text, null::uuid;
    return;
  end if;

  begin
    if origin_cycle.id is null then
      insert into public.challenge_cycles (user_id, cycle_month, status, swap_count_used)
      values (p_user_id, credit.issue_period, 'active', 0)
      returning id into inserted_cycle_id;
    else
      inserted_cycle_id := origin_cycle.id;
    end if;

    insert into public.challenge_items (
      cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
    ) values (
      inserted_cycle_id, p_restaurant_id, credit.slot_number, 'assigned', version_id, v_now, v_deadline
    )
    returning id into new_item_id;

    perform public.reserve_version_buckets(
      new_item_id, version_id, p_restaurant_id, v_now, v_deadline
    );

    update public.entitlement_credits
    set status = 'linked',
        challenge_item_id = new_item_id
    where id = credit.id
      and user_id = p_user_id
      and status = 'pending'
      and challenge_item_id is null;
    get diagnostics n = row_count;
    if n is distinct from 1 then
      raise exception 'credit link update failed';
    end if;

    update public.challenge_items
    set credit_id = credit.id
    where id = new_item_id
      and credit_id is null;
    get diagnostics n = row_count;
    if n is distinct from 1 then
      raise exception 'item credit link update failed';
    end if;

    return query select 'linked'::text, inserted_cycle_id;
    return;
  exception
    when others then
      if sqlerrm like '%capacity full%' then
        return query select 'capacity_full'::text, null::uuid;
        return;
      end if;
      raise;
  end;
end;
$$;

comment on function public.assign_carried_credit(uuid, uuid, uuid, uuid) is
  'Place one restaurant on one carried pending credit. Service role only. Does not expire, roll, or swap.';

revoke all on function public.assign_carried_credit(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.assign_carried_credit(uuid, uuid, uuid, uuid) to service_role;
