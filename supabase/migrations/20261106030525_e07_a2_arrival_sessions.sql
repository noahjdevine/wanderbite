-- E07-A2 partner arrival sessions and append-only Boost quotes.
-- NOT applied to hosted. Do not run supabase db push for this file in this PR.
-- E07_ARRIVAL_SESSIONS_ENABLED stays unset. No member or partner page reads these tables.
-- Does not change verify_redemption or the 15-minute redemption code TTL.
-- Arrival does not require a live redemption code. redemption_id is an optional link.
-- expires_at is written once. A retry of (restaurant_id, idempotency_key) does not update it.
-- One open session per challenge_item_id. Quotes are append-only; the active row has
-- superseded_at null. Stored parts sum to total_discount_cents (Boost reduced first).

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.boost_arrival_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete restrict,
  challenge_item_id uuid not null references public.challenge_items (id) on delete restrict,
  offer_version_id uuid not null,
  redemption_id uuid references public.redemptions (id) on delete restrict,
  locked_boost_id text,
  arrival_at timestamptz not null,
  expires_at timestamptz not null,
  idempotency_key text not null,
  created_by_token_hash text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  constraint boost_arrival_sessions_version_restaurant_fkey
    foreign key (offer_version_id, restaurant_id)
    references public.offer_versions (id, restaurant_id)
    on delete restrict,
  constraint boost_arrival_sessions_status_check
    check (status in ('open', 'closed')),
  constraint boost_arrival_sessions_expiry_check
    check (expires_at > arrival_at),
  constraint boost_arrival_sessions_idempotency_key_check
    check (char_length(idempotency_key) between 1 and 200),
  constraint boost_arrival_sessions_token_hash_check
    check (created_by_token_hash ~ '^[0-9a-f]{64}$'),
  constraint boost_arrival_sessions_locked_boost_check
    check (locked_boost_id is null or char_length(locked_boost_id) between 1 and 80),
  constraint boost_arrival_sessions_restaurant_idempotency_key
    unique (restaurant_id, idempotency_key)
);

create unique index boost_arrival_sessions_one_open_challenge_item
  on public.boost_arrival_sessions (challenge_item_id)
  where status = 'open';

create table public.boost_quotes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.boost_arrival_sessions (id) on delete restrict,
  quote_version integer not null,
  offer_version_id uuid not null references public.offer_versions (id) on delete restrict,
  tier_id text,
  base_discount_cents integer not null,
  boost_id text,
  boost_discount_cents integer not null,
  total_discount_cents integer not null,
  eligible_subtotal_cents integer not null,
  below_minimum boolean not null,
  reasons jsonb not null,
  expires_at timestamptz not null,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint boost_quotes_session_version_key unique (session_id, quote_version),
  constraint boost_quotes_version_check check (quote_version >= 1),
  constraint boost_quotes_reasons_array check (jsonb_typeof(reasons) = 'array'),
  constraint boost_quotes_tier_check
    check (tier_id is null or char_length(tier_id) between 1 and 80),
  constraint boost_quotes_boost_check
    check (boost_id is null or char_length(boost_id) between 1 and 80),
  constraint boost_quotes_parts_sum check (
    base_discount_cents >= 0
    and boost_discount_cents >= 0
    and total_discount_cents >= 0
    and eligible_subtotal_cents >= 0
    and base_discount_cents + boost_discount_cents = total_discount_cents
    and total_discount_cents <= eligible_subtotal_cents
  )
);

create unique index boost_quotes_one_active
  on public.boost_quotes (session_id)
  where superseded_at is null;

alter table public.boost_arrival_sessions enable row level security;
alter table public.boost_quotes enable row level security;

revoke all on table public.boost_arrival_sessions
  from public, anon, authenticated, service_role;
revoke all on table public.boost_quotes
  from public, anon, authenticated, service_role;

grant select, insert on table public.boost_arrival_sessions to service_role;
grant select, insert, update on table public.boost_quotes to service_role;

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
  return new;
end;
$$;

create trigger boost_arrival_sessions_scope
  before insert or update on public.boost_arrival_sessions
  for each row execute function public.boost_arrival_sessions_scope();

create or replace function public.boost_quotes_match_session()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  sess public.boost_arrival_sessions%rowtype;
begin
  select * into sess
  from public.boost_arrival_sessions
  where id = new.session_id;
  if not found then
    raise exception 'boost quote session missing' using errcode = '23514';
  end if;
  if new.expires_at is distinct from sess.expires_at
     or new.offer_version_id is distinct from sess.offer_version_id then
    raise exception 'boost quote must copy the session expiry and version'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if old.superseded_at is not null then
      raise exception 'boost quote is already superseded' using errcode = '23514';
    end if;
    if new.superseded_at is null then
      raise exception 'boost quote supersede requires superseded_at' using errcode = '23514';
    end if;
    if new.id is distinct from old.id
       or new.session_id is distinct from old.session_id
       or new.quote_version is distinct from old.quote_version
       or new.offer_version_id is distinct from old.offer_version_id
       or new.tier_id is distinct from old.tier_id
       or new.base_discount_cents is distinct from old.base_discount_cents
       or new.boost_id is distinct from old.boost_id
       or new.boost_discount_cents is distinct from old.boost_discount_cents
       or new.total_discount_cents is distinct from old.total_discount_cents
       or new.eligible_subtotal_cents is distinct from old.eligible_subtotal_cents
       or new.below_minimum is distinct from old.below_minimum
       or new.reasons is distinct from old.reasons
       or new.expires_at is distinct from old.expires_at
       or new.created_at is distinct from old.created_at then
      raise exception 'boost quote columns are append-only' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger boost_quotes_match_session
  before insert or update on public.boost_quotes
  for each row execute function public.boost_quotes_match_session();

-- Partner auth stays in the server action. This insert is atomic and idempotent.
-- A second call with the same restaurant and key returns the existing session
-- and does not update expires_at, arrival_at, or locked_boost_id.
create or replace function public.open_boost_arrival_session(
  p_restaurant_id uuid,
  p_challenge_item_id uuid,
  p_offer_version_id uuid,
  p_redemption_id uuid,
  p_locked_boost_id text,
  p_arrival_at timestamptz,
  p_expires_at timestamptz,
  p_idempotency_key text,
  p_created_by_token_hash text,
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
  new_id uuid;
begin
  select ci.restaurant_id, ci.offer_version_id
    into item_restaurant, item_version
  from public.challenge_items ci
  where ci.id = p_challenge_item_id;

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
     or p_created_by_token_hash !~ '^[0-9a-f]{64}$'
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
      locked_boost_id, arrival_at, expires_at, idempotency_key, created_by_token_hash
    ) values (
      p_restaurant_id, p_challenge_item_id, p_offer_version_id, p_redemption_id,
      p_locked_boost_id, p_arrival_at, p_expires_at, p_idempotency_key, p_created_by_token_hash
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
  end;
end;
$$;

-- Does not update the session. expires_at, arrival_at, and locked_boost_id stay put.
create or replace function public.supersede_boost_arrival_quote(
  p_session_id uuid,
  p_restaurant_id uuid,
  p_superseded_at timestamptz,
  p_quote_version integer,
  p_tier_id text,
  p_base_discount_cents integer,
  p_boost_id text,
  p_boost_discount_cents integer,
  p_total_discount_cents integer,
  p_eligible_subtotal_cents integer,
  p_below_minimum boolean,
  p_reasons jsonb,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  sess public.boost_arrival_sessions%rowtype;
  prev public.boost_quotes%rowtype;
begin
  select * into sess
  from public.boost_arrival_sessions
  where id = p_session_id
    and restaurant_id = p_restaurant_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if sess.status <> 'open' then
    return jsonb_build_object('status', 'session_closed');
  end if;
  if p_expires_at is distinct from sess.expires_at then
    return jsonb_build_object('status', 'expiry_mismatch');
  end if;
  if p_base_discount_cents < 0
     or p_boost_discount_cents < 0
     or p_total_discount_cents < 0
     or p_eligible_subtotal_cents < 0
     or p_base_discount_cents + p_boost_discount_cents is distinct from p_total_discount_cents
     or p_total_discount_cents > p_eligible_subtotal_cents
     or jsonb_typeof(p_reasons) is distinct from 'array' then
    return jsonb_build_object('status', 'invalid_quote');
  end if;

  select * into prev
  from public.boost_quotes
  where session_id = sess.id
    and superseded_at is null
  for update;
  if not found then
    return jsonb_build_object('status', 'no_active_quote');
  end if;
  if p_quote_version is distinct from prev.quote_version + 1 then
    return jsonb_build_object('status', 'conflict');
  end if;

  update public.boost_quotes
  set superseded_at = p_superseded_at
  where id = prev.id;

  insert into public.boost_quotes (
    session_id, quote_version, offer_version_id, tier_id,
    base_discount_cents, boost_id, boost_discount_cents, total_discount_cents,
    eligible_subtotal_cents, below_minimum, reasons, expires_at
  ) values (
    sess.id, p_quote_version, sess.offer_version_id, p_tier_id,
    p_base_discount_cents, p_boost_id, p_boost_discount_cents, p_total_discount_cents,
    p_eligible_subtotal_cents, p_below_minimum, p_reasons, sess.expires_at
  );

  return jsonb_build_object('status', 'created');
end;
$$;

revoke all on function public.boost_arrival_sessions_scope()
  from public, anon, authenticated, service_role;
revoke all on function public.boost_quotes_match_session()
  from public, anon, authenticated, service_role;
revoke all on function public.open_boost_arrival_session(
  uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, text, text,
  text, integer, text, integer, integer, integer, boolean, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.supersede_boost_arrival_quote(
  uuid, uuid, timestamptz, integer, text, integer, text, integer, integer, integer, boolean, jsonb, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.open_boost_arrival_session(
  uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, text, text,
  text, integer, text, integer, integer, integer, boolean, jsonb
) to service_role;
grant execute on function public.supersede_boost_arrival_quote(
  uuid, uuid, timestamptz, integer, text, integer, text, integer, integer, integer, boolean, jsonb, timestamptz
) to service_role;

comment on table public.boost_arrival_sessions is
  'Partner check-in for one assigned bound challenge item. Not a redemption. expires_at is written once. Service role only; no member read.';
comment on table public.boost_quotes is
  'Append-only Boost quotes for an arrival session. Active row has superseded_at null. Parts sum to the capped total.';
