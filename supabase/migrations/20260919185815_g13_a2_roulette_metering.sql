-- G13-A2: guest-transfer lock order + in-flight target rewrite, stale
-- recovery, feature-specific fair-use, bounded result_payload, ops headroom.
-- Forward-only. Does not rewrite the G13-A1 migration.

-- ---------------------------------------------------------------------------
-- Persist bounded replay payload on the request row
-- ---------------------------------------------------------------------------
alter table public.ai_requests
  add column result_payload jsonb;

alter table public.ai_requests
  add constraint ai_requests_result_payload_bound check (
    result_payload is null
    or (
      jsonb_typeof(result_payload) = 'object'
      and octet_length(result_payload::text) <= 16384
    )
  );

-- ---------------------------------------------------------------------------
-- Rewrite guest_session targets onto the destination account (no turn flag)
-- ---------------------------------------------------------------------------
create or replace function public.ai_map_guest_targets_to_account(
  p_targets jsonb,
  p_user_id uuid,
  p_period_key text,
  p_account_cap bigint
)
returns jsonb
language sql
immutable
set search_path to pg_catalog, public
as $$
  select coalesce(
    (
      select jsonb_agg(
        case
          when elem->>'k' = 'guest_session' then jsonb_build_object(
            'k', 'account',
            'b', p_user_id::text,
            'p', p_period_key,
            'cap', p_account_cap,
            'c', true,
            'plat', true,
            't', false
          )
          else elem
        end
        order by ordinality
      )
      from jsonb_array_elements(coalesce(p_targets, '[]'::jsonb))
        with ordinality as t(elem, ordinality)
    ),
    '[]'::jsonb
  );
$$;

-- ---------------------------------------------------------------------------
-- Transfer: lock in-flight request rows by id first, then buckets, then
-- rewrite guest_session targets and move customer balances.
-- ---------------------------------------------------------------------------
create or replace function public.ai_transfer_guest_to_account(
  p_guest_id text,
  p_user_id uuid
)
returns table (
  already_claimed boolean,
  guest_id text,
  transferred_customer_microdollars bigint,
  user_id uuid
)
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  v_cfg public.ai_budget_config_versions;
  v_month text;
  v_guest public.ai_bucket_balances;
  v_amount bigint;
  v_turns integer;
  v_tier text;
  v_sub text;
  v_inserted boolean := false;
  v_account_cap bigint;
  v_lock jsonb := '[]'::jsonb;
  v_req public.ai_requests;
  v_x jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_guest_id, 1));

  select * into v_cfg
  from public.ai_budget_config_versions
  order by published_at desc, id desc
  limit 1;
  v_month := public.ai_chicago_month(now(), v_cfg.timezone);

  select subscription_status into v_sub
  from public.user_profiles
  where id = p_user_id;
  if not found then
    raise exception 'unknown user' using errcode = '22023';
  end if;
  v_tier := case when v_sub = 'active' then 'paid' else 'free' end;
  v_account_cap := case when v_tier = 'paid'
    then v_cfg.paid_account_ceiling_microdollars
    else v_cfg.free_account_ceiling_microdollars end;

  insert into public.ai_guest_transfers (
    guest_id, user_id, period_key, transferred_customer_microdollars, transferred_turns
  )
  values (p_guest_id, p_user_id, v_month, 0, 0)
  on conflict on constraint ai_guest_transfers_pkey do nothing
  returning true into v_inserted;

  if v_inserted is not true then
    return query
      select true, t.guest_id, t.transferred_customer_microdollars, t.user_id
      from public.ai_guest_transfers t
      where t.guest_id = p_guest_id;
    return;
  end if;

  -- Request rows first (same order as settle: request id, then buckets).
  for v_req in
    select *
    from public.ai_requests req
    where req.guest_id = p_guest_id
      and req.user_id is null
      and req.status in ('reserved', 'dispatched')
    order by req.id
    for update
  loop
    for v_x in
      select value from jsonb_array_elements(coalesce(v_req.bucket_targets, '[]'::jsonb))
    loop
      v_lock := v_lock || jsonb_build_array(jsonb_build_object(
        'k', v_x->>'k', 'b', v_x->>'b', 'p', v_x->>'p'
      ));
    end loop;
  end loop;

  v_lock := v_lock
    || jsonb_build_array(jsonb_build_object(
         'k', 'guest_session', 'b', p_guest_id, 'p', 'open'
       ))
    || jsonb_build_array(jsonb_build_object(
         'k', 'account', 'b', p_user_id::text, 'p', v_month
       ));

  perform public.ai_lock_targets(v_lock);

  update public.ai_requests req
  set
    bucket_targets = public.ai_map_guest_targets_to_account(
      req.bucket_targets, p_user_id, v_month, v_account_cap
    ),
    user_id = p_user_id,
    account_tier = v_tier,
    updated_at = now()
  where req.guest_id = p_guest_id
    and req.user_id is null
    and req.status in ('reserved', 'dispatched');

  update public.ai_requests req
  set
    user_id = p_user_id,
    account_tier = v_tier,
    updated_at = now()
  where req.guest_id = p_guest_id
    and req.user_id is null;

  select * into v_guest
  from public.ai_bucket_balances
  where bucket_kind = 'guest_session'
    and bucket_key = p_guest_id
    and period_key = 'open';
  if v_guest.bucket_kind is null then
    v_guest := public.ai_lock_bucket('guest_session', p_guest_id, 'open');
  end if;

  v_amount := v_guest.customer_reserved + v_guest.customer_consumed;
  v_turns := v_guest.turns_reserved + v_guest.turns_consumed;

  perform public.ai_apply_bucket_delta(
    v_guest.customer_consumed,
    v_guest.customer_reserved,
    'account', p_user_id::text, v_month,
    v_guest.platform_consumed,
    v_guest.platform_reserved,
    0, 0
  );
  perform public.ai_apply_bucket_delta(
    -v_guest.customer_consumed,
    -v_guest.customer_reserved,
    'guest_session', p_guest_id, 'open',
    -v_guest.platform_consumed,
    -v_guest.platform_reserved,
    0, 0
  );

  update public.ai_guest_transfers t
  set
    transferred_customer_microdollars = v_amount,
    transferred_turns = v_turns
  where t.guest_id = p_guest_id;

  return query
    select false, p_guest_id, v_amount, p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Stale recovery: reserved → fail_before_dispatch;
-- dispatched → assumed_spent then customer release. SKIP LOCKED.
-- ---------------------------------------------------------------------------
create or replace function public.ai_recover_stale_requests(
  p_stale_before timestamptz,
  p_limit integer default 25
)
returns table (
  previous_status text,
  request_id uuid,
  status text
)
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  v_limit integer;
  v_req public.ai_requests;
  v_prev text;
begin
  if p_stale_before is null then
    raise exception 'stale cutoff required' using errcode = '22023';
  end if;
  v_limit := greatest(1, least(coalesce(p_limit, 25), 100));

  for v_req in
    select *
    from public.ai_requests req
    where req.status in ('reserved', 'dispatched')
      and req.updated_at < p_stale_before
    order by req.updated_at, req.id
    limit v_limit
    for update skip locked
  loop
    v_prev := v_req.status;
    if v_req.status = 'reserved' then
      perform public.ai_fail_before_dispatch(v_req.id);
    else
      perform public.ai_mark_assumed_spent(v_req.id);
      perform public.ai_release_customer_allowance(v_req.id);
    end if;
    return query
      select v_prev, r.id, r.status
      from public.ai_requests r
      where r.id = v_req.id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bounded idempotent payload for HTTP replay (never a second provider call)
-- ---------------------------------------------------------------------------
create or replace function public.ai_store_result_payload(
  p_request_id uuid,
  p_payload jsonb
)
returns table (
  request_id uuid,
  result_payload jsonb,
  status text,
  stored boolean
)
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  r public.ai_requests;
begin
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 16384 then
    raise exception 'result_payload must be a bounded JSON object'
      using errcode = '22023';
  end if;

  select * into r from public.ai_requests where id = p_request_id for update;
  if r.id is null then
    raise exception 'unknown request' using errcode = '22023';
  end if;
  if r.result_payload is not null then
    return query select r.id, r.result_payload, r.status, false;
    return;
  end if;

  update public.ai_requests req
  set result_payload = p_payload, updated_at = now()
  where req.id = r.id;

  return query
    select req.id, req.result_payload, req.status, true
    from public.ai_requests req
    where req.id = r.id;
end;
$$;

create or replace function public.ai_load_result_payload(p_request_id uuid)
returns table (
  deny_reason text,
  request_id uuid,
  result_payload jsonb,
  status text
)
language plpgsql
stable
security definer
set search_path to pg_catalog, public
as $$
begin
  return query
    select req.deny_reason, req.id, req.result_payload, req.status
    from public.ai_requests req
    where req.id = p_request_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fair-use: optional vs account meter; guests have open lifetime (no reset date)
-- ---------------------------------------------------------------------------
drop function if exists public.ai_fair_use_state(timestamptz, text, uuid);

create or replace function public.ai_fair_use_state(
  p_as_of timestamptz default now(),
  p_guest_id text default null,
  p_user_id uuid default null,
  p_feature_class text default null
)
returns table (
  guest_turns_remaining integer,
  resets_on date,
  status text
)
language plpgsql
stable
security definer
set search_path to pg_catalog, public
as $$
declare
  v_cfg public.ai_budget_config_versions;
  v_month text;
  v_cap bigint;
  v_used bigint := 0;
  v_turns_used integer := 0;
  v_sub text;
  v_status text;
  v_reset date := null;
  v_remaining integer := null;
  v_kind text;
  v_key text;
  v_period text;
begin
  select * into v_cfg
  from public.ai_budget_config_versions
  order by published_at desc, id desc
  limit 1;
  v_month := public.ai_chicago_month(p_as_of, v_cfg.timezone);

  if p_user_id is not null then
    select subscription_status into v_sub from public.user_profiles where id = p_user_id;
    v_reset := (
      date_trunc('month', (p_as_of at time zone v_cfg.timezone))
        + interval '1 month'
    )::date;
    if p_feature_class = 'optional' and v_sub = 'active' then
      v_kind := 'account_optional';
      v_key := p_user_id::text;
      v_period := v_month;
      v_cap := v_cfg.paid_optional_microdollars;
    elsif p_feature_class = 'protected_core' and v_sub = 'active' then
      v_kind := 'account_protected';
      v_key := p_user_id::text;
      v_period := v_month;
      v_cap := v_cfg.paid_protected_microdollars;
    else
      v_kind := 'account';
      v_key := p_user_id::text;
      v_period := v_month;
      v_cap := case when v_sub = 'active'
        then v_cfg.paid_account_ceiling_microdollars
        else v_cfg.free_account_ceiling_microdollars end;
    end if;
    select coalesce(customer_reserved + customer_consumed, 0)
      into v_used
    from public.ai_bucket_balances
    where bucket_kind = v_kind and bucket_key = v_key and period_key = v_period;
  elsif p_guest_id is not null then
    v_cap := v_cfg.guest_session_ceiling_microdollars;
    v_reset := null;
    select
      coalesce(customer_reserved + customer_consumed, 0),
      coalesce(turns_reserved + turns_consumed, 0)
      into v_used, v_turns_used
    from public.ai_bucket_balances
    where bucket_kind = 'guest_session' and bucket_key = p_guest_id and period_key = 'open';
    v_remaining := greatest(v_cfg.guest_session_turn_limit - coalesce(v_turns_used, 0), 0);
  else
    raise exception 'fair use requires user_id or guest_id'
      using errcode = '22023';
  end if;

  v_used := coalesce(v_used, 0);
  if v_used >= v_cap or coalesce(v_remaining, 1) = 0 then
    v_status := 'exhausted';
  elsif v_used * 5 >= v_cap * 4 then
    v_status := 'near_limit';
  else
    v_status := 'ok';
  end if;

  return query select v_remaining, v_reset, v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ops headroom from current config + bucket balances (not request counts)
-- ---------------------------------------------------------------------------
create or replace function public.ai_ops_headroom(p_as_of timestamptz default now())
returns table (
  bucket_kind text,
  bucket_key text,
  cap_microdollars bigint,
  period_key text,
  remaining_microdollars bigint,
  used_platform_microdollars bigint
)
language plpgsql
stable
security definer
set search_path to pg_catalog, public
as $$
declare
  v_cfg public.ai_budget_config_versions;
  v_month text;
  v_day text;
begin
  select * into v_cfg
  from public.ai_budget_config_versions
  order by published_at desc, id desc
  limit 1;
  v_month := public.ai_chicago_month(p_as_of, v_cfg.timezone);
  v_day := public.ai_chicago_day(p_as_of, v_cfg.timezone);

  return query
  with specs as (
    select * from (values
      ('global'::text, 'platform'::text, v_month, v_cfg.platform_global_microdollars),
      ('maintenance', 'ops', v_month, v_cfg.maintenance_microdollars),
      ('guest_day', 'guest_pool', v_day, v_cfg.guest_day_pool_microdollars),
      ('guest_month', 'guest_pool', v_month, v_cfg.guest_month_pool_microdollars),
      ('global_core', 'platform', v_month, v_cfg.global_paid_core_reserve_microdollars)
    ) as s(bucket_kind, bucket_key, period_key, cap_microdollars)
  )
  select
    s.bucket_kind,
    s.bucket_key,
    s.cap_microdollars,
    s.period_key,
    greatest(s.cap_microdollars - coalesce(b.platform_reserved + b.platform_consumed, 0), 0),
    coalesce(b.platform_reserved + b.platform_consumed, 0)
  from specs s
  left join public.ai_bucket_balances b
    on b.bucket_kind = s.bucket_kind
   and b.bucket_key = s.bucket_key
   and b.period_key = s.period_key
  order by s.bucket_kind;
end;
$$;

revoke all on function public.ai_map_guest_targets_to_account(jsonb, uuid, text, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_recover_stale_requests(timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.ai_store_result_payload(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.ai_load_result_payload(uuid)
  from public, anon, authenticated;
revoke all on function public.ai_fair_use_state(timestamptz, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.ai_ops_headroom(timestamptz)
  from public, anon, authenticated;
revoke all on function public.ai_transfer_guest_to_account(text, uuid)
  from public, anon, authenticated;

grant execute on function public.ai_recover_stale_requests(timestamptz, integer)
  to service_role;
grant execute on function public.ai_store_result_payload(uuid, jsonb)
  to service_role;
grant execute on function public.ai_load_result_payload(uuid)
  to service_role;
grant execute on function public.ai_fair_use_state(timestamptz, text, uuid, text)
  to service_role;
grant execute on function public.ai_ops_headroom(timestamptz)
  to service_role;
grant execute on function public.ai_transfer_guest_to_account(text, uuid)
  to service_role;
