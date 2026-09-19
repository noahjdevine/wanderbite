-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '30s';

insert into auth.users (id) values
  ('c1000000-0000-4000-8000-000000000001'),
  ('c1000000-0000-4000-8000-000000000002'),
  ('c1000000-0000-4000-8000-000000000003');
insert into public.user_profiles (id, subscription_status, is_admin) values
  ('c1000000-0000-4000-8000-000000000001', 'active', false),
  ('c1000000-0000-4000-8000-000000000002', 'inactive', false),
  ('c1000000-0000-4000-8000-000000000003', 'inactive', false);

do $$
declare
  v_price uuid := 'a1000000-0000-4000-8000-00000000ae01';
  v_cfg uuid := 'a1000000-0000-4000-8000-00000000ae02';
  v_model text := 'claude-haiku-4-5-20251001';
  v_as timestamptz := '2026-09-19 17:00:00+00';
  v_paid uuid := 'c1000000-0000-4000-8000-000000000001';
  v_free uuid := 'c1000000-0000-4000-8000-000000000002';
  v_dest uuid := 'c1000000-0000-4000-8000-000000000003';
  v_cost bigint;
  r record;
  r2 record;
  v_fair record;
  v_ops integer;
begin
  v_cost := public.ai_quote_max_cost(v_model, v_price, 'anthropic', '{"input":1}'::jsonb);
  if v_cost <> 1 then
    raise exception 'FAIL: 1 input token should cost 1 microdollar, got %', v_cost;
  end if;
  v_cost := public.ai_quote_max_cost(v_model, v_price, 'anthropic', '{"output":1}'::jsonb);
  if v_cost <> 5 then
    raise exception 'FAIL: 1 output token should ceil to 5, got %', v_cost;
  end if;
  v_cost := public.ai_quote_max_cost(v_model, v_price, 'anthropic', '{"cache_write_5m":1}'::jsonb);
  if v_cost <> 2 then
    raise exception 'FAIL: 1 cache_write_5m unit should ceil 1.25 to 2, got %', v_cost;
  end if;

  begin
    perform public.ai_quote_max_cost(v_model, v_price, 'anthropic', '{"tool":1}'::jsonb);
    raise exception 'FAIL: unknown usage kind should fail closed';
  exception
    when others then
      if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '22023' then
        raise exception 'FAIL: unknown kind expected 22023, got % %', sqlstate, sqlerrm;
      end if;
  end;

  begin
    update public.ai_price_rates set microdollars_per_million = 1;
    raise exception 'FAIL: price rates must be immutable';
  exception
    when others then
      if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
      if sqlerrm not like 'AI registry rows are immutable%' then
        raise exception 'FAIL: immutability message, got %', sqlerrm;
      end if;
  end;

  select * into r from public.ai_reserve(
    p_account_tier => 'paid',
    p_config_version_id => v_cfg,
    p_feature_class => 'optional',
    p_idempotency_key => 'g13-opt-1-key',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":1000}'::jsonb,
    p_as_of => v_as,
    p_user_id => v_paid
  );
  if r.status <> 'reserved' or r.acquired is not true or r.reserved_customer_microdollars <> 1000 then
    raise exception 'FAIL: optional reserve %', r;
  end if;

  select * into r2 from public.ai_reserve(
    p_account_tier => 'paid',
    p_config_version_id => v_cfg,
    p_feature_class => 'optional',
    p_idempotency_key => 'g13-opt-1-key',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":1000}'::jsonb,
    p_as_of => v_as,
    p_user_id => v_paid
  );
  if r2.request_id <> r.request_id or r2.acquired is not false or r2.status <> 'reserved' then
    raise exception 'FAIL: idempotent reserve replay %', r2;
  end if;

  select * into r2 from public.ai_dispatch(r.request_id);
  if r2.acquired is not true or r2.status <> 'dispatched' then
    raise exception 'FAIL: first dispatch owner %', r2;
  end if;
  select * into r2 from public.ai_dispatch(r.request_id);
  if r2.acquired is not false or r2.status <> 'dispatched' then
    raise exception 'FAIL: replay dispatch must not re-acquire %', r2;
  end if;

  select * into r2 from public.ai_settle(r.request_id, '{"input":800}'::jsonb);
  if r2.status <> 'settled'
     or r2.settled_customer_microdollars <> 800
     or r2.settled_platform_microdollars <> 800
     or r2.reserved_customer_microdollars <> 0 then
    raise exception 'FAIL: settle actuals %', r2;
  end if;
  select * into r2 from public.ai_settle(r.request_id, '{"input":800}'::jsonb);
  if r2.status <> 'settled' or r2.settled_customer_microdollars <> 800 then
    raise exception 'FAIL: settle replay %', r2;
  end if;

  select * into r from public.ai_reserve(
    p_account_tier => 'paid',
    p_config_version_id => v_cfg,
    p_feature_class => 'optional',
    p_idempotency_key => 'g13-fail-key',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":100}'::jsonb,
    p_as_of => v_as,
    p_user_id => v_paid
  );
  select * into r2 from public.ai_fail_before_dispatch(r.request_id);
  if r2.status <> 'failed_before_dispatch'
     or r2.reserved_customer_microdollars <> 0
     or r2.reserved_platform_microdollars <> 0 then
    raise exception 'FAIL: fail_before_dispatch %', r2;
  end if;

  select * into r from public.ai_reserve(
    p_account_tier => 'paid',
    p_config_version_id => v_cfg,
    p_feature_class => 'optional',
    p_idempotency_key => 'g13-assume-key',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":50}'::jsonb,
    p_as_of => v_as,
    p_user_id => v_paid
  );
  perform public.ai_dispatch(r.request_id);
  select * into r2 from public.ai_mark_assumed_spent(r.request_id);
  if r2.status <> 'assumed_spent'
     or r2.settled_platform_microdollars <> 50
     or r2.reserved_customer_microdollars <> 50
     or r2.customer_released is not false then
    raise exception 'FAIL: assumed_spent holds customer %', r2;
  end if;
  select * into r2 from public.ai_release_customer_allowance(r.request_id);
  if r2.customer_released is not true
     or r2.reserved_customer_microdollars <> 0
     or r2.settled_platform_microdollars <> 50 then
    raise exception 'FAIL: customer released, platform retained %', r2;
  end if;
  select * into r2 from public.ai_reconcile(r.request_id, '{"input":20}'::jsonb);
  if r2.settled_platform_microdollars <> 20 or r2.settled_customer_microdollars <> 0 then
    raise exception 'FAIL: reconcile platform only %', r2;
  end if;

  select * into r from public.ai_reserve(
    p_account_tier => 'paid',
    p_config_version_id => v_cfg,
    p_feature_class => 'optional',
    p_idempotency_key => 'g13-opt-fill',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":599000}'::jsonb,
    p_as_of => v_as,
    p_user_id => v_paid
  );
  if r.status <> 'reserved' then
    raise exception 'FAIL: remaining optional should reserve %', r;
  end if;
  select * into r2 from public.ai_reserve(
    p_account_tier => 'paid',
    p_config_version_id => v_cfg,
    p_feature_class => 'optional',
    p_idempotency_key => 'g13-opt-deny',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":2000}'::jsonb,
    p_as_of => v_as,
    p_user_id => v_paid
  );
  if r2.status <> 'denied' then
    raise exception 'FAIL: optional over cap %', r2;
  end if;
  select * into r2 from public.ai_reserve(
    p_account_tier => 'paid',
    p_config_version_id => v_cfg,
    p_feature_class => 'protected_core',
    p_idempotency_key => 'g13-core-ok',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":1000}'::jsonb,
    p_as_of => v_as,
    p_user_id => v_paid
  );
  if r2.status <> 'reserved' then
    raise exception 'FAIL: protected_core still available %', r2;
  end if;

  select * into r from public.ai_reserve(
    p_account_tier => 'free',
    p_config_version_id => v_cfg,
    p_feature_class => 'optional',
    p_idempotency_key => 'g13-free-fill',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":200000}'::jsonb,
    p_as_of => v_as,
    p_user_id => v_free
  );
  if r.status <> 'reserved' then
    raise exception 'FAIL: free $0.20 %', r;
  end if;
  update public.user_profiles
  set subscription_status = 'active'
  where id = v_free;
  select * into r2 from public.ai_reserve(
    p_account_tier => 'paid',
    p_config_version_id => v_cfg,
    p_feature_class => 'optional',
    p_idempotency_key => 'g13-upgrade',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":1000}'::jsonb,
    p_as_of => v_as,
    p_user_id => v_free
  );
  if r2.status <> 'reserved' then
    raise exception 'FAIL: upgrade is $1.00 total not $1.20 extra %', r2;
  end if;
  update public.user_profiles
  set subscription_status = 'inactive'
  where id = v_free;
  select * into r2 from public.ai_reserve(
    p_account_tier => 'free',
    p_config_version_id => v_cfg,
    p_feature_class => 'optional',
    p_idempotency_key => 'g13-downgrade',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":1}'::jsonb,
    p_as_of => v_as,
    p_user_id => v_free
  );
  if r2.status <> 'denied' then
    raise exception 'FAIL: downgrade must not erase usage or raise cap %', r2;
  end if;

  select * into r from public.ai_reserve(
    p_account_tier => 'guest',
    p_config_version_id => v_cfg,
    p_feature_class => 'guest',
    p_idempotency_key => 'g13-guest-1',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":1}'::jsonb,
    p_as_of => v_as,
    p_guest_id => 'guest-session-a'
  );
  perform public.ai_dispatch(r.request_id);
  perform public.ai_settle(r.request_id, '{"input":1}'::jsonb);
  select * into r from public.ai_reserve(
    p_account_tier => 'guest',
    p_config_version_id => v_cfg,
    p_feature_class => 'guest',
    p_idempotency_key => 'g13-guest-2',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":1}'::jsonb,
    p_as_of => v_as,
    p_guest_id => 'guest-session-a'
  );
  perform public.ai_dispatch(r.request_id);
  perform public.ai_settle(r.request_id, '{"input":1}'::jsonb);
  select * into r from public.ai_reserve(
    p_account_tier => 'guest',
    p_config_version_id => v_cfg,
    p_feature_class => 'guest',
    p_idempotency_key => 'g13-guest-3',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":1}'::jsonb,
    p_as_of => v_as,
    p_guest_id => 'guest-session-a'
  );
  perform public.ai_dispatch(r.request_id);
  perform public.ai_settle(r.request_id, '{"input":1}'::jsonb);
  select * into r2 from public.ai_reserve(
    p_account_tier => 'guest',
    p_config_version_id => v_cfg,
    p_feature_class => 'guest',
    p_idempotency_key => 'g13-guest-4',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":1}'::jsonb,
    p_as_of => v_as,
    p_guest_id => 'guest-session-a'
  );
  if r2.status <> 'denied' or r2.deny_reason <> 'guest_turns_exhausted' then
    raise exception 'FAIL: fourth guest turn %', r2;
  end if;

  select * into r from public.ai_transfer_guest_to_account('guest-session-a', v_dest);
  if r.already_claimed is not false or r.transferred_customer_microdollars < 1 then
    raise exception 'FAIL: guest transfer %', r;
  end if;
  select * into r2 from public.ai_transfer_guest_to_account('guest-session-a', v_dest);
  if r2.already_claimed is not true then
    raise exception 'FAIL: guest transfer must be once %', r2;
  end if;
  select * into r2 from public.ai_reserve(
    p_account_tier => 'guest',
    p_config_version_id => v_cfg,
    p_feature_class => 'guest',
    p_idempotency_key => 'g13-guest-after',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":1}'::jsonb,
    p_as_of => v_as,
    p_guest_id => 'guest-session-a'
  );
  if r2.status <> 'denied' or r2.deny_reason <> 'guest_already_transferred' then
    raise exception 'FAIL: transferred guest cannot reserve %', r2;
  end if;
end $$;

do $$
declare
  v_price uuid := 'a1000000-0000-4000-8000-00000000ae01';
  v_cfg uuid := 'a1000000-0000-4000-8000-00000000ae02';
  v_model text := 'claude-haiku-4-5-20251001';
  v_as timestamptz := '2026-09-19 17:00:00+00';
  v_as_oct timestamptz := '2026-10-15 17:00:00+00';
  v_core_user uuid := 'c1000000-0000-4000-8000-000000000001';
  r record;
  v_fair record;
  v_ops bigint;
  v_tiny uuid;
begin
  insert into auth.users (id) values ('c1000000-0000-4000-8000-0000000000aa')
  on conflict do nothing;
  insert into public.user_profiles (id, subscription_status, is_admin)
  values ('c1000000-0000-4000-8000-0000000000aa', 'active', false)
  on conflict (id) do nothing;

  select * into r from public.ai_reserve(
    p_account_tier => 'paid',
    p_config_version_id => v_cfg,
    p_feature_class => 'optional',
    p_idempotency_key => 'g13-global-noncore',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":80000000}'::jsonb,
    p_as_of => v_as,
    p_user_id => 'c1000000-0000-4000-8000-0000000000aa'
  );
  if r.status <> 'denied' then
    -- $80 optional exceeds the $0.60 paid optional share; use maintenance to fill non-core.
    null;
  end if;

  select * into r from public.ai_reserve(
    p_account_tier => 'ops',
    p_config_version_id => v_cfg,
    p_feature_class => 'maintenance',
    p_idempotency_key => 'g13-maint-fill',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":10000000}'::jsonb,
    p_as_of => v_as
  );
  if r.status <> 'reserved' then
    raise exception 'FAIL: maintenance $10 %', r;
  end if;
  select * into r from public.ai_reserve(
    p_account_tier => 'ops',
    p_config_version_id => v_cfg,
    p_feature_class => 'maintenance',
    p_idempotency_key => 'g13-maint-over',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":1}'::jsonb,
    p_as_of => v_as
  );
  if r.status <> 'denied' then
    raise exception 'FAIL: maintenance sublimit %', r;
  end if;

  insert into public.ai_budget_config_versions (
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
    'America/Chicago',
    1000000, 200000, 400000, 600000,
    20000, 3, 30, 5000000, 50000000,
    1000, 100, 400
  ) returning id into v_tiny;

  select * into r from public.ai_reserve(
    p_account_tier => 'guest',
    p_config_version_id => v_tiny,
    p_feature_class => 'guest',
    p_idempotency_key => 'g13-tiny-guest',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":600}'::jsonb,
    p_as_of => v_as_oct,
    p_guest_id => 'guest-tiny-noncore'
  );
  if r.status <> 'reserved' then
    raise exception 'FAIL: tiny non-core fill %', r;
  end if;
  select * into r from public.ai_reserve(
    p_account_tier => 'guest',
    p_config_version_id => v_tiny,
    p_feature_class => 'guest',
    p_idempotency_key => 'g13-tiny-noncore-deny',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":1}'::jsonb,
    p_as_of => v_as_oct,
    p_guest_id => 'guest-tiny-noncore-2'
  );
  if r.status <> 'denied' or r.deny_reason <> 'paid_core_reserve' then
    raise exception 'FAIL: paid-core reserve must block non-core %', r;
  end if;
  select * into r from public.ai_reserve(
    p_account_tier => 'paid',
    p_config_version_id => v_tiny,
    p_feature_class => 'protected_core',
    p_idempotency_key => 'g13-tiny-core',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":1}'::jsonb,
    p_as_of => v_as_oct,
    p_user_id => v_core_user
  );
  if r.status <> 'reserved' then
    raise exception 'FAIL: protected_core may use the reserved slice %', r;
  end if;

  -- Non-core remaining after $10 maintenance is $70 of the $80 non-core slice.
  -- Guest month pool is $50, so a $50 guest-month fill plus maintenance still leaves paid-core reserve.
  select * into r from public.ai_reserve(
    p_account_tier => 'guest',
    p_config_version_id => v_cfg,
    p_feature_class => 'guest',
    p_idempotency_key => 'g13-guest-pool',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":20000}'::jsonb,
    p_as_of => v_as,
    p_guest_id => 'guest-pool-fill'
  );
  if r.status <> 'reserved' then
    raise exception 'FAIL: guest session $0.02 %', r;
  end if;

  select * into v_fair from public.ai_fair_use_state(
    p_as_of => v_as,
    p_user_id => v_core_user
  );
  if v_fair.status not in ('ok', 'near_limit', 'exhausted') or v_fair.resets_on is null then
    raise exception 'FAIL: fair use %', v_fair;
  end if;
  if v_fair.guest_turns_remaining is not null then
    raise exception 'FAIL: account fair use must omit guest turns %', v_fair;
  end if;

  select count(*) into v_ops from public.ai_ops_usage_summary('2026-09');
  if v_ops < 1 then
    raise exception 'FAIL: ops summary empty';
  end if;
end $$;

select 'PASS: G13-A1 quotes, state machine, buckets, transfer, fair-use, ops';
rollback;
