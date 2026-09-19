-- SEC-09 / G13-A1: AI price registry, reservations, and atomic budget RPCs.
-- Do not rewrite historical migrations. Rollback is unused tables if never pushed.
-- Let the migration runner own the transaction. Direct psql replay must use -1 -f.
-- SET LOCAL timeouts apply to this migration only; they are not RPC settings.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- Registry and ledgers
-- ---------------------------------------------------------------------------
create table public.ai_price_versions (
  id uuid primary key default gen_random_uuid(),
  notes text not null default '',
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.ai_price_rates (
  id uuid primary key default gen_random_uuid(),
  price_version_id uuid not null references public.ai_price_versions (id),
  provider text not null,
  model_id text not null,
  usage_kind text not null,
  microdollars_per_million bigint not null,
  created_at timestamptz not null default now(),
  constraint ai_price_rates_rate_nonneg check (microdollars_per_million >= 0),
  constraint ai_price_rates_kind_nonempty check (char_length(usage_kind) > 0),
  constraint ai_price_rates_unique unique (price_version_id, provider, model_id, usage_kind)
);

create table public.ai_budget_config_versions (
  id uuid primary key default gen_random_uuid(),
  timezone text not null,
  paid_account_ceiling_microdollars bigint not null,
  free_account_ceiling_microdollars bigint not null,
  paid_protected_microdollars bigint not null,
  paid_optional_microdollars bigint not null,
  guest_session_ceiling_microdollars bigint not null,
  guest_session_turn_limit integer not null,
  guest_voice_seconds_limit integer not null,
  guest_day_pool_microdollars bigint not null,
  guest_month_pool_microdollars bigint not null,
  platform_global_microdollars bigint not null,
  maintenance_microdollars bigint not null,
  global_paid_core_reserve_microdollars bigint not null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint ai_budget_config_tz check (timezone = 'America/Chicago'),
  constraint ai_budget_config_nonneg check (
    paid_account_ceiling_microdollars >= 0
    and free_account_ceiling_microdollars >= 0
    and paid_protected_microdollars >= 0
    and paid_optional_microdollars >= 0
    and guest_session_ceiling_microdollars >= 0
    and guest_session_turn_limit >= 0
    and guest_voice_seconds_limit >= 0
    and guest_day_pool_microdollars >= 0
    and guest_month_pool_microdollars >= 0
    and platform_global_microdollars >= 0
    and maintenance_microdollars >= 0
    and global_paid_core_reserve_microdollars >= 0
  ),
  constraint ai_budget_config_paid_split check (
    paid_protected_microdollars + paid_optional_microdollars
      = paid_account_ceiling_microdollars
  ),
  constraint ai_budget_config_reserve check (
    maintenance_microdollars + global_paid_core_reserve_microdollars
      <= platform_global_microdollars
  )
);

create table public.ai_bucket_balances (
  bucket_kind text not null,
  bucket_key text not null,
  period_key text not null,
  customer_reserved bigint not null default 0,
  customer_consumed bigint not null default 0,
  platform_reserved bigint not null default 0,
  platform_consumed bigint not null default 0,
  turns_reserved integer not null default 0,
  turns_consumed integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (bucket_kind, bucket_key, period_key),
  constraint ai_bucket_balances_nonneg check (
    customer_reserved >= 0
    and customer_consumed >= 0
    and platform_reserved >= 0
    and platform_consumed >= 0
    and turns_reserved >= 0
    and turns_consumed >= 0
  )
);

create table public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  status text not null,
  account_tier text not null,
  feature_class text not null,
  user_id uuid references public.user_profiles (id),
  guest_id text,
  provider text not null,
  model_id text not null,
  price_version_id uuid not null references public.ai_price_versions (id),
  config_version_id uuid not null references public.ai_budget_config_versions (id),
  period_key text not null,
  day_key text not null,
  as_of timestamptz not null,
  bind jsonb not null,
  bucket_targets jsonb not null default '[]'::jsonb,
  usage_units jsonb not null,
  usage_actual jsonb,
  quoted_microdollars bigint not null default 0,
  reserved_customer_microdollars bigint not null default 0,
  reserved_platform_microdollars bigint not null default 0,
  settled_customer_microdollars bigint not null default 0,
  settled_platform_microdollars bigint not null default 0,
  deny_reason text,
  dispatch_acquired_at timestamptz,
  customer_released_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_requests_idempotency unique (idempotency_key),
  constraint ai_requests_status check (
    status in (
      'denied',
      'reserved',
      'dispatched',
      'settled',
      'failed_before_dispatch',
      'assumed_spent'
    )
  ),
  constraint ai_requests_tier check (
    account_tier in ('paid', 'free', 'guest', 'ops')
  ),
  constraint ai_requests_class check (
    feature_class in ('protected_core', 'optional', 'maintenance', 'guest')
  ),
  constraint ai_requests_quoted_nonneg check (quoted_microdollars >= 0),
  constraint ai_requests_reserved_nonneg check (
    reserved_customer_microdollars >= 0
    and reserved_platform_microdollars >= 0
    and settled_customer_microdollars >= 0
    and settled_platform_microdollars >= 0
  )
);

create table public.ai_guest_transfers (
  guest_id text primary key,
  user_id uuid not null references public.user_profiles (id),
  period_key text not null,
  transferred_customer_microdollars bigint not null,
  transferred_turns integer not null default 0,
  transferred_at timestamptz not null default now(),
  constraint ai_guest_transfers_nonneg check (
    transferred_customer_microdollars >= 0
    and transferred_turns >= 0
  )
);

create index ai_requests_user_period_idx
  on public.ai_requests (user_id, period_key);
create index ai_requests_guest_period_idx
  on public.ai_requests (guest_id, period_key);
create index ai_requests_status_idx
  on public.ai_requests (status, created_at);

alter table public.ai_price_versions enable row level security;
alter table public.ai_price_rates enable row level security;
alter table public.ai_budget_config_versions enable row level security;
alter table public.ai_bucket_balances enable row level security;
alter table public.ai_requests enable row level security;
alter table public.ai_guest_transfers enable row level security;

create or replace function public.ai_forbid_registry_mutation()
returns trigger
language plpgsql
set search_path to pg_catalog, public
as $$
begin
  raise exception 'AI registry rows are immutable'
    using errcode = '55000';
end;
$$;

create trigger ai_price_versions_immutable
  before update or delete on public.ai_price_versions
  for each row execute function public.ai_forbid_registry_mutation();
create trigger ai_price_rates_immutable
  before update or delete on public.ai_price_rates
  for each row execute function public.ai_forbid_registry_mutation();
create trigger ai_budget_config_versions_immutable
  before update or delete on public.ai_budget_config_versions
  for each row execute function public.ai_forbid_registry_mutation();

-- ---------------------------------------------------------------------------
-- Integer ceiling math and quoting (rates live only in ai_price_rates)
-- ---------------------------------------------------------------------------
create or replace function public.ai_ceil_microdollars(
  p_units bigint,
  p_rate_per_million bigint
)
returns bigint
language plpgsql
immutable
set search_path to pg_catalog, public
as $$
begin
  if p_units is null or p_rate_per_million is null or p_units < 0 or p_rate_per_million < 0 then
    raise exception 'AI cost inputs must be non-negative integers'
      using errcode = '22023';
  end if;
  if p_units = 0 or p_rate_per_million = 0 then
    return 0;
  end if;
  return (p_units * p_rate_per_million + 999999) / 1000000;
end;
$$;

create or replace function public.ai_chicago_month(p_as_of timestamptz, p_timezone text)
returns text
language sql
immutable
set search_path to pg_catalog, public
as $$
  select to_char(p_as_of at time zone p_timezone, 'YYYY-MM');
$$;

create or replace function public.ai_chicago_day(p_as_of timestamptz, p_timezone text)
returns text
language sql
immutable
set search_path to pg_catalog, public
as $$
  select to_char(p_as_of at time zone p_timezone, 'YYYY-MM-DD');
$$;

create or replace function public.ai_quote_max_cost(
  p_model_id text,
  p_price_version_id uuid,
  p_provider text,
  p_usage_units jsonb
)
returns bigint
language plpgsql
stable
security definer
set search_path to pg_catalog, public
as $$
declare
  v_total bigint := 0;
  v_key text;
  v_value jsonb;
  v_units bigint;
  v_rate bigint;
begin
  if p_usage_units is null or jsonb_typeof(p_usage_units) <> 'object' then
    raise exception 'usage_units must be a JSON object'
      using errcode = '22023';
  end if;

  for v_key, v_value in select key, value from jsonb_each(p_usage_units)
  loop
    if jsonb_typeof(v_value) <> 'number' then
      raise exception 'usage unit % must be an integer', v_key
        using errcode = '22023';
    end if;
    v_units := (v_value #>> '{}')::bigint;
    if v_units < 0 then
      raise exception 'usage unit % must be non-negative', v_key
        using errcode = '22023';
    end if;
    if v_units = 0 then
      continue;
    end if;
    select r.microdollars_per_million
      into v_rate
    from public.ai_price_rates r
    where r.price_version_id = p_price_version_id
      and r.provider = p_provider
      and r.model_id = p_model_id
      and r.usage_kind = v_key;
    if v_rate is null then
      raise exception 'no price for provider/model/usage %/%/%', p_provider, p_model_id, v_key
        using errcode = '22023';
    end if;
    v_total := v_total + public.ai_ceil_microdollars(v_units, v_rate);
  end loop;

  return v_total;
end;
$$;

create or replace function public.ai_current_versions()
returns table (config_version_id uuid, price_version_id uuid)
language sql
stable
security definer
set search_path to pg_catalog, public
as $$
  select
    (select c.id from public.ai_budget_config_versions c order by c.published_at desc, c.id desc limit 1),
    (select p.id from public.ai_price_versions p order by p.published_at desc, p.id desc limit 1);
$$;

create or replace function public.ai_request_result(p_acquired boolean, p_request_id uuid)
returns table (
  acquired boolean,
  customer_released boolean,
  deny_reason text,
  request_id uuid,
  reserved_customer_microdollars bigint,
  reserved_platform_microdollars bigint,
  settled_customer_microdollars bigint,
  settled_platform_microdollars bigint,
  status text
)
language sql
stable
security definer
set search_path to pg_catalog, public
as $$
  select
    p_acquired,
    (r.customer_released_at is not null),
    coalesce(r.deny_reason, ''),
    r.id,
    r.reserved_customer_microdollars,
    r.reserved_platform_microdollars,
    r.settled_customer_microdollars,
    r.settled_platform_microdollars,
    r.status
  from public.ai_requests r
  where r.id = p_request_id;
$$;

create or replace function public.ai_lock_bucket(p_kind text, p_key text, p_period text)
returns public.ai_bucket_balances
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  v_row public.ai_bucket_balances;
begin
  insert into public.ai_bucket_balances (bucket_kind, bucket_key, period_key)
  values (p_kind, p_key, p_period)
  on conflict (bucket_kind, bucket_key, period_key) do nothing;

  select *
    into v_row
  from public.ai_bucket_balances
  where bucket_kind = p_kind
    and bucket_key = p_key
    and period_key = p_period
  for update;

  return v_row;
end;
$$;

create or replace function public.ai_apply_bucket_delta(
  p_customer_consumed bigint,
  p_customer_reserved bigint,
  p_kind text,
  p_key text,
  p_period text,
  p_platform_consumed bigint,
  p_platform_reserved bigint,
  p_turns_consumed integer,
  p_turns_reserved integer
)
returns void
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
begin
  update public.ai_bucket_balances
  set
    customer_reserved = customer_reserved + p_customer_reserved,
    customer_consumed = customer_consumed + p_customer_consumed,
    platform_reserved = platform_reserved + p_platform_reserved,
    platform_consumed = platform_consumed + p_platform_consumed,
    turns_reserved = turns_reserved + p_turns_reserved,
    turns_consumed = turns_consumed + p_turns_consumed,
    updated_at = now()
  where bucket_kind = p_kind
    and bucket_key = p_key
    and period_key = p_period;
end;
$$;

create or replace function public.ai_lock_targets(p_targets jsonb)
returns void
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  v_x jsonb;
begin
  for v_x in
    select value
    from jsonb_array_elements(coalesce(p_targets, '[]'::jsonb))
    order by value->>'k', value->>'b', value->>'p'
  loop
    perform public.ai_lock_bucket(v_x->>'k', v_x->>'b', v_x->>'p');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reserve / dispatch / settle
-- ---------------------------------------------------------------------------
create or replace function public.ai_reserve(
  p_account_tier text,
  p_config_version_id uuid,
  p_feature_class text,
  p_idempotency_key text,
  p_model_id text,
  p_price_version_id uuid,
  p_provider text,
  p_usage_units jsonb,
  p_as_of timestamptz default now(),
  p_guest_id text default null,
  p_user_id uuid default null
)
returns table (
  acquired boolean,
  customer_released boolean,
  deny_reason text,
  request_id uuid,
  reserved_customer_microdollars bigint,
  reserved_platform_microdollars bigint,
  settled_customer_microdollars bigint,
  settled_platform_microdollars bigint,
  status text
)
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  v_cfg public.ai_budget_config_versions;
  v_bind jsonb;
  v_month text;
  v_day text;
  v_quote bigint;
  v_id uuid;
  v_existing public.ai_requests;
  v_sub text;
  v_expected_tier text;
  v_spec jsonb := '[]'::jsonb;
  v_ok boolean := true;
  v_reason text := 'insufficient_budget';
  v_x jsonb;
  v_bal public.ai_bucket_balances;
  v_cap bigint;
  v_global public.ai_bucket_balances;
  v_core public.ai_bucket_balances;
  v_non_core bigint;
  v_is_core boolean;
  v_turns integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));

  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 then
    raise exception 'idempotency_key required'
      using errcode = '22023';
  end if;

  select * into v_cfg
  from public.ai_budget_config_versions
  where id = p_config_version_id;
  if v_cfg.id is null then
    raise exception 'unknown config version'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.ai_price_versions where id = p_price_version_id) then
    raise exception 'unknown price version'
      using errcode = '22023';
  end if;

  if p_feature_class = 'guest' then
    if p_guest_id is null or p_user_id is not null or p_account_tier is distinct from 'guest' then
      raise exception 'guest reserve requires guest_id and guest tier'
        using errcode = '22023';
    end if;
    if exists (select 1 from public.ai_guest_transfers t where t.guest_id = p_guest_id) then
      v_ok := false;
      v_reason := 'guest_already_transferred';
    end if;
  elsif p_feature_class = 'maintenance' then
    if p_user_id is not null or p_guest_id is not null or p_account_tier is distinct from 'ops' then
      raise exception 'maintenance reserve requires ops tier and no subject'
        using errcode = '22023';
    end if;
  elsif p_feature_class in ('optional', 'protected_core') then
    if p_user_id is null or p_guest_id is not null then
      raise exception 'account reserve requires user_id'
        using errcode = '22023';
    end if;
    select subscription_status into v_sub
    from public.user_profiles
    where id = p_user_id;
    if not found then
      raise exception 'unknown user'
        using errcode = '22023';
    end if;
    v_expected_tier := case when v_sub = 'active' then 'paid' else 'free' end;
    if p_account_tier is distinct from v_expected_tier then
      raise exception 'account_tier does not match subscription_status'
        using errcode = '22023';
    end if;
    if p_feature_class = 'protected_core' and p_account_tier is distinct from 'paid' then
      raise exception 'protected_core requires paid tier'
        using errcode = '22023';
    end if;
  else
    raise exception 'invalid feature_class'
      using errcode = '22023';
  end if;

  v_month := public.ai_chicago_month(p_as_of, v_cfg.timezone);
  v_day := public.ai_chicago_day(p_as_of, v_cfg.timezone);
  v_quote := public.ai_quote_max_cost(p_model_id, p_price_version_id, p_provider, p_usage_units);
  v_bind := jsonb_build_object(
    'account_tier', p_account_tier,
    'config_version_id', p_config_version_id,
    'feature_class', p_feature_class,
    'guest_id', p_guest_id,
    'model_id', p_model_id,
    'price_version_id', p_price_version_id,
    'provider', p_provider,
    'usage_units', p_usage_units,
    'user_id', p_user_id
  );

  insert into public.ai_requests (
    idempotency_key, status, account_tier, feature_class, user_id, guest_id,
    provider, model_id, price_version_id, config_version_id, period_key, day_key,
    as_of, bind, usage_units, quoted_microdollars, deny_reason
  )
  values (
    p_idempotency_key, 'denied', p_account_tier, p_feature_class, p_user_id, p_guest_id,
    p_provider, p_model_id, p_price_version_id, p_config_version_id, v_month, v_day,
    p_as_of, v_bind, p_usage_units, v_quote, 'pending'
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select * into v_existing
    from public.ai_requests
    where idempotency_key = p_idempotency_key
    for update;
    if v_existing.bind is distinct from v_bind then
      raise exception 'idempotency_key reused with different binding'
        using errcode = '23505';
    end if;
    return query select * from public.ai_request_result(false, v_existing.id);
    return;
  end if;

  if v_quote = 0 then
    update public.ai_requests req
    set deny_reason = 'zero_quote', updated_at = now()
    where req.id = v_id;
    return query select * from public.ai_request_result(false, v_id);
    return;
  end if;

  if not v_ok then
    update public.ai_requests req
    set deny_reason = v_reason, updated_at = now()
    where req.id = v_id;
    return query select * from public.ai_request_result(false, v_id);
    return;
  end if;

  v_spec := v_spec || jsonb_build_array(jsonb_build_object(
    'k', 'global', 'b', 'platform', 'p', v_month,
    'cap', v_cfg.platform_global_microdollars, 'c', false, 'plat', true, 't', false
  ));
  if p_feature_class = 'protected_core' then
    v_spec := v_spec || jsonb_build_array(jsonb_build_object(
      'k', 'global_core', 'b', 'platform', 'p', v_month,
      'cap', v_cfg.platform_global_microdollars, 'c', false, 'plat', true, 't', false
    ));
  end if;

  if p_feature_class = 'guest' then
    v_spec := v_spec || jsonb_build_array(jsonb_build_object(
      'k', 'guest_session', 'b', p_guest_id, 'p', 'open',
      'cap', v_cfg.guest_session_ceiling_microdollars, 'c', true, 'plat', true, 't', true,
      'tcap', v_cfg.guest_session_turn_limit
    ));
    v_spec := v_spec || jsonb_build_array(jsonb_build_object(
      'k', 'guest_day', 'b', 'guest_pool', 'p', v_day,
      'cap', v_cfg.guest_day_pool_microdollars, 'c', false, 'plat', true, 't', false
    ));
    v_spec := v_spec || jsonb_build_array(jsonb_build_object(
      'k', 'guest_month', 'b', 'guest_pool', 'p', v_month,
      'cap', v_cfg.guest_month_pool_microdollars, 'c', false, 'plat', true, 't', false
    ));
  elsif p_feature_class = 'maintenance' then
    v_spec := v_spec || jsonb_build_array(jsonb_build_object(
      'k', 'maintenance', 'b', 'ops', 'p', v_month,
      'cap', v_cfg.maintenance_microdollars, 'c', false, 'plat', true, 't', false
    ));
  else
    v_spec := v_spec || jsonb_build_array(jsonb_build_object(
      'k', 'account', 'b', p_user_id::text, 'p', v_month,
      'cap', case when p_account_tier = 'paid'
        then v_cfg.paid_account_ceiling_microdollars
        else v_cfg.free_account_ceiling_microdollars end,
      'c', true, 'plat', true, 't', false
    ));
    if p_account_tier = 'paid' and p_feature_class = 'protected_core' then
      v_spec := v_spec || jsonb_build_array(jsonb_build_object(
        'k', 'account_protected', 'b', p_user_id::text, 'p', v_month,
        'cap', v_cfg.paid_protected_microdollars, 'c', true, 'plat', true, 't', false
      ));
    end if;
    if p_account_tier = 'paid' and p_feature_class = 'optional' then
      v_spec := v_spec || jsonb_build_array(jsonb_build_object(
        'k', 'account_optional', 'b', p_user_id::text, 'p', v_month,
        'cap', v_cfg.paid_optional_microdollars, 'c', true, 'plat', true, 't', false
      ));
    end if;
  end if;

  perform public.ai_lock_targets(v_spec);
  perform public.ai_lock_bucket('global_core', 'platform', v_month);

  for v_x in
    select value from jsonb_array_elements(v_spec) order by value->>'k', value->>'b', value->>'p'
  loop
    select * into v_bal
    from public.ai_bucket_balances
    where bucket_kind = v_x->>'k' and bucket_key = v_x->>'b' and period_key = v_x->>'p';
    v_cap := (v_x->>'cap')::bigint;
    if (v_x->>'c')::boolean
       and v_bal.customer_reserved + v_bal.customer_consumed + v_quote > v_cap then
      v_ok := false;
    end if;
    if (v_x->>'plat')::boolean
       and v_bal.platform_reserved + v_bal.platform_consumed + v_quote > v_cap then
      v_ok := false;
    end if;
    if coalesce((v_x->>'t')::boolean, false) then
      v_turns := 1;
      if v_bal.turns_reserved + v_bal.turns_consumed + 1 > (v_x->>'tcap')::integer then
        v_ok := false;
        v_reason := 'guest_turns_exhausted';
      end if;
    end if;
  end loop;

  v_is_core := p_feature_class = 'protected_core';
  select * into v_global from public.ai_bucket_balances
    where bucket_kind = 'global' and bucket_key = 'platform' and period_key = v_month;
  select * into v_core from public.ai_bucket_balances
    where bucket_kind = 'global_core' and bucket_key = 'platform' and period_key = v_month;
  v_non_core := (v_global.platform_reserved + v_global.platform_consumed)
    - (v_core.platform_reserved + v_core.platform_consumed);
  if not v_is_core
     and v_non_core + v_quote
       > v_cfg.platform_global_microdollars - v_cfg.global_paid_core_reserve_microdollars then
    v_ok := false;
    v_reason := 'paid_core_reserve';
  end if;

  if not v_ok then
    update public.ai_requests req
    set deny_reason = v_reason, bucket_targets = v_spec, updated_at = now()
    where req.id = v_id;
    return query select * from public.ai_request_result(false, v_id);
    return;
  end if;

  for v_x in
    select value from jsonb_array_elements(v_spec) order by value->>'k', value->>'b', value->>'p'
  loop
    perform public.ai_apply_bucket_delta(
      0,
      case when (v_x->>'c')::boolean then v_quote else 0 end,
      v_x->>'k',
      v_x->>'b',
      v_x->>'p',
      0,
      case when (v_x->>'plat')::boolean then v_quote else 0 end,
      0,
      case when coalesce((v_x->>'t')::boolean, false) then 1 else 0 end
    );
  end loop;

  update public.ai_requests req
  set
    status = 'reserved',
    deny_reason = null,
    bucket_targets = v_spec,
    reserved_customer_microdollars = v_quote,
    reserved_platform_microdollars = v_quote,
    updated_at = now()
  where req.id = v_id;

  return query select * from public.ai_request_result(true, v_id);
end;
$$;

create or replace function public.ai_dispatch(p_request_id uuid)
returns table (
  acquired boolean,
  customer_released boolean,
  deny_reason text,
  request_id uuid,
  reserved_customer_microdollars bigint,
  reserved_platform_microdollars bigint,
  settled_customer_microdollars bigint,
  settled_platform_microdollars bigint,
  status text
)
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  v_updated uuid;
begin
  update public.ai_requests req
  set status = 'dispatched', dispatch_acquired_at = now(), updated_at = now()
  where req.id = p_request_id
    and req.status = 'reserved'
  returning id into v_updated;

  if v_updated is not null then
    return query select * from public.ai_request_result(true, p_request_id);
    return;
  end if;

  if not exists (select 1 from public.ai_requests where id = p_request_id) then
    raise exception 'unknown request'
      using errcode = '22023';
  end if;

  return query select * from public.ai_request_result(false, p_request_id);
end;
$$;

create or replace function public.ai_fail_before_dispatch(p_request_id uuid)
returns table (
  acquired boolean,
  customer_released boolean,
  deny_reason text,
  request_id uuid,
  reserved_customer_microdollars bigint,
  reserved_platform_microdollars bigint,
  settled_customer_microdollars bigint,
  settled_platform_microdollars bigint,
  status text
)
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  r public.ai_requests;
  v_x jsonb;
  v_quote bigint;
begin
  select * into r from public.ai_requests where id = p_request_id for update;
  if r.id is null then
    raise exception 'unknown request' using errcode = '22023';
  end if;
  if r.status = 'failed_before_dispatch' then
    return query select * from public.ai_request_result(false, r.id);
    return;
  end if;
  if r.status <> 'reserved' then
    raise exception 'fail_before_dispatch requires reserved status'
      using errcode = '22023';
  end if;

  v_quote := r.quoted_microdollars;
  perform public.ai_lock_targets(r.bucket_targets);
  for v_x in
    select value from jsonb_array_elements(r.bucket_targets)
    order by value->>'k', value->>'b', value->>'p'
  loop
    perform public.ai_apply_bucket_delta(
      0,
      case when (v_x->>'c')::boolean then -v_quote else 0 end,
      v_x->>'k', v_x->>'b', v_x->>'p',
      0,
      case when (v_x->>'plat')::boolean then -v_quote else 0 end,
      0,
      case when coalesce((v_x->>'t')::boolean, false) then -1 else 0 end
    );
  end loop;

  update public.ai_requests req
  set
    status = 'failed_before_dispatch',
    reserved_customer_microdollars = 0,
    reserved_platform_microdollars = 0,
    updated_at = now()
  where req.id = r.id;

  return query select * from public.ai_request_result(false, r.id);
end;
$$;

create or replace function public.ai_settle(p_request_id uuid, p_usage_actual jsonb)
returns table (
  acquired boolean,
  customer_released boolean,
  deny_reason text,
  request_id uuid,
  reserved_customer_microdollars bigint,
  reserved_platform_microdollars bigint,
  settled_customer_microdollars bigint,
  settled_platform_microdollars bigint,
  status text
)
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  r public.ai_requests;
  v_actual bigint;
  v_x jsonb;
begin
  select * into r from public.ai_requests where id = p_request_id for update;
  if r.id is null then
    raise exception 'unknown request' using errcode = '22023';
  end if;
  if r.status = 'settled' then
    return query select * from public.ai_request_result(false, r.id);
    return;
  end if;
  if r.status <> 'dispatched' then
    raise exception 'settle requires dispatched status'
      using errcode = '22023';
  end if;

  v_actual := public.ai_quote_max_cost(r.model_id, r.price_version_id, r.provider, p_usage_actual);
  if v_actual > r.quoted_microdollars then
    raise exception 'actual cost exceeds reserved quote'
      using errcode = '22023';
  end if;

  perform public.ai_lock_targets(r.bucket_targets);
  for v_x in
    select value from jsonb_array_elements(r.bucket_targets)
    order by value->>'k', value->>'b', value->>'p'
  loop
    perform public.ai_apply_bucket_delta(
      case when (v_x->>'c')::boolean then v_actual else 0 end,
      case when (v_x->>'c')::boolean then -r.quoted_microdollars else 0 end,
      v_x->>'k', v_x->>'b', v_x->>'p',
      case when (v_x->>'plat')::boolean then v_actual else 0 end,
      case when (v_x->>'plat')::boolean then -r.quoted_microdollars else 0 end,
      case when coalesce((v_x->>'t')::boolean, false) then 1 else 0 end,
      case when coalesce((v_x->>'t')::boolean, false) then -1 else 0 end
    );
  end loop;

  update public.ai_requests req
  set
    status = 'settled',
    usage_actual = p_usage_actual,
    reserved_customer_microdollars = 0,
    reserved_platform_microdollars = 0,
    settled_customer_microdollars = v_actual,
    settled_platform_microdollars = v_actual,
    settled_at = now(),
    updated_at = now()
  where req.id = r.id;

  return query select * from public.ai_request_result(false, r.id);
end;
$$;

create or replace function public.ai_mark_assumed_spent(p_request_id uuid)
returns table (
  acquired boolean,
  customer_released boolean,
  deny_reason text,
  request_id uuid,
  reserved_customer_microdollars bigint,
  reserved_platform_microdollars bigint,
  settled_customer_microdollars bigint,
  settled_platform_microdollars bigint,
  status text
)
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  r public.ai_requests;
  v_x jsonb;
begin
  select * into r from public.ai_requests where id = p_request_id for update;
  if r.id is null then
    raise exception 'unknown request' using errcode = '22023';
  end if;
  if r.status = 'assumed_spent' then
    return query select * from public.ai_request_result(false, r.id);
    return;
  end if;
  if r.status <> 'dispatched' then
    raise exception 'assumed_spent requires dispatched status'
      using errcode = '22023';
  end if;

  perform public.ai_lock_targets(r.bucket_targets);
  for v_x in
    select value from jsonb_array_elements(r.bucket_targets)
    order by value->>'k', value->>'b', value->>'p'
  loop
    perform public.ai_apply_bucket_delta(
      0, 0,
      v_x->>'k', v_x->>'b', v_x->>'p',
      case when (v_x->>'plat')::boolean then r.quoted_microdollars else 0 end,
      case when (v_x->>'plat')::boolean then -r.quoted_microdollars else 0 end,
      case when coalesce((v_x->>'t')::boolean, false) then 1 else 0 end,
      case when coalesce((v_x->>'t')::boolean, false) then -1 else 0 end
    );
  end loop;

  update public.ai_requests req
  set
    status = 'assumed_spent',
    reserved_platform_microdollars = 0,
    settled_platform_microdollars = r.quoted_microdollars,
    updated_at = now()
  where req.id = r.id;

  return query select * from public.ai_request_result(false, r.id);
end;
$$;

create or replace function public.ai_release_customer_allowance(p_request_id uuid)
returns table (
  acquired boolean,
  customer_released boolean,
  deny_reason text,
  request_id uuid,
  reserved_customer_microdollars bigint,
  reserved_platform_microdollars bigint,
  settled_customer_microdollars bigint,
  settled_platform_microdollars bigint,
  status text
)
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  r public.ai_requests;
  v_x jsonb;
begin
  select * into r from public.ai_requests where id = p_request_id for update;
  if r.id is null then
    raise exception 'unknown request' using errcode = '22023';
  end if;
  if r.customer_released_at is not null then
    return query select * from public.ai_request_result(false, r.id);
    return;
  end if;
  if r.status <> 'assumed_spent' then
    raise exception 'customer release requires assumed_spent'
      using errcode = '22023';
  end if;

  perform public.ai_lock_targets(r.bucket_targets);
  for v_x in
    select value from jsonb_array_elements(r.bucket_targets)
    order by value->>'k', value->>'b', value->>'p'
  loop
    perform public.ai_apply_bucket_delta(
      0,
      case when (v_x->>'c')::boolean then -r.reserved_customer_microdollars else 0 end,
      v_x->>'k', v_x->>'b', v_x->>'p',
      0, 0, 0, 0
    );
  end loop;

  update public.ai_requests req
  set
    reserved_customer_microdollars = 0,
    customer_released_at = now(),
    updated_at = now()
  where req.id = r.id;

  return query select * from public.ai_request_result(false, r.id);
end;
$$;

create or replace function public.ai_reconcile(p_request_id uuid, p_usage_actual jsonb)
returns table (
  acquired boolean,
  customer_released boolean,
  deny_reason text,
  request_id uuid,
  reserved_customer_microdollars bigint,
  reserved_platform_microdollars bigint,
  settled_customer_microdollars bigint,
  settled_platform_microdollars bigint,
  status text
)
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  r public.ai_requests;
  v_actual bigint;
  v_delta bigint;
  v_x jsonb;
begin
  select * into r from public.ai_requests where id = p_request_id for update;
  if r.id is null then
    raise exception 'unknown request' using errcode = '22023';
  end if;
  if r.status <> 'assumed_spent' then
    raise exception 'reconcile requires assumed_spent'
      using errcode = '22023';
  end if;

  v_actual := public.ai_quote_max_cost(r.model_id, r.price_version_id, r.provider, p_usage_actual);
  if v_actual > r.quoted_microdollars then
    raise exception 'actual cost exceeds reserved quote'
      using errcode = '22023';
  end if;
  v_delta := v_actual - r.settled_platform_microdollars;

  perform public.ai_lock_targets(r.bucket_targets);
  for v_x in
    select value from jsonb_array_elements(r.bucket_targets)
    order by value->>'k', value->>'b', value->>'p'
  loop
    perform public.ai_apply_bucket_delta(
      0, 0,
      v_x->>'k', v_x->>'b', v_x->>'p',
      case when (v_x->>'plat')::boolean then v_delta else 0 end,
      0, 0, 0
    );
  end loop;

  update public.ai_requests req
  set
    usage_actual = p_usage_actual,
    settled_platform_microdollars = v_actual,
    updated_at = now()
  where req.id = r.id;

  return query select * from public.ai_request_result(false, r.id);
end;
$$;

create or replace function public.ai_transfer_guest_to_account(p_guest_id text, p_user_id uuid)
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

  v_guest := public.ai_lock_bucket('guest_session', p_guest_id, 'open');
  perform public.ai_lock_bucket('account', p_user_id::text, v_month);
  v_amount := v_guest.customer_reserved + v_guest.customer_consumed;
  v_turns := v_guest.turns_reserved + v_guest.turns_consumed;

  perform public.ai_apply_bucket_delta(
    v_guest.customer_consumed,
    v_guest.customer_reserved,
    'account', p_user_id::text, v_month,
    0, 0, 0, 0
  );
  perform public.ai_apply_bucket_delta(
    -v_guest.customer_consumed,
    -v_guest.customer_reserved,
    'guest_session', p_guest_id, 'open',
    0, 0, 0, 0
  );

  update public.ai_requests req
  set
    user_id = p_user_id,
    account_tier = v_tier,
    updated_at = now()
  where req.guest_id = p_guest_id
    and req.user_id is null;

  update public.ai_guest_transfers t
  set
    transferred_customer_microdollars = v_amount,
    transferred_turns = v_turns
  where t.guest_id = p_guest_id;

  return query
    select false, p_guest_id, v_amount, p_user_id;
end;
$$;

create or replace function public.ai_fair_use_state(
  p_as_of timestamptz default now(),
  p_guest_id text default null,
  p_user_id uuid default null
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
  v_reset date;
  v_remaining integer := null;
begin
  select * into v_cfg
  from public.ai_budget_config_versions
  order by published_at desc, id desc
  limit 1;
  v_month := public.ai_chicago_month(p_as_of, v_cfg.timezone);
  v_reset := (
    date_trunc('month', (p_as_of at time zone v_cfg.timezone))
      + interval '1 month'
  )::date;

  if p_user_id is not null then
    select subscription_status into v_sub from public.user_profiles where id = p_user_id;
    v_cap := case when v_sub = 'active'
      then v_cfg.paid_account_ceiling_microdollars
      else v_cfg.free_account_ceiling_microdollars end;
    select coalesce(customer_reserved + customer_consumed, 0)
      into v_used
    from public.ai_bucket_balances
    where bucket_kind = 'account' and bucket_key = p_user_id::text and period_key = v_month;
  elsif p_guest_id is not null then
    v_cap := v_cfg.guest_session_ceiling_microdollars;
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

create or replace function public.ai_ops_usage_summary(p_period_key text)
returns table (
  account_tier text,
  customer_consumed_microdollars bigint,
  feature_class text,
  period_key text,
  platform_consumed_microdollars bigint,
  request_count bigint,
  request_status text
)
language sql
stable
security definer
set search_path to pg_catalog, public
as $$
  select
    r.account_tier,
    coalesce(sum(r.settled_customer_microdollars), 0),
    r.feature_class,
    r.period_key,
    coalesce(sum(r.settled_platform_microdollars), 0),
    count(*)::bigint,
    r.status
  from public.ai_requests r
  where r.period_key = p_period_key
  group by r.period_key, r.feature_class, r.account_tier, r.status
  order by r.feature_class, r.account_tier, r.status;
$$;

-- ---------------------------------------------------------------------------
-- Seed published Haiku 4.5 snapshot + proposed config (new version to change)
-- ---------------------------------------------------------------------------
insert into public.ai_price_versions (id, notes)
values (
  'a1000000-0000-4000-8000-00000000ae01',
  'Anthropic Claude Haiku 4.5 snapshot claude-haiku-4-5-20251001 standard rates'
);

insert into public.ai_price_rates (
  price_version_id, provider, model_id, usage_kind, microdollars_per_million
) values
  ('a1000000-0000-4000-8000-00000000ae01', 'anthropic', 'claude-haiku-4-5-20251001', 'input', 1000000),
  ('a1000000-0000-4000-8000-00000000ae01', 'anthropic', 'claude-haiku-4-5-20251001', 'output', 5000000),
  ('a1000000-0000-4000-8000-00000000ae01', 'anthropic', 'claude-haiku-4-5-20251001', 'cache_write_5m', 1250000),
  ('a1000000-0000-4000-8000-00000000ae01', 'anthropic', 'claude-haiku-4-5-20251001', 'cache_write_1h', 2000000),
  ('a1000000-0000-4000-8000-00000000ae01', 'anthropic', 'claude-haiku-4-5-20251001', 'cache_read', 100000);

insert into public.ai_budget_config_versions (
  id,
  timezone,
  paid_account_ceiling_microdollars,
  free_account_ceiling_microdollars,
  paid_protected_microdollars,
  paid_optional_microdollars,
  guest_session_ceiling_microdollars,
  guest_session_turn_limit,
  guest_voice_seconds_limit,
  guest_day_pool_microdollars,
  guest_month_pool_microdollars,
  platform_global_microdollars,
  maintenance_microdollars,
  global_paid_core_reserve_microdollars
) values (
  'a1000000-0000-4000-8000-00000000ae02',
  'America/Chicago',
  1000000,
  200000,
  400000,
  600000,
  20000,
  3,
  30,
  5000000,
  50000000,
  100000000,
  10000000,
  20000000
);

-- ---------------------------------------------------------------------------
-- Grants: no table DML (including service_role). EXECUTE to service_role only.
-- ---------------------------------------------------------------------------
revoke all on table public.ai_price_versions
  from public, anon, authenticated, service_role;
revoke all on table public.ai_price_rates
  from public, anon, authenticated, service_role;
revoke all on table public.ai_budget_config_versions
  from public, anon, authenticated, service_role;
revoke all on table public.ai_bucket_balances
  from public, anon, authenticated, service_role;
revoke all on table public.ai_requests
  from public, anon, authenticated, service_role;
revoke all on table public.ai_guest_transfers
  from public, anon, authenticated, service_role;

revoke all on function public.ai_forbid_registry_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.ai_ceil_microdollars(bigint, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_chicago_month(timestamptz, text)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_chicago_day(timestamptz, text)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_quote_max_cost(text, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_current_versions()
  from public, anon, authenticated, service_role;
revoke all on function public.ai_request_result(boolean, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_lock_bucket(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_apply_bucket_delta(bigint, bigint, text, text, text, bigint, bigint, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_lock_targets(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_reserve(text, uuid, text, text, text, uuid, text, jsonb, timestamptz, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_dispatch(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_fail_before_dispatch(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_settle(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_mark_assumed_spent(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_release_customer_allowance(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_reconcile(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_transfer_guest_to_account(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_fair_use_state(timestamptz, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ai_ops_usage_summary(text)
  from public, anon, authenticated, service_role;

grant execute on function public.ai_quote_max_cost(text, uuid, text, jsonb)
  to service_role;
grant execute on function public.ai_current_versions()
  to service_role;
grant execute on function public.ai_reserve(text, uuid, text, text, text, uuid, text, jsonb, timestamptz, text, uuid)
  to service_role;
grant execute on function public.ai_dispatch(uuid)
  to service_role;
grant execute on function public.ai_fail_before_dispatch(uuid)
  to service_role;
grant execute on function public.ai_settle(uuid, jsonb)
  to service_role;
grant execute on function public.ai_mark_assumed_spent(uuid)
  to service_role;
grant execute on function public.ai_release_customer_allowance(uuid)
  to service_role;
grant execute on function public.ai_reconcile(uuid, jsonb)
  to service_role;
grant execute on function public.ai_transfer_guest_to_account(text, uuid)
  to service_role;
grant execute on function public.ai_fair_use_state(timestamptz, text, uuid)
  to service_role;
grant execute on function public.ai_ops_usage_summary(text)
  to service_role;
