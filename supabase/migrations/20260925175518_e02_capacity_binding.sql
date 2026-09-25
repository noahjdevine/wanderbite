-- E02 slice: bind published offers, restaurant-level capacity, stored deadlines.
-- Does not rewrite older migrations. Publish still does not activate a restaurant.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.challenge_items
  add column assigned_at timestamptz,
  add column redemption_deadline timestamptz;

alter table public.challenge_items drop constraint if exists challenge_items_status_check;
alter table public.challenge_items
  add constraint challenge_items_status_check
  check (status in ('assigned', 'swapped_out', 'redeemed', 'expired'));

drop index if exists public.challenge_items_current_slot_uidx;
create unique index challenge_items_current_slot_uidx
  on public.challenge_items (cycle_id, slot_number)
  where status in ('assigned', 'redeemed', 'expired');

drop index if exists public.challenge_items_current_restaurant_uidx;
create unique index challenge_items_current_restaurant_uidx
  on public.challenge_items (cycle_id, restaurant_id)
  where status in ('assigned', 'redeemed', 'expired');

create table public.capacity_reservations (
  id uuid primary key default gen_random_uuid(),
  challenge_item_id uuid not null references public.challenge_items (id) on delete restrict,
  offer_version_id uuid not null,
  restaurant_id uuid not null,
  capacity_timezone text not null,
  bucket_start date not null,
  status text not null check (status in ('reserved', 'released', 'consumed')),
  unique (challenge_item_id, bucket_start),
  foreign key (offer_version_id, restaurant_id)
    references public.offer_versions (id, restaurant_id)
    on delete restrict
);

create index capacity_reservations_restaurant_bucket_idx
  on public.capacity_reservations (restaurant_id, bucket_start);

alter table public.capacity_reservations enable row level security;
revoke all on table public.capacity_reservations from public, anon, authenticated, service_role;
grant select on table public.capacity_reservations to service_role;

create or replace function public.chicago_month_start(p_at timestamptz)
returns date
language sql
stable
security invoker
set search_path to pg_catalog, public
as $$
  select date_trunc('month', p_at at time zone 'America/Chicago')::date;
$$;

create or replace function public.offer_lowest_tier_cents(p_tiers jsonb)
returns integer
language sql
stable
security invoker
set search_path to pg_catalog, public
as $$
  select (tier.value ->> 'discount_cents')::integer
  from jsonb_array_elements(p_tiers) as tier(value)
  order by (tier.value ->> 'threshold_cents')::integer
  limit 1;
$$;

create or replace function public.restaurant_base_cents(p_restaurant_id uuid)
returns integer
language plpgsql
stable
security invoker
set search_path to pg_catalog, public
as $$
declare
  version_id uuid;
  tiers jsonb;
  discount integer;
  minimum integer;
begin
  select current_offer_version_id into version_id
  from public.restaurants
  where id = p_restaurant_id;
  if version_id is not null then
    select t.tiers into tiers from public.offer_versions t where t.id = version_id;
    return public.offer_lowest_tier_cents(tiers);
  end if;
  select discount_amount_cents, min_spend_cents
    into discount, minimum
  from public.restaurant_offers
  where restaurant_id = p_restaurant_id
    and active = true
  order by id
  limit 1;
  if discount is null or discount <= 0 or minimum is null or discount > minimum then
    return null;
  end if;
  return discount;
end;
$$;

create or replace function public.version_selection_ok(
  p_version_id uuid,
  p_at timestamptz
) returns boolean
language sql
stable
security invoker
set search_path to pg_catalog, public
as $$
  select exists (
    select 1
    from public.offer_versions v
    join public.restaurants r on r.current_offer_version_id = v.id and r.id = v.restaurant_id
    where v.id = p_version_id
      and v.withdrawn_from_selection_at is null
      and v.valid_from <= p_at
      and p_at < v.valid_until
      and v.valid_until > p_at + interval '840 hours'
  );
$$;

create or replace function public.reserve_version_buckets(
  p_item_id uuid,
  p_version_id uuid,
  p_restaurant_id uuid,
  p_assigned timestamptz,
  p_deadline timestamptz
) returns void
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  v_tz text;
  v_cap integer;
  v_month date;
  v_count integer;
begin
  select capacity_timezone, capacity_max_redemptions
    into v_tz, v_cap
  from public.offer_versions
  where id = p_version_id
    and restaurant_id = p_restaurant_id;
  if v_tz is null then
    raise exception 'E02: missing offer version for reservation';
  end if;
  v_month := date_trunc('month', p_assigned at time zone v_tz)::date;
  while (v_month::timestamp at time zone v_tz) < p_deadline loop
    if ((v_month + interval '1 month')::timestamp at time zone v_tz) > p_assigned then
      select count(*) into v_count
      from public.capacity_reservations
      where restaurant_id = p_restaurant_id
        and bucket_start = v_month
        and status in ('reserved', 'consumed');
      if v_count >= v_cap then
        raise exception 'E02: capacity full for restaurant % bucket %', p_restaurant_id, v_month
          using errcode = 'P0001';
      end if;
      insert into public.capacity_reservations (
        challenge_item_id, offer_version_id, restaurant_id, capacity_timezone, bucket_start, status
      ) values (
        p_item_id, p_version_id, p_restaurant_id, v_tz, v_month, 'reserved'
      )
      on conflict (challenge_item_id, bucket_start) do nothing;
    end if;
    v_month := (v_month + interval '1 month')::date;
  end loop;
end;
$$;

create or replace function public.publish_offer_version(
  p_draft_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  draft public.offer_drafts%rowtype;
  problem text;
  version_id uuid;
  actor_role text;
  tz_mismatch integer;
begin
  select role into actor_role
  from public.user_profiles
  where id = p_actor_user_id;
  if actor_role is distinct from 'admin' then
    return jsonb_build_object('published', false, 'error', 'not_admin');
  end if;

  select * into draft
  from public.offer_drafts
  where id = p_draft_id
  for update;
  if not found then
    return jsonb_build_object('published', false, 'error', 'missing_draft');
  end if;

  problem := public.offer_version_terms_ok(
    draft.tiers, draft.boosts, draft.timezone, draft.valid_from, draft.valid_until,
    draft.capacity_timezone, draft.capacity_window_kind, draft.capacity_max_redemptions
  );
  if problem is not null then
    return jsonb_build_object('published', false, 'error', problem);
  end if;

  select count(*) into tz_mismatch
  from public.capacity_reservations
  where restaurant_id = draft.restaurant_id
    and status = 'reserved'
    and capacity_timezone is distinct from draft.capacity_timezone;
  if tz_mismatch > 0 then
    return jsonb_build_object('published', false, 'error', 'capacity_timezone_mismatch');
  end if;

  insert into public.offer_versions (
    restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
    capacity_timezone, capacity_window_kind, capacity_max_redemptions,
    boost_session_minutes, published_by
  ) values (
    draft.restaurant_id, draft.timezone, draft.valid_from, draft.valid_until,
    draft.tiers, draft.boosts, draft.exclusions, draft.capacity_timezone,
    draft.capacity_window_kind, draft.capacity_max_redemptions,
    draft.boost_session_minutes, p_actor_user_id
  )
  returning id into version_id;

  update public.restaurants
  set current_offer_version_id = version_id
  where id = draft.restaurant_id;

  insert into public.admin_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_user_id, 'offer.publish', 'offer_version', version_id::text,
    jsonb_build_object('restaurant_id', draft.restaurant_id)
  );

  return jsonb_build_object('published', true, 'version_id', version_id);
end;
$$;

create or replace function public.activate_restaurant(
  p_restaurant_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  actor_role text;
  current_status text;
  version_id uuid;
  v_now timestamptz := now();
begin
  select role into actor_role
  from public.user_profiles
  where id = p_actor_user_id;
  if actor_role is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  select status, current_offer_version_id
    into current_status, version_id
  from public.restaurants
  where id = p_restaurant_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'missing_restaurant');
  end if;
  if current_status is distinct from 'paused' or version_id is null
     or not public.version_selection_ok(version_id, v_now) then
    return jsonb_build_object('ok', false, 'error', 'not_activatable');
  end if;

  update public.restaurants set status = 'active' where id = p_restaurant_id;
  insert into public.admin_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_user_id, 'restaurant.activate', 'restaurant', p_restaurant_id::text,
    jsonb_build_object('offer_version_id', version_id)
  );
  return jsonb_build_object('ok', true, 'restaurant_id', p_restaurant_id);
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
  base_sum integer := 0;
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

create or replace function public.issue_challenge_redemption(
  p_user_id uuid,
  p_item_id uuid,
  p_token_hash text,
  p_encrypted_code text,
  p_code_iv text,
  p_expires_at timestamptz
)
returns table (
  outcome text,
  redemption_id uuid,
  challenge_item_id uuid,
  encrypted_code text,
  code_iv text,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
declare
  n integer;
  source public.challenge_items%rowtype;
  cycle public.challenge_cycles%rowtype;
  issued public.redemptions%rowtype;
  constraint_name text;
begin
  if p_user_id is null or p_item_id is null then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  select ci.* into source from public.challenge_items as ci where ci.id = p_item_id;
  get diagnostics n = row_count;
  if n is distinct from 1 then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  select cc.* into cycle from public.challenge_cycles as cc where cc.id = source.cycle_id for update;
  get diagnostics n = row_count;
  if n is distinct from 1 then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;
  if cycle.user_id is distinct from p_user_id then
    return query select 'forbidden'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  select ci.* into source from public.challenge_items as ci where ci.id = p_item_id for update;
  get diagnostics n = row_count;
  if n is distinct from 1 then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  if source.status = 'redeemed' then
    select rd.* into issued from public.redemptions as rd where rd.challenge_item_id = p_item_id;
    get diagnostics n = row_count;
    if n is distinct from 1 or issued.encrypted_code is null or issued.code_iv is null then
      return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
      return;
    end if;
    return query select 'existing'::text, issued.id, issued.challenge_item_id, issued.encrypted_code, issued.code_iv, issued.created_at;
    return;
  end if;

  if source.status is distinct from 'assigned' then
    return query select 'not_assigned'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  if source.redemption_deadline is not null then
    if now() >= source.redemption_deadline then
      return query select 'past_deadline'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
      return;
    end if;
    p_expires_at := source.redemption_deadline;
  end if;

  if p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_encrypted_code is null
     or length(p_encrypted_code) = 0
     or p_code_iv is null
     or length(p_code_iv) = 0
     or p_expires_at is null
     or p_expires_at <= now()
  then
    raise exception 'OPS-02: invalid redemption token payload';
  end if;

  begin
    insert into public.redemptions (
      user_id, restaurant_id, challenge_item_id, token_hash, encrypted_code, code_iv, status, expires_at
    ) values (
      p_user_id, source.restaurant_id, p_item_id, p_token_hash, p_encrypted_code, p_code_iv, 'issued', p_expires_at
    )
    returning * into issued;
  exception
    when unique_violation then
      get stacked diagnostics constraint_name = constraint_name;
      if constraint_name = 'redemptions_token_hash_key' then
        return query select 'token_collision'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
        return;
      elsif constraint_name = 'redemptions_challenge_item_id_key' then
        select rd.* into issued from public.redemptions as rd where rd.challenge_item_id = p_item_id;
        update public.challenge_items as ci set status = 'redeemed'
        where ci.id = p_item_id and ci.status = 'assigned';
        return query select 'existing'::text, issued.id, issued.challenge_item_id, issued.encrypted_code, issued.code_iv, issued.created_at;
        return;
      else
        raise;
      end if;
  end;

  update public.challenge_items as ci
  set status = 'redeemed'
  where ci.id = p_item_id and ci.status = 'assigned';
  get diagnostics n = row_count;
  if n is distinct from 1 then
    raise exception 'OPS-02: redemption item update expected 1 row, got %', n;
  end if;

  return query select 'created'::text, issued.id, issued.challenge_item_id, issued.encrypted_code, issued.code_iv, issued.created_at;
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
  if found and item.offer_version_id is not null then
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
  return next claimed;
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

revoke all on function public.swap_challenge_item(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.swap_challenge_item(uuid, uuid, uuid) to service_role;

revoke all on function public.chicago_month_start(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.offer_lowest_tier_cents(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.restaurant_base_cents(uuid) from public, anon, authenticated, service_role;
revoke all on function public.version_selection_ok(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.reserve_version_buckets(uuid, uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.publish_offer_version(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.activate_restaurant(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.generate_challenge_cycle(uuid, date, uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.expire_version_bound_assignment(uuid) from public, anon, authenticated, service_role;
revoke all on function public.verify_redemption_and_settle(text, uuid) from public, anon, authenticated, service_role;

grant execute on function public.publish_offer_version(uuid, uuid) to service_role;
grant execute on function public.activate_restaurant(uuid, uuid) to service_role;
grant execute on function public.generate_challenge_cycle(uuid, date, uuid, uuid[]) to service_role;
grant execute on function public.expire_version_bound_assignment(uuid) to service_role;
grant execute on function public.verify_redemption_and_settle(text, uuid) to service_role;
