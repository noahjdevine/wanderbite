-- E02 credit-safe swaps: one linked-credit swap per America/Chicago month.
-- Does not roll credits, assign carried credits, or set workflow_version.
-- Carried successor deadline: least(now() + 840 hours, credit.expires_at) when that
-- instant is still after now(); otherwise least(source.redemption_deadline, now() + 840 hours).
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.credit_swap_allowances (
  user_id uuid not null references public.user_profiles (id) on delete restrict,
  swap_month date not null,
  source_item_id uuid not null references public.challenge_items (id) on delete restrict,
  consumed_at timestamptz not null default now(),
  primary key (user_id, swap_month)
);

alter table public.credit_swap_allowances enable row level security;
revoke all on table public.credit_swap_allowances from public, anon, authenticated, service_role;
grant select on table public.credit_swap_allowances to service_role;

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

  if v_carried then
    if repl_base is null or repl_base < 2000 then
      return query select 'below_floor'::text, p_item_id, null::uuid, null::uuid;
      return;
    end if;
  else
    select ci.* into sibling
    from public.challenge_items ci
    where ci.cycle_id = cycle.id
      and ci.id is distinct from source.id
      and ci.status in ('assigned', 'redeemed', 'expired')
    order by ci.id
    limit 1
    for update;
    sib_base := null;
    if sibling.offer_version_id is not null then
      select public.offer_lowest_tier_cents(v.tiers) into sib_base
      from public.offer_versions v
      where v.id = sibling.offer_version_id;
    end if;
    if sibling.id is null or sib_base is null or repl_base is null or sib_base + repl_base < 2000 then
      return query select 'pair_below_floor'::text, p_item_id, null::uuid, null::uuid;
      return;
    end if;
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

comment on function public.swap_linked_credit_item(uuid, uuid, uuid) is
  'Move one linked credit onto a successor item. One credit_swap_allowances row per America/Chicago month. Carried deadline is least(now()+840 hours, expires_at) when that instant is after now(); otherwise least(source.redemption_deadline, now()+840 hours). Does not increment swap_count_used.';

revoke all on function public.swap_linked_credit_item(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.swap_linked_credit_item(uuid, uuid, uuid) to service_role;

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
  base_sum integer;
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
  base_sum := coalesce(public.restaurant_base_cents(p_replacement_restaurant_id), 0)
    + coalesce(public.restaurant_base_cents(sibling.restaurant_id), 0);
  if sibling.id is null or base_sum < 2000 then
    return query select 'pair_below_floor'::text, p_item_id, null::uuid, null::uuid;
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
