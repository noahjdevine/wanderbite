-- E02: independent 1000-cent per-credit floor (Noah 2026-10-10).
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.credit_floor_cents()
returns integer
language sql
immutable
security invoker
set search_path to pg_catalog, public
as $$
  select 1000;
$$;

create or replace function public.offer_version_terms_ok(
  p_tiers jsonb,
  p_boosts jsonb,
  p_timezone text,
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_capacity_timezone text,
  p_capacity_window_kind text,
  p_capacity_max_redemptions integer
) returns text
language plpgsql
stable
security invoker
set search_path to pg_catalog, public
as $$
declare
  tier jsonb;
  boost jsonb;
  prev_threshold integer := 0;
  prev_discount integer := 0;
  threshold integer;
  discount integer;
  bonus integer;
  seen boolean := false;
begin
  if p_capacity_window_kind is distinct from 'calendar_month' then
    return 'capacity_window_kind';
  end if;
  if p_capacity_max_redemptions is null or p_capacity_max_redemptions <= 0 then
    return 'capacity_max_redemptions';
  end if;
  if p_timezone is null or not exists (
    select 1 from pg_timezone_names where name = p_timezone
  ) then
    return 'timezone';
  end if;
  if p_capacity_timezone is null or not exists (
    select 1 from pg_timezone_names where name = p_capacity_timezone
  ) then
    return 'capacity_timezone';
  end if;
  if p_valid_from is null or p_valid_until is null or p_valid_until <= p_valid_from then
    return 'validity';
  end if;
  if jsonb_typeof(p_tiers) is distinct from 'array' or jsonb_array_length(p_tiers) < 1 then
    return 'tiers';
  end if;
  for tier in select value from jsonb_array_elements(p_tiers)
  loop
    threshold := (tier ->> 'threshold_cents')::integer;
    discount := (tier ->> 'discount_cents')::integer;
    if threshold is null or discount is null or threshold <= 0 or discount <= 0 then
      return 'tier_cents';
    end if;
    if discount > threshold then
      return 'tier_above_threshold';
    end if;
    if seen and (threshold <= prev_threshold or discount < prev_discount) then
      return 'tier_order';
    end if;
    if not seen and discount < public.credit_floor_cents() then
      return 'lowest_tier_below_credit_floor';
    end if;
    prev_threshold := threshold;
    prev_discount := discount;
    seen := true;
  end loop;
  if p_boosts is null or jsonb_typeof(p_boosts) is distinct from 'array' then
    return 'boosts';
  end if;
  for boost in select value from jsonb_array_elements(p_boosts)
  loop
    bonus := (boost ->> 'bonus_cents')::integer;
    if bonus is null or bonus <= 0 then
      return 'boost_cents';
    end if;
    if coalesce(boost ->> 'id', '') = '' then
      return 'boost_id';
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public.generate_challenge_cycle(
  p_user_id uuid,
  p_cycle_month date,
  p_market_id uuid,
  p_restaurant_ids uuid[]
)
returns table (outcome text, cycle_id uuid)
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  profile_status text;
  inserted_cycle_id uuid;
  existing_cycle_id uuid;
  n integer;
  rest_id uuid;
  rest_ids uuid[];
  rest_status text;
  rest_market uuid;
  version_backed boolean := false;
  one_base integer;
  v_now timestamptz := now();
  chicago date;
  item_id uuid;
  version_id uuid;
  slot integer;
begin
  if p_user_id is null then
    return query select 'inactive_subscription'::text, null::uuid;
    return;
  end if;

  select up.subscription_status into profile_status
  from public.user_profiles as up
  where up.id = p_user_id
  for update;
  get diagnostics n = row_count;
  if n is distinct from 1 or profile_status is distinct from 'active' then
    return query select 'inactive_subscription'::text, null::uuid;
    return;
  end if;

  if p_cycle_month is null or p_market_id is null or p_restaurant_ids is null
     or cardinality(p_restaurant_ids) is distinct from 2
     or exists (select 1 from unnest(p_restaurant_ids) as u(rid) where u.rid is null)
     or (select count(distinct u.rid) from unnest(p_restaurant_ids) as u(rid)) is distinct from 2
  then
    return query select 'invalid_restaurants'::text, null::uuid;
    return;
  end if;

  select array_agg(u.rid order by u.rid) into rest_ids
  from unnest(p_restaurant_ids) as u(rid);

  foreach rest_id in array rest_ids loop
    select r.status, r.market_id
      into rest_status, rest_market
    from public.restaurants r
    where r.id = rest_id;
    if not found
       or rest_status is distinct from 'active'
       or rest_market is distinct from p_market_id
    then
      return query select 'invalid_restaurants'::text, null::uuid;
      return;
    end if;
  end loop;

  select exists (
    select 1 from public.restaurants r
    where r.id = any(rest_ids) and r.current_offer_version_id is not null
  ) into version_backed;

  chicago := public.chicago_month_start(v_now);
  if version_backed and p_cycle_month is distinct from chicago then
    return query select 'local_month_not_open'::text, null::uuid;
    return;
  end if;

  foreach rest_id in array rest_ids loop
    one_base := public.restaurant_base_cents(rest_id);
    if one_base is null or one_base < public.credit_floor_cents() then
      return query select 'below_floor'::text, null::uuid;
      return;
    end if;
  end loop;

  insert into public.challenge_cycles (user_id, cycle_month, status, swap_count_used)
  values (p_user_id, p_cycle_month, 'active', 0)
  on conflict (user_id, cycle_month) do nothing
  returning public.challenge_cycles.id into inserted_cycle_id;

  select cc.id into existing_cycle_id
  from public.challenge_cycles as cc
  where cc.user_id = p_user_id and cc.cycle_month = p_cycle_month
  for update;

  if inserted_cycle_id is null then
    if (
      select count(*) = 2
        and count(*) filter (where ci.slot_number = 1) = 1
        and count(*) filter (where ci.slot_number = 2) = 1
        and count(distinct ci.restaurant_id) = 2
      from public.challenge_items ci
      where ci.cycle_id = existing_cycle_id
        and ci.status in ('assigned', 'redeemed', 'expired')
    ) then
      return query select 'existing'::text, existing_cycle_id;
      return;
    end if;
    return query select 'incomplete_cycle'::text, existing_cycle_id;
    return;
  end if;

  foreach rest_id in array rest_ids loop
    perform 1 from public.restaurants r where r.id = rest_id for update;
  end loop;

  slot := 0;
  foreach rest_id in array p_restaurant_ids loop
    slot := slot + 1;
    select r.current_offer_version_id into version_id
    from public.restaurants r
    where r.id = rest_id and r.status = 'active' and r.market_id = p_market_id;
    if not found then
      raise exception 'E02: invalid restaurant' using errcode = 'P0001';
    end if;
    if version_id is not null then
      if not public.version_selection_ok(version_id, v_now) then
        raise exception 'E02: version not selectable' using errcode = 'P0001';
      end if;
    else
      if not exists (
        select 1 from public.restaurant_offers o
        where o.restaurant_id = rest_id and o.active = true
      ) then
        raise exception 'E02: missing flat offer' using errcode = 'P0001';
      end if;
    end if;

    insert into public.challenge_items (
      cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
    ) values (
      existing_cycle_id,
      rest_id,
      slot,
      'assigned',
      version_id,
      v_now,
      case when version_id is null then null else v_now + interval '840 hours' end
    )
    returning id into item_id;

    if version_id is not null then
      perform public.reserve_version_buckets(
        item_id, version_id, rest_id, v_now, v_now + interval '840 hours'
      );
    end if;
  end loop;

  return query select 'created'::text, existing_cycle_id;
exception
  when others then
    if sqlerrm like '%capacity full%' then
      return query select 'capacity_full'::text, null::uuid;
      return;
    end if;
    if sqlerrm like 'E02:%' then
      return query select 'invalid_restaurants'::text, null::uuid;
      return;
    end if;
    raise;
end;
$$;

create or replace function public.link_pending_credits(
  p_user_id uuid,
  p_issue_period date,
  p_market_id uuid,
  p_restaurant_a uuid,
  p_restaurant_b uuid
)
returns table (outcome text, cycle_id uuid)
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  profile public.user_profiles%rowtype;
  credit1 public.entitlement_credits%rowtype;
  credit2 public.entitlement_credits%rowtype;
  existing_cycle_id uuid;
  item1 public.challenge_items%rowtype;
  item2 public.challenge_items%rowtype;
  rest_status text;
  rest_market uuid;
  version_id uuid;
  one_base integer;
  v_now timestamptz;
  inserted_cycle_id uuid;
  new_item_id uuid;
  slot1_item uuid;
  slot2_item uuid;
  first_id uuid;
  second_id uuid;
begin
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
  if p_issue_period is null or p_issue_period is distinct from public.chicago_month_start(now()) then
    return query select 'local_month_not_open'::text, null::uuid;
    return;
  end if;
  if p_market_id is null or p_restaurant_a is null or p_restaurant_b is null
     or p_restaurant_a = p_restaurant_b then
    return query select 'invalid_pair'::text, null::uuid;
    return;
  end if;

  select * into credit1
  from public.entitlement_credits
  where user_id = p_user_id and issue_period = p_issue_period and slot_number = 1
  for update;
  select * into credit2
  from public.entitlement_credits
  where user_id = p_user_id and issue_period = p_issue_period and slot_number = 2
  for update;
  if credit1.id is null or credit2.id is null then
    return query select 'credits_missing'::text, null::uuid;
    return;
  end if;

  if credit1.challenge_item_id is not null and credit2.challenge_item_id is not null
     and credit1.status in ('linked', 'spent', 'expired')
     and credit2.status in ('linked', 'spent', 'expired') then
    select * into item1 from public.challenge_items where id = credit1.challenge_item_id for update;
    select * into item2 from public.challenge_items where id = credit2.challenge_item_id for update;
    if item1.cycle_id is not null and item1.cycle_id = item2.cycle_id
       and item1.slot_number = 1 and item2.slot_number = 2 then
      perform 1 from public.challenge_cycles where id = item1.cycle_id for update;
      return query select 'existing'::text, item1.cycle_id;
      return;
    end if;
    raise exception 'E02: partial credit link';
  end if;

  if (credit1.challenge_item_id is null) is distinct from (credit2.challenge_item_id is null) then
    raise exception 'E02: partial credit link';
  end if;

  if credit1.status is distinct from 'pending' or credit2.status is distinct from 'pending'
     or credit1.expires_at <= now() or credit2.expires_at <= now() then
    update public.entitlement_credits
    set status = 'expired'
    where id in (credit1.id, credit2.id)
      and status = 'pending'
      and challenge_item_id is null
      and expires_at <= now();
    if credit1.expires_at <= now() and credit2.expires_at <= now() then
      return query select 'credits_expired'::text, null::uuid;
      return;
    end if;
    return query select 'incomplete_credits'::text, null::uuid;
    return;
  end if;

  select cc.id into existing_cycle_id
  from public.challenge_cycles cc
  where cc.user_id = p_user_id and cc.cycle_month = p_issue_period
  for update;
  if existing_cycle_id is not null then
    return query select 'legacy_cycle_present'::text, null::uuid;
    return;
  end if;

  foreach first_id in array array[p_restaurant_a, p_restaurant_b] loop
    select r.status, r.market_id, r.current_offer_version_id, public.offer_lowest_tier_cents(v.tiers)
      into rest_status, rest_market, version_id, one_base
    from public.restaurants r
    left join public.offer_versions v on v.id = r.current_offer_version_id
    where r.id = first_id;
    if not found or rest_status is distinct from 'active' or rest_market is distinct from p_market_id
       or version_id is null or not public.version_selection_ok(version_id, now()) then
      return query select 'invalid_restaurants'::text, null::uuid;
      return;
    end if;
    if one_base is null or one_base < public.credit_floor_cents() then
      return query select 'below_floor'::text, null::uuid;
      return;
    end if;
  end loop;

  begin
    v_now := now();
    insert into public.challenge_cycles (user_id, cycle_month, status, swap_count_used)
    values (p_user_id, p_issue_period, 'active', 0)
    returning id into inserted_cycle_id;

    if p_restaurant_a < p_restaurant_b then
      first_id := p_restaurant_a;
      second_id := p_restaurant_b;
    else
      first_id := p_restaurant_b;
      second_id := p_restaurant_a;
    end if;
    perform 1 from public.restaurants where id = first_id for update;
    perform 1 from public.restaurants where id = second_id for update;

    foreach first_id in array array[p_restaurant_a, p_restaurant_b] loop
      select r.status, r.market_id, r.current_offer_version_id, public.offer_lowest_tier_cents(v.tiers)
        into rest_status, rest_market, version_id, one_base
      from public.restaurants r
      left join public.offer_versions v on v.id = r.current_offer_version_id
      where r.id = first_id;
      if not found or rest_status is distinct from 'active' or rest_market is distinct from p_market_id
         or version_id is null or not public.version_selection_ok(version_id, v_now) then
        raise exception 'E02: invalid restaurant' using errcode = 'P0001';
      end if;
      if one_base is null or one_base < public.credit_floor_cents() then
        raise exception 'E02: below floor' using errcode = 'P0001';
      end if;
    end loop;

    select r.current_offer_version_id into version_id
    from public.restaurants r
    where r.id = p_restaurant_a;
    insert into public.challenge_items (
      cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
    ) values (
      inserted_cycle_id, p_restaurant_a, 1, 'assigned', version_id, v_now, v_now + interval '840 hours'
    )
    returning id into new_item_id;
    perform public.reserve_version_buckets(
      new_item_id, version_id, p_restaurant_a, v_now, v_now + interval '840 hours'
    );
    slot1_item := new_item_id;

    select r.current_offer_version_id into version_id
    from public.restaurants r
    where r.id = p_restaurant_b;
    insert into public.challenge_items (
      cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
    ) values (
      inserted_cycle_id, p_restaurant_b, 2, 'assigned', version_id, v_now, v_now + interval '840 hours'
    )
    returning id into new_item_id;
    perform public.reserve_version_buckets(
      new_item_id, version_id, p_restaurant_b, v_now, v_now + interval '840 hours'
    );
    slot2_item := new_item_id;

    update public.entitlement_credits
    set status = 'linked', challenge_item_id = slot1_item
    where id = credit1.id and status = 'pending' and challenge_item_id is null;
    if not found then
      raise exception 'credit link update failed';
    end if;
    update public.entitlement_credits
    set status = 'linked', challenge_item_id = slot2_item
    where id = credit2.id and status = 'pending' and challenge_item_id is null;
    if not found then
      raise exception 'credit link update failed';
    end if;
    update public.challenge_items set credit_id = credit1.id where id = slot1_item;
    update public.challenge_items set credit_id = credit2.id where id = slot2_item;

    return query select 'linked'::text, inserted_cycle_id;
    return;
  exception
    when others then
      if sqlerrm like '%capacity full%' then
        return query select 'capacity_full'::text, null::uuid;
        return;
      end if;
      if sqlerrm like '%below floor%' then
        return query select 'below_floor'::text, null::uuid;
        return;
      end if;
      if sqlerrm like 'E02:%' then
        return query select 'invalid_restaurants'::text, null::uuid;
        return;
      end if;
      raise;
  end;
end;
$$;

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

  if one_base is null or one_base < public.credit_floor_cents() then
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

create or replace function public.swap_linked_credit_item(
  p_user_id uuid,
  p_item_id uuid,
  p_replacement_restaurant_id uuid
)
returns table (
  outcome text,
  source_item_id uuid,
  replacement_item_id uuid,
  restaurant_id uuid
)
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  n integer;
  profile public.user_profiles%rowtype;
  source public.challenge_items%rowtype;
  hop public.challenge_items%rowtype;
  next_item public.challenge_items%rowtype;
  cycle public.challenge_cycles%rowtype;
  credit public.entitlement_credits%rowtype;
  sibling public.challenge_items%rowtype;
  v_now timestamptz := now();
  v_month date;
  allowance_found boolean := false;
  v_cycle_id uuid;
  seen uuid[];
  step integer;
  v_carried boolean;
  v_candidate timestamptz;
  v_deadline timestamptz;
  source_market uuid;
  replacement_status text;
  replacement_market uuid;
  version_id uuid;
  v_valid_from timestamptz;
  v_valid_until timestamptz;
  v_withdrawn timestamptz;
  repl_base integer;
  sib_base integer;
  first_id uuid;
  second_id uuid;
  new_item_id uuid;
  constraint_name text;
begin
  if p_user_id is null or p_item_id is null then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  select up.* into profile
  from public.user_profiles up
  where up.id = p_user_id
  for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;
  if profile.workflow_version is distinct from 'credits' then
    return query select 'legacy_workflow'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;
  if profile.subscription_status is distinct from 'active' then
    return query select 'inactive_subscription'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  v_month := public.chicago_month_start(v_now);
  perform 1
  from public.credit_swap_allowances a
  where a.user_id = p_user_id
    and a.swap_month = v_month
  for update;
  allowance_found := found;

  select ci.cycle_id into v_cycle_id
  from public.challenge_items ci
  where ci.id = p_item_id;
  get diagnostics n = row_count;
  if n is distinct from 1 or v_cycle_id is null then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  select cc.* into cycle
  from public.challenge_cycles cc
  where cc.id = v_cycle_id
  for update;
  get diagnostics n = row_count;
  if n is distinct from 1 then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;
  if cycle.user_id is distinct from p_user_id then
    return query select 'forbidden'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  select ci.* into source
  from public.challenge_items ci
  where ci.id = p_item_id
  for update;
  get diagnostics n = row_count;
  if n is distinct from 1 then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;
  if source.cycle_id is distinct from cycle.id then
    return query select 'malformed_lineage'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  if source.status = 'swapped_out' then
    if source.credit_id is not null then
      return query select 'malformed_lineage'::text, p_item_id, null::uuid, null::uuid;
      return;
    end if;
    hop := source;
    seen := array[source.id];
    for step in 1..32 loop
      begin
        select ci.* into strict next_item
        from public.challenge_items ci
        where ci.swapped_from_item_id = hop.id
        for update;
      exception
        when no_data_found then
          return query select 'malformed_lineage'::text, p_item_id, null::uuid, null::uuid;
          return;
        when too_many_rows then
          return query select 'malformed_lineage'::text, p_item_id, null::uuid, null::uuid;
          return;
      end;
      if next_item.id = any(seen)
         or next_item.cycle_id is distinct from cycle.id
         or next_item.slot_number is distinct from source.slot_number
      then
        return query select 'malformed_lineage'::text, p_item_id, null::uuid, null::uuid;
        return;
      end if;
      if next_item.status = 'swapped_out' then
        if next_item.credit_id is not null then
          return query select 'malformed_lineage'::text, p_item_id, null::uuid, null::uuid;
          return;
        end if;
        seen := seen || next_item.id;
        hop := next_item;
      elsif next_item.status in ('assigned', 'redeemed') then
        if next_item.credit_id is null then
          return query select 'malformed_lineage'::text, p_item_id, null::uuid, null::uuid;
          return;
        end if;
        select ec.* into credit
        from public.entitlement_credits ec
        where ec.id = next_item.credit_id
        for update;
        if not found
           or credit.user_id is distinct from p_user_id
           or credit.challenge_item_id is distinct from next_item.id
        then
          return query select 'malformed_lineage'::text, p_item_id, null::uuid, null::uuid;
          return;
        end if;
        return query select 'existing'::text, p_item_id, next_item.id, next_item.restaurant_id;
        return;
      else
        return query select 'malformed_lineage'::text, p_item_id, null::uuid, null::uuid;
        return;
      end if;
    end loop;
    return query select 'malformed_lineage'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  if source.status is distinct from 'assigned' or source.credit_id is null then
    return query select 'not_found'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  select ec.* into credit
  from public.entitlement_credits ec
  where ec.id = source.credit_id
  for update;
  if not found or credit.user_id is distinct from p_user_id then
    return query select 'not_found'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;
  if credit.status is distinct from 'linked'
     or credit.challenge_item_id is distinct from source.id
  then
    return query select 'malformed_lineage'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;
  if source.redemption_deadline is not null and v_now >= source.redemption_deadline then
    return query select 'past_deadline'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;
  if allowance_found then
    return query select 'swap_exhausted'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  if credit.issue_period = v_month then
    v_carried := false;
    v_deadline := v_now + interval '840 hours';
  elsif credit.issue_period < v_month then
    v_carried := true;
    v_candidate := least(v_now + interval '840 hours', credit.expires_at);
    if v_candidate > v_now and credit.expires_at > v_now then
      v_deadline := v_candidate;
    elsif source.redemption_deadline is not null and v_now < source.redemption_deadline then
      v_deadline := least(source.redemption_deadline, v_now + interval '840 hours');
    else
      return query select 'past_deadline'::text, p_item_id, null::uuid, null::uuid;
      return;
    end if;
  else
    return query select 'not_found'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;
  if v_deadline is null or v_deadline <= v_now then
    return query select 'past_deadline'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  if p_replacement_restaurant_id is null
     or p_replacement_restaurant_id is not distinct from source.restaurant_id
  then
    return query select 'invalid_restaurants'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  if source.restaurant_id < p_replacement_restaurant_id then
    first_id := source.restaurant_id;
    second_id := p_replacement_restaurant_id;
  else
    first_id := p_replacement_restaurant_id;
    second_id := source.restaurant_id;
  end if;
  perform 1 from public.restaurants where id = first_id for update;
  perform 1 from public.restaurants where id = second_id for update;

  select r.market_id into source_market
  from public.restaurants r
  where r.id = source.restaurant_id;
  select r.status, r.market_id, r.current_offer_version_id,
         v.valid_from, v.valid_until, v.withdrawn_from_selection_at,
         public.offer_lowest_tier_cents(v.tiers)
    into replacement_status, replacement_market, version_id,
         v_valid_from, v_valid_until, v_withdrawn, repl_base
  from public.restaurants r
  left join public.offer_versions v
    on v.id = r.current_offer_version_id
   and v.restaurant_id = r.id
  where r.id = p_replacement_restaurant_id;
  if not found
     or replacement_status is distinct from 'active'
     or replacement_market is null
     or replacement_market is distinct from source_market
     or version_id is null
  then
    return query select 'invalid_restaurants'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  if not v_carried then
    if not public.version_selection_ok(version_id, v_now) then
      return query select 'invalid_restaurants'::text, p_item_id, null::uuid, null::uuid;
      return;
    end if;
  elsif v_withdrawn is not null
     or v_valid_from is null
     or v_valid_from > v_now
     or v_valid_until is null
     or not (v_now < v_valid_until)
     or not (v_valid_until > v_deadline)
  then
    return query select 'invalid_restaurants'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  if exists (
    select 1
    from public.challenge_items ci
    where ci.cycle_id = cycle.id
      and ci.restaurant_id = p_replacement_restaurant_id
      and ci.status in ('assigned', 'redeemed', 'expired')
  ) then
    if v_carried then
      return query select 'duplicate_restaurant'::text, p_item_id, null::uuid, null::uuid;
    else
      return query select 'invalid_restaurants'::text, p_item_id, null::uuid, null::uuid;
    end if;
    return;
  end if;

  if exists (
    select 1
    from public.challenge_items ci
    join public.challenge_cycles cc on cc.id = ci.cycle_id
    join public.entitlement_credits ec on ec.id = ci.credit_id
    where cc.user_id = p_user_id
      and ci.cycle_id is distinct from cycle.id
      and ci.restaurant_id = p_replacement_restaurant_id
      and ec.user_id = p_user_id
      and ec.challenge_item_id = ci.id
      and ec.status = 'linked'
      and (
        (ci.status = 'assigned' and (ci.redemption_deadline is null or v_now < ci.redemption_deadline))
        or ci.status = 'redeemed'
      )
  ) then
    return query select 'duplicate_restaurant'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  if repl_base is null or repl_base < public.credit_floor_cents() then
    return query select 'below_floor'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  update public.challenge_items as ci
  set status = 'swapped_out'
  where ci.id = source.id and ci.status = 'assigned';
  get diagnostics n = row_count;
  if n is distinct from 1 then
    raise exception 'E02: swap source update expected 1 row, got %', n;
  end if;

  update public.capacity_reservations
  set status = 'released'
  where challenge_item_id = source.id and status = 'reserved';

  insert into public.challenge_items (
    cycle_id, restaurant_id, slot_number, status, swapped_from_item_id,
    offer_version_id, assigned_at, redemption_deadline
  ) values (
    cycle.id, p_replacement_restaurant_id, source.slot_number, 'assigned', source.id,
    version_id, v_now, v_deadline
  )
  returning id into new_item_id;

  perform public.reserve_version_buckets(
    new_item_id, version_id, p_replacement_restaurant_id, v_now, v_deadline
  );

  update public.challenge_items as ci
  set credit_id = null
  where ci.id = source.id
    and ci.credit_id = credit.id;
  get diagnostics n = row_count;
  if n is distinct from 1 then
    raise exception 'E02: source credit detach expected 1 row, got %', n;
  end if;

  update public.entitlement_credits as ec
  set challenge_item_id = new_item_id
  where ec.id = credit.id
    and ec.challenge_item_id = source.id
    and ec.status = 'linked';
  get diagnostics n = row_count;
  if n is distinct from 1 then
    raise exception 'E02: credit retarget expected 1 row, got %', n;
  end if;

  update public.challenge_items as ci
  set credit_id = credit.id
  where ci.id = new_item_id
    and ci.credit_id is null;
  get diagnostics n = row_count;
  if n is distinct from 1 then
    raise exception 'E02: successor credit attach expected 1 row, got %', n;
  end if;

  insert into public.credit_swap_allowances (user_id, swap_month, source_item_id)
  values (p_user_id, v_month, source.id);

  return query select 'created'::text, p_item_id, new_item_id, p_replacement_restaurant_id;
exception
  when unique_violation then
    get stacked diagnostics constraint_name = constraint_name;
    if constraint_name = 'credit_swap_allowances_pkey' then
      return query select 'swap_exhausted'::text, p_item_id, null::uuid, null::uuid;
      return;
    end if;
    raise;
  when others then
    if sqlerrm like '%capacity full%' then
      return query select 'capacity_full'::text, p_item_id, null::uuid, null::uuid;
      return;
    end if;
    raise;
end;
$$;

create or replace function public.swap_challenge_item(
  p_user_id uuid,
  p_item_id uuid,
  p_replacement_restaurant_id uuid
)
returns table (
  outcome text,
  source_item_id uuid,
  replacement_item_id uuid,
  restaurant_id uuid
)
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  n integer;
  source public.challenge_items%rowtype;
  cycle public.challenge_cycles%rowtype;
  successor public.challenge_items%rowtype;
  sibling public.challenge_items%rowtype;
  source_market uuid;
  replacement_status text;
  replacement_market uuid;
  version_id uuid;
  new_item_id uuid;
  current_conflict uuid;
  v_now timestamptz := now();
  one_base integer;
  first_id uuid;
  second_id uuid;
begin
  if p_user_id is null or p_item_id is null then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  select ci.* into source from public.challenge_items as ci where ci.id = p_item_id;
  get diagnostics n = row_count;
  if n is distinct from 1 then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  select cc.* into cycle from public.challenge_cycles as cc where cc.id = source.cycle_id for update;
  get diagnostics n = row_count;
  if n is distinct from 1 then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;
  if cycle.user_id is distinct from p_user_id then
    return query select 'forbidden'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  if exists (
    select 1
    from public.user_profiles as up
    where up.id = cycle.user_id
      and up.workflow_version = 'credits'
  ) then
    return query select 'legacy_workflow'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  select ci.* into source from public.challenge_items as ci where ci.id = p_item_id for update;
  successor := null;
  begin
    select ci.* into strict successor
    from public.challenge_items as ci
    where ci.swapped_from_item_id = p_item_id;
  exception
    when no_data_found then successor := null;
    when too_many_rows then
      return query select 'malformed_lineage'::text, p_item_id, null::uuid, null::uuid;
      return;
  end;

  if source.status = 'swapped_out' or successor is not null then
    if successor is null
       or successor.swapped_from_item_id is distinct from p_item_id
       or successor.cycle_id is distinct from cycle.id
       or successor.slot_number is distinct from source.slot_number
       or successor.status not in ('assigned', 'redeemed')
       or source.status is distinct from 'swapped_out'
    then
      return query select 'malformed_lineage'::text, p_item_id, null::uuid, null::uuid;
      return;
    end if;
    return query select 'existing'::text, p_item_id, successor.id, successor.restaurant_id;
    return;
  end if;

  if cycle.swap_count_used >= 1 then
    return query select 'swap_exhausted'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;
  if source.status is distinct from 'assigned' then
    return query select 'not_found'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;
  if p_replacement_restaurant_id is null
     or p_replacement_restaurant_id is not distinct from source.restaurant_id
  then
    return query select 'invalid_restaurants'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  select ci.id into current_conflict
  from public.challenge_items as ci
  where ci.cycle_id = cycle.id
    and ci.restaurant_id = p_replacement_restaurant_id
    and ci.status in ('assigned', 'redeemed', 'expired')
  limit 1;
  if current_conflict is not null then
    return query select 'invalid_restaurants'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  if source.restaurant_id < p_replacement_restaurant_id then
    first_id := source.restaurant_id;
    second_id := p_replacement_restaurant_id;
  else
    first_id := p_replacement_restaurant_id;
    second_id := source.restaurant_id;
  end if;
  perform 1 from public.restaurants where id = first_id for update;
  perform 1 from public.restaurants where id = second_id for update;

  select r.market_id into source_market from public.restaurants r where r.id = source.restaurant_id;
  select r.status, r.market_id, r.current_offer_version_id
    into replacement_status, replacement_market, version_id
  from public.restaurants r
  where r.id = p_replacement_restaurant_id;
  if replacement_status is distinct from 'active'
     or replacement_market is null
     or replacement_market is distinct from source_market
  then
    return query select 'invalid_restaurants'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;
  if version_id is not null then
    if not public.version_selection_ok(version_id, v_now) then
      return query select 'invalid_restaurants'::text, p_item_id, null::uuid, null::uuid;
      return;
    end if;
  elsif not exists (
    select 1 from public.restaurant_offers o
    where o.restaurant_id = p_replacement_restaurant_id and o.active = true
  ) then
    return query select 'invalid_restaurants'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  select ci.* into sibling
  from public.challenge_items ci
  where ci.cycle_id = cycle.id
    and ci.id is distinct from source.id
    and ci.status in ('assigned', 'redeemed', 'expired')
  limit 1;
  one_base := public.restaurant_base_cents(p_replacement_restaurant_id);
  if one_base is null or one_base < public.credit_floor_cents() then
    return query select 'below_floor'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  update public.challenge_items as ci
  set status = 'swapped_out'
  where ci.id = p_item_id and ci.status = 'assigned';
  get diagnostics n = row_count;
  if n is distinct from 1 then
    raise exception 'OPS-02: swap source update expected 1 row, got %', n;
  end if;

  update public.capacity_reservations
  set status = 'released'
  where challenge_item_id = p_item_id and status = 'reserved';

  insert into public.challenge_items (
    cycle_id, restaurant_id, slot_number, status, swapped_from_item_id,
    offer_version_id, assigned_at, redemption_deadline
  ) values (
    cycle.id, p_replacement_restaurant_id, source.slot_number, 'assigned', p_item_id,
    version_id, v_now,
    case when version_id is null then null else v_now + interval '840 hours' end
  )
  returning id into new_item_id;

  if version_id is not null then
    perform public.reserve_version_buckets(
      new_item_id, version_id, p_replacement_restaurant_id, v_now, v_now + interval '840 hours'
    );
  end if;

  update public.challenge_cycles as cc
  set swap_count_used = cc.swap_count_used + 1
  where cc.id = cycle.id and cc.swap_count_used = 0 and cc.user_id = p_user_id;
  get diagnostics n = row_count;
  if n is distinct from 1 then
    raise exception 'OPS-02: swap count update expected 1 row, got %', n;
  end if;

  return query select 'created'::text, p_item_id, new_item_id, p_replacement_restaurant_id;
exception
  when others then
    if sqlerrm like '%capacity full%' then
      return query select 'capacity_full'::text, p_item_id, null::uuid, null::uuid;
      return;
    end if;
    raise;
end;
$$;


revoke all on function public.credit_floor_cents() from public, anon, authenticated, service_role;

revoke all on function public.offer_version_terms_ok(jsonb, jsonb, text, timestamptz, timestamptz, text, text, integer)
  from public, anon, authenticated, service_role;

revoke all on function public.generate_challenge_cycle(uuid, date, uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.generate_challenge_cycle(uuid, date, uuid, uuid[]) to service_role;

revoke all on function public.link_pending_credits(uuid, date, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.link_pending_credits(uuid, date, uuid, uuid, uuid) to service_role;

revoke all on function public.assign_carried_credit(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.assign_carried_credit(uuid, uuid, uuid, uuid) to service_role;

revoke all on function public.swap_linked_credit_item(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.swap_linked_credit_item(uuid, uuid, uuid) to service_role;

revoke all on function public.swap_challenge_item(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.swap_challenge_item(uuid, uuid, uuid) to service_role;
