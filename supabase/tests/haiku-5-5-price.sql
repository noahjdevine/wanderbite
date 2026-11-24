-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '30s';

do $$
declare
  v_price uuid;
  v_cfg uuid;
  v_model text := 'claude-haiku-5-5';
  v_cost bigint;
  v_user uuid := 'c3000000-0000-4000-8000-000000000055';
  r record;
begin
  select price_version_id, config_version_id into v_price, v_cfg
  from public.ai_current_versions();

  if (
    select count(*)
    from public.ai_price_rates
    where price_version_id = v_price
      and provider = 'anthropic'
      and model_id = v_model
  ) <> 5 then
    raise exception 'FAIL: current price version is missing claude-haiku-5-5 rates';
  end if;

  v_cost := public.ai_quote_max_cost(v_model, v_price, 'anthropic', '{"input":1000000}'::jsonb);
  if v_cost <> 100000 then
    raise exception 'FAIL: 1M input tokens should be 100000 microdollars, got %', v_cost;
  end if;
  v_cost := public.ai_quote_max_cost(v_model, v_price, 'anthropic', '{"output":1000000}'::jsonb);
  if v_cost <> 500000 then
    raise exception 'FAIL: 1M output tokens should be 500000 microdollars, got %', v_cost;
  end if;
  v_cost := public.ai_quote_max_cost(v_model, v_price, 'anthropic', '{"cache_read":1000000}'::jsonb);
  if v_cost <> 10000 then
    raise exception 'FAIL: 1M cache_read tokens should be 10000 microdollars, got %', v_cost;
  end if;
  v_cost := public.ai_quote_max_cost(v_model, v_price, 'anthropic', '{"cache_write_5m":1000000}'::jsonb);
  if v_cost <> 125000 then
    raise exception 'FAIL: 1M cache_write_5m tokens should be 125000 microdollars, got %', v_cost;
  end if;
  v_cost := public.ai_quote_max_cost(v_model, v_price, 'anthropic', '{"cache_write_1h":1000000}'::jsonb);
  if v_cost <> 200000 then
    raise exception 'FAIL: 1M cache_write_1h tokens should be 200000 microdollars, got %', v_cost;
  end if;
  v_cost := public.ai_quote_max_cost(v_model, v_price, 'anthropic', '{"input":1000,"output":300}'::jsonb);
  if v_cost <> 250 then
    raise exception 'FAIL: 1000 input and 300 output should be 250 microdollars, got %', v_cost;
  end if;

  v_cost := public.ai_quote_max_cost(
    'claude-haiku-4-5-20251001',
    v_price,
    'anthropic',
    '{"input":1000000}'::jsonb
  );
  if v_cost <> 1000000 then
    raise exception 'FAIL: Haiku 4.5 input rate was dropped, got %', v_cost;
  end if;

  begin
    perform public.ai_quote_max_cost('claude-missing-model', v_price, 'anthropic', '{"input":1}'::jsonb);
    raise exception 'FAIL: missing model should fail closed';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '22023' then
        raise exception 'FAIL: missing model expected 22023, got % %', sqlstate, sqlerrm;
      end if;
  end;

  insert into auth.users (id) values (v_user);
  insert into public.user_profiles (id, subscription_status, is_admin)
  values (v_user, 'active', false);

  select * into r from public.ai_reserve(
    p_account_tier => 'paid',
    p_config_version_id => v_cfg,
    p_feature_class => 'optional',
    p_idempotency_key => 'haiku-55-quote',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":1000,"output":300}'::jsonb,
    p_as_of => '2026-11-24 18:00:00+00',
    p_user_id => v_user
  );
  if r.status <> 'reserved' or r.acquired is not true or r.reserved_customer_microdollars <> 250 then
    raise exception 'FAIL: reserve claude-haiku-5-5 %', r;
  end if;

  perform public.ai_dispatch(r.request_id);
  select * into r from public.ai_settle(r.request_id, '{"input":800,"output":40}'::jsonb);
  if r.status <> 'settled' then
    raise exception 'FAIL: settle claude-haiku-5-5 %', r;
  end if;
end $$;

rollback;
