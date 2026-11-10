-- E07-A3 member geolocation check-in.
-- Applied to hosted as 20261108045959 on 2026-11-09. Do not run supabase db push for this file.
-- E07_ARRIVAL_SESSIONS_ENABLED stays unset.
-- Partner open_boost_arrival_session is unchanged and still requires a token hash.
-- created_by_user_id uses on delete restrict: boost_quotes and bill_scan_proposals
-- already restrict-delete the session, so cascade or set null cannot clear a member row.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.boost_arrival_sessions
  add column created_by_user_id uuid,
  add column check_in_method text not null default 'partner';

alter table public.boost_arrival_sessions
  alter column created_by_token_hash drop not null;

alter table public.boost_arrival_sessions
  add constraint boost_arrival_sessions_created_by_user_id_fkey
    foreign key (created_by_user_id)
    references public.user_profiles (id)
    on delete restrict,
  add constraint boost_arrival_sessions_check_in_method_check
    check (check_in_method in ('partner', 'member_geo')),
  add constraint boost_arrival_sessions_creator_check
    check (
      (
        check_in_method = 'partner'
        and created_by_token_hash is not null
        and created_by_user_id is null
      )
      or (
        check_in_method = 'member_geo'
        and created_by_token_hash is null
        and created_by_user_id is not null
      )
    );

create index boost_arrival_sessions_created_by_user_id
  on public.boost_arrival_sessions (created_by_user_id)
  where created_by_user_id is not null;

create or replace function public.boost_arrival_sessions_scope()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  item_restaurant uuid;
  item_version uuid;
begin
  select ci.restaurant_id, ci.offer_version_id
    into item_restaurant, item_version
  from public.challenge_items ci
  where ci.id = new.challenge_item_id;

  if item_restaurant is null or item_restaurant is distinct from new.restaurant_id then
    raise exception 'boost arrival restaurant mismatch' using errcode = '23514';
  end if;
  if item_version is null or item_version is distinct from new.offer_version_id then
    raise exception 'boost arrival version mismatch' using errcode = '23514';
  end if;
  if new.redemption_id is not null and not exists (
    select 1
    from public.redemptions r
    where r.id = new.redemption_id
      and r.challenge_item_id = new.challenge_item_id
      and r.restaurant_id = new.restaurant_id
  ) then
    raise exception 'boost arrival redemption mismatch' using errcode = '23514';
  end if;
  if new.check_in_method = 'member_geo' and (
    new.created_by_user_id is null
    or not exists (
      select 1
      from public.challenge_items ci
      join public.challenge_cycles cc on cc.id = ci.cycle_id
      where ci.id = new.challenge_item_id
        and cc.user_id = new.created_by_user_id
    )
  ) then
    raise exception 'boost arrival member mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Member auth stays in the server action. This insert is atomic and idempotent.
-- A second call with the same restaurant and key returns the existing session
-- and does not update expires_at, arrival_at, or locked_boost_id.
create or replace function public.open_member_boost_arrival_session(
  p_restaurant_id uuid,
  p_challenge_item_id uuid,
  p_offer_version_id uuid,
  p_redemption_id uuid,
  p_locked_boost_id text,
  p_arrival_at timestamptz,
  p_expires_at timestamptz,
  p_idempotency_key text,
  p_created_by_user_id uuid,
  p_tier_id text,
  p_base_discount_cents integer,
  p_boost_id text,
  p_boost_discount_cents integer,
  p_total_discount_cents integer,
  p_eligible_subtotal_cents integer,
  p_below_minimum boolean,
  p_reasons jsonb
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  existing_id uuid;
  item_restaurant uuid;
  item_version uuid;
  item_owner uuid;
  new_id uuid;
begin
  select ci.restaurant_id, ci.offer_version_id, cc.user_id
    into item_restaurant, item_version, item_owner
  from public.challenge_items ci
  join public.challenge_cycles cc on cc.id = ci.cycle_id
  where ci.id = p_challenge_item_id;

  if item_owner is null or item_owner is distinct from p_created_by_user_id then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if item_restaurant is null or item_restaurant is distinct from p_restaurant_id then
    return jsonb_build_object('status', 'restaurant_mismatch');
  end if;
  if item_version is null or item_version is distinct from p_offer_version_id then
    return jsonb_build_object('status', 'version_mismatch');
  end if;
  if p_redemption_id is not null and not exists (
    select 1
    from public.redemptions r
    where r.id = p_redemption_id
      and r.challenge_item_id = p_challenge_item_id
      and r.restaurant_id = p_restaurant_id
  ) then
    return jsonb_build_object('status', 'redemption_mismatch');
  end if;

  if p_expires_at <= p_arrival_at
     or p_created_by_user_id is null
     or char_length(p_idempotency_key) not between 1 and 200
     or p_base_discount_cents < 0
     or p_boost_discount_cents < 0
     or p_total_discount_cents < 0
     or p_eligible_subtotal_cents < 0
     or p_base_discount_cents + p_boost_discount_cents is distinct from p_total_discount_cents
     or p_total_discount_cents > p_eligible_subtotal_cents
     or jsonb_typeof(p_reasons) is distinct from 'array' then
    return jsonb_build_object('status', 'invalid_quote');
  end if;

  select s.id into existing_id
  from public.boost_arrival_sessions s
  where s.restaurant_id = p_restaurant_id
    and s.idempotency_key = p_idempotency_key;
  if existing_id is not null then
    return jsonb_build_object('status', 'existing', 'session_id', existing_id);
  end if;

  if exists (
    select 1
    from public.boost_arrival_sessions s
    where s.challenge_item_id = p_challenge_item_id
      and s.status = 'open'
  ) then
    return jsonb_build_object('status', 'session_open');
  end if;

  begin
    insert into public.boost_arrival_sessions (
      restaurant_id, challenge_item_id, offer_version_id, redemption_id,
      locked_boost_id, arrival_at, expires_at, idempotency_key,
      created_by_token_hash, created_by_user_id, check_in_method
    ) values (
      p_restaurant_id, p_challenge_item_id, p_offer_version_id, p_redemption_id,
      p_locked_boost_id, p_arrival_at, p_expires_at, p_idempotency_key,
      null, p_created_by_user_id, 'member_geo'
    )
    returning id into new_id;

    insert into public.boost_quotes (
      session_id, quote_version, offer_version_id, tier_id,
      base_discount_cents, boost_id, boost_discount_cents, total_discount_cents,
      eligible_subtotal_cents, below_minimum, reasons, expires_at
    ) values (
      new_id, 1, p_offer_version_id, p_tier_id,
      p_base_discount_cents, p_boost_id, p_boost_discount_cents, p_total_discount_cents,
      p_eligible_subtotal_cents, p_below_minimum, p_reasons, p_expires_at
    );

    return jsonb_build_object('status', 'created', 'session_id', new_id);
  exception
    when unique_violation then
      select s.id into existing_id
      from public.boost_arrival_sessions s
      where s.restaurant_id = p_restaurant_id
        and s.idempotency_key = p_idempotency_key;
      if existing_id is not null then
        return jsonb_build_object('status', 'existing', 'session_id', existing_id);
      end if;
      return jsonb_build_object('status', 'session_open');
    when foreign_key_violation then
      return jsonb_build_object('status', 'forbidden');
  end;
end;
$$;

revoke all on function public.open_member_boost_arrival_session(
  uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, text, uuid,
  text, integer, text, integer, integer, integer, boolean, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.open_member_boost_arrival_session(
  uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, text, uuid,
  text, integer, text, integer, integer, integer, boolean, jsonb
) to service_role;

comment on table public.boost_arrival_sessions is
  'Check-in for one assigned bound challenge item. Partner rows keep created_by_token_hash. Member rows use created_by_user_id and check_in_method member_geo. Not a redemption. expires_at is written once. Service role only; no member read.';
