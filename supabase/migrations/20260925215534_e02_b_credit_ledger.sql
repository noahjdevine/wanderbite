-- E02-B inactive foundation: credit ledger and workflow cutover.
-- Does not roll credits, catch up missed months, or switch a member to credits.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.user_profiles
  add column workflow_version text not null default 'legacy';

alter table public.user_profiles
  add constraint user_profiles_workflow_version_check
  check (workflow_version in ('legacy', 'credits'));

alter table public.challenge_items
  add column credit_id uuid;

create table public.entitlement_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete restrict,
  issue_period date not null,
  slot_number smallint not null check (slot_number in (1, 2)),
  status text not null check (status in ('pending', 'linked', 'expired', 'spent')),
  challenge_item_id uuid references public.challenge_items (id) on delete restrict,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (user_id, issue_period, slot_number),
  constraint entitlement_credits_item_link_check check (
    (status = 'pending' and challenge_item_id is null)
    or status = 'expired'
    or (status in ('linked', 'spent') and challenge_item_id is not null)
  )
);

create unique index entitlement_credits_item_uidx
  on public.entitlement_credits (challenge_item_id)
  where challenge_item_id is not null;

alter table public.challenge_items
  add constraint challenge_items_credit_id_fkey
  foreign key (credit_id) references public.entitlement_credits (id) on delete restrict;

create unique index challenge_items_credit_uidx
  on public.challenge_items (credit_id)
  where credit_id is not null;

alter table public.entitlement_credits enable row level security;
revoke all on table public.entitlement_credits from public, anon, authenticated, service_role;
grant select on table public.entitlement_credits to service_role;

create or replace function public.protect_user_profiles_privileged_columns()
returns trigger
language plpgsql
set search_path to pg_catalog, public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role is distinct from 'subscriber'
      or new.is_admin is distinct from false
      or new.subscription_status is distinct from 'inactive'
      or new.stripe_customer_id is not null
      or new.current_period_end is not null
      or new.workflow_version is distinct from 'legacy'
    then
      raise exception 'Cannot modify privileged profile columns'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role
    or new.is_admin is distinct from old.is_admin
    or new.subscription_status is distinct from old.subscription_status
    or new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.current_period_end is distinct from old.current_period_end
    or new.workflow_version is distinct from old.workflow_version
  then
    raise exception 'Cannot modify privileged profile columns'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.issue_period_credits(
  p_user_id uuid,
  p_issue_period date
)
returns text
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  profile public.user_profiles%rowtype;
  n integer;
  expires_at timestamptz;
begin
  select up.* into profile
  from public.user_profiles up
  where up.id = p_user_id
  for update;
  if not found or profile.workflow_version is distinct from 'credits' then
    return 'legacy_workflow';
  end if;
  if profile.subscription_status is distinct from 'active' then
    return 'inactive_subscription';
  end if;
  if p_issue_period is null or p_issue_period is distinct from public.chicago_month_start(now()) then
    return 'local_month_not_open';
  end if;

  update public.entitlement_credits
  set status = 'expired'
  where user_id = p_user_id
    and issue_period = p_issue_period
    and status = 'pending'
    and challenge_item_id is null
    and expires_at <= now();

  select count(*) into n
  from public.entitlement_credits
  where user_id = p_user_id and issue_period = p_issue_period;
  if n = 2 then
    return 'existing';
  end if;
  if n <> 0 then
    return 'incomplete_credits';
  end if;

  expires_at := (p_issue_period + interval '1 month')::timestamp at time zone 'America/Chicago';
  begin
    insert into public.entitlement_credits (
      user_id, issue_period, slot_number, status, expires_at
    ) values
      (p_user_id, p_issue_period, 1, 'pending', expires_at),
      (p_user_id, p_issue_period, 2, 'pending', expires_at);
  exception
    when unique_violation then
      select count(*) into n
      from public.entitlement_credits
      where user_id = p_user_id and issue_period = p_issue_period;
      if n = 2 then
        return 'existing';
      end if;
      return 'incomplete_credits';
  end;
  return 'created';
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
  base_sum integer;
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

  base_sum := 0;
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
    if one_base is null then
      return query select 'pair_below_floor'::text, null::uuid;
      return;
    end if;
    base_sum := base_sum + one_base;
  end loop;
  if base_sum < 2000 then
    return query select 'pair_below_floor'::text, null::uuid;
    return;
  end if;

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

    base_sum := 0;
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
      if one_base is null then
        raise exception 'E02: pair below floor' using errcode = 'P0001';
      end if;
      base_sum := base_sum + one_base;
    end loop;
    if base_sum < 2000 then
      raise exception 'E02: pair below floor' using errcode = 'P0001';
    end if;

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
      if sqlerrm like '%pair below floor%' then
        return query select 'pair_below_floor'::text, null::uuid;
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

create or replace function public.expire_due_pending_credits()
returns integer
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  n integer;
begin
  update public.entitlement_credits
  set status = 'expired'
  where status = 'pending'
    and challenge_item_id is null
    and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.expire_version_bound_assignment(p_item_id uuid)
returns text
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  item public.challenge_items%rowtype;
  redemption public.redemptions%rowtype;
  n integer;
begin
  select ci.* into item
  from public.challenge_items ci
  where ci.id = p_item_id
  for update;
  if not found or item.redemption_deadline is null or now() < item.redemption_deadline then
    return 'unchanged';
  end if;

  select rd.* into redemption
  from public.redemptions rd
  where rd.challenge_item_id = p_item_id
  for update;

  if found and redemption.status = 'verified' then
    return 'verified';
  end if;

  if found and redemption.status = 'issued' then
    update public.redemptions set status = 'expired' where id = redemption.id and status = 'issued';
  end if;

  if item.status in ('assigned', 'redeemed') then
    update public.challenge_items
    set status = 'expired'
    where id = p_item_id and status in ('assigned', 'redeemed');
    get diagnostics n = row_count;
    if n is distinct from 1 and item.status is distinct from 'expired' then
      raise exception 'E02: expire item update failed';
    end if;
    if n = 1 and item.credit_id is not null then
      update public.entitlement_credits
      set status = 'expired'
      where id = item.credit_id and status = 'linked';
    end if;
  end if;

  update public.capacity_reservations
  set status = 'released'
  where challenge_item_id = p_item_id and status = 'reserved';
  return 'expired';
end;
$$;

create or replace function public.verify_redemption_and_settle(
  p_token_hash text,
  p_restaurant_id uuid
)
returns setof public.redemptions
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  claimed public.redemptions%rowtype;
  item public.challenge_items%rowtype;
  bucket date;
  v_tz text;
  item_found boolean;
begin
  select * into claimed
  from public.verify_redemption(p_token_hash, p_restaurant_id)
  limit 1;
  if not found then
    return;
  end if;

  select ci.* into item
  from public.challenge_items ci
  where ci.id = claimed.challenge_item_id
  for update;
  item_found := found;
  if item_found and item.offer_version_id is not null then
    select capacity_timezone into v_tz
    from public.offer_versions
    where id = item.offer_version_id;
    bucket := date_trunc('month', claimed.verified_at at time zone v_tz)::date;
    update public.capacity_reservations
    set status = 'consumed'
    where challenge_item_id = item.id and bucket_start = bucket and status = 'reserved';
    update public.capacity_reservations
    set status = 'released'
    where challenge_item_id = item.id and bucket_start is distinct from bucket and status = 'reserved';
  end if;
  if item_found and item.credit_id is not null then
    update public.entitlement_credits
    set status = 'spent'
    where id = item.credit_id and status = 'linked';
  end if;
  return next claimed;
end;
$$;

revoke all on function public.issue_period_credits(uuid, date) from public, anon, authenticated, service_role;
revoke all on function public.link_pending_credits(uuid, date, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.expire_due_pending_credits() from public, anon, authenticated, service_role;
grant execute on function public.issue_period_credits(uuid, date) to service_role;
grant execute on function public.link_pending_credits(uuid, date, uuid, uuid, uuid) to service_role;
grant execute on function public.expire_due_pending_credits() to service_role;
