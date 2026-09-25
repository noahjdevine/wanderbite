-- E01: sealed offer versions and drafts. Does not rewrite older migrations.
-- Publish and withdraw are service-role functions. The app does not call them.
-- Assignment does not write challenge_items.offer_version_id.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.offer_drafts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null unique references public.restaurants (id) on delete restrict,
  timezone text,
  valid_from timestamptz,
  valid_until timestamptz,
  tiers jsonb not null default '[]'::jsonb,
  boosts jsonb not null default '[]'::jsonb,
  exclusions jsonb not null default '{"exclude_tax":true,"exclude_tip":true,"categories":[]}'::jsonb,
  capacity_timezone text,
  capacity_window_kind text,
  capacity_max_redemptions integer,
  boost_session_minutes integer,
  updated_at timestamptz not null default now()
);

create table public.offer_versions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete restrict,
  timezone text not null,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  tiers jsonb not null,
  boosts jsonb not null,
  exclusions jsonb not null,
  capacity_timezone text not null,
  capacity_window_kind text not null,
  capacity_max_redemptions integer not null,
  boost_session_minutes integer,
  withdrawn_from_selection_at timestamptz,
  published_at timestamptz not null default now(),
  published_by uuid,
  unique (id, restaurant_id),
  constraint offer_versions_window_kind check (capacity_window_kind = 'calendar_month'),
  constraint offer_versions_capacity_positive check (capacity_max_redemptions > 0),
  constraint offer_versions_valid_range check (valid_until > valid_from)
);

alter table public.restaurants
  add column current_offer_version_id uuid;

alter table public.restaurants
  add constraint restaurants_current_offer_version_fkey
  foreign key (current_offer_version_id, id)
  references public.offer_versions (id, restaurant_id)
  on delete restrict;

create index restaurants_current_offer_version_id_idx
  on public.restaurants (current_offer_version_id);

alter table public.challenge_items
  add column offer_version_id uuid;

alter table public.challenge_items
  add constraint challenge_items_offer_version_fkey
  foreign key (offer_version_id, restaurant_id)
  references public.offer_versions (id, restaurant_id)
  on delete restrict;

create index challenge_items_offer_version_id_idx
  on public.challenge_items (offer_version_id);

alter table public.offer_drafts enable row level security;
alter table public.offer_versions enable row level security;

revoke all on table public.offer_drafts from public, anon, authenticated, service_role;
revoke all on table public.offer_versions from public, anon, authenticated, service_role;

grant select, insert, update on table public.offer_drafts to service_role;
grant select on table public.offer_versions to service_role;

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

create or replace function public.seal_offer_version()
returns trigger
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
begin
  if current_setting('wanderbite.offer_withdraw', true) = 'on'
     and old.withdrawn_from_selection_at is null
     and new.withdrawn_from_selection_at is not null
     and new.id is not distinct from old.id
     and new.restaurant_id is not distinct from old.restaurant_id
     and new.timezone is not distinct from old.timezone
     and new.valid_from is not distinct from old.valid_from
     and new.valid_until is not distinct from old.valid_until
     and new.tiers is not distinct from old.tiers
     and new.boosts is not distinct from old.boosts
     and new.exclusions is not distinct from old.exclusions
     and new.capacity_timezone is not distinct from old.capacity_timezone
     and new.capacity_window_kind is not distinct from old.capacity_window_kind
     and new.capacity_max_redemptions is not distinct from old.capacity_max_redemptions
     and new.boost_session_minutes is not distinct from old.boost_session_minutes
     and new.published_at is not distinct from old.published_at
     and new.published_by is not distinct from old.published_by
  then
    return new;
  end if;
  raise exception 'offer version is sealed';
end;
$$;

create trigger offer_versions_seal
  before update on public.offer_versions
  for each row execute function public.seal_offer_version();

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
    draft.tiers,
    draft.boosts,
    draft.timezone,
    draft.valid_from,
    draft.valid_until,
    draft.capacity_timezone,
    draft.capacity_window_kind,
    draft.capacity_max_redemptions
  );
  if problem is not null then
    return jsonb_build_object('published', false, 'error', problem);
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
    p_actor_user_id,
    'offer.publish',
    'offer_version',
    version_id::text,
    jsonb_build_object('restaurant_id', draft.restaurant_id)
  );

  return jsonb_build_object('published', true, 'version_id', version_id);
end;
$$;

create or replace function public.withdraw_offer_version(
  p_version_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  actor_role text;
  version_restaurant uuid;
begin
  select role into actor_role
  from public.user_profiles
  where id = p_actor_user_id;
  if actor_role is distinct from 'admin' then
    return jsonb_build_object('withdrawn', false, 'error', 'not_admin');
  end if;

  select restaurant_id into version_restaurant
  from public.offer_versions
  where id = p_version_id
  for update;
  if not found then
    return jsonb_build_object('withdrawn', false, 'error', 'missing_version');
  end if;

  perform set_config('wanderbite.offer_withdraw', 'on', true);

  update public.offer_versions
  set withdrawn_from_selection_at = now()
  where id = p_version_id
    and withdrawn_from_selection_at is null;

  update public.restaurants
  set current_offer_version_id = null
  where id = version_restaurant
    and current_offer_version_id = p_version_id;

  insert into public.admin_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_user_id,
    'offer.withdraw',
    'offer_version',
    p_version_id::text,
    jsonb_build_object('restaurant_id', version_restaurant)
  );

  return jsonb_build_object('withdrawn', true, 'version_id', p_version_id);
end;
$$;

create or replace function public.retire_restaurant(
  p_restaurant_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  actor_role text;
  v_org_id uuid;
  version_count integer;
  item_count integer;
  sibling_count integer;
begin
  select role into actor_role
  from public.user_profiles
  where id = p_actor_user_id;
  if actor_role is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  select r.org_id into v_org_id
  from public.restaurants as r
  where r.id = p_restaurant_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'missing_restaurant');
  end if;

  select count(*) into version_count
  from public.offer_versions
  where restaurant_id = p_restaurant_id;
  select count(*) into item_count
  from public.challenge_items
  where restaurant_id = p_restaurant_id;

  if version_count > 0 or item_count > 0 then
    update public.restaurants
    set status = 'paused'
    where id = p_restaurant_id;
    insert into public.admin_audit_log (actor_user_id, action, target_type, target_id)
    values (p_actor_user_id, 'restaurant.deactivate', 'restaurant', p_restaurant_id::text);
    return jsonb_build_object('ok', true, 'result', 'paused');
  end if;

  delete from public.restaurant_offers where restaurant_id = p_restaurant_id;
  delete from public.offer_drafts where restaurant_id = p_restaurant_id;
  delete from public.restaurants where id = p_restaurant_id;

  select count(*) into sibling_count
  from public.restaurants as r
  where r.org_id = v_org_id;
  if sibling_count = 0 and v_org_id is not null then
    delete from public.restaurant_orgs where id = v_org_id;
  end if;

  insert into public.admin_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_user_id,
    'restaurant.delete',
    'restaurant',
    p_restaurant_id::text,
    jsonb_build_object('org_id', v_org_id)
  );

  return jsonb_build_object('ok', true, 'result', 'deleted');
end;
$$;

revoke all on function public.offer_version_terms_ok(jsonb, jsonb, text, timestamptz, timestamptz, text, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.seal_offer_version()
  from public, anon, authenticated, service_role;
revoke all on function public.publish_offer_version(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.withdraw_offer_version(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.retire_restaurant(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.publish_offer_version(uuid, uuid) to service_role;
grant execute on function public.withdraw_offer_version(uuid, uuid) to service_role;
grant execute on function public.retire_restaurant(uuid, uuid) to service_role;
