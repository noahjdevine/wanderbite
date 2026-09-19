-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '30s';

insert into auth.users (id) values
  ('c2000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000002');
insert into public.user_profiles (id, subscription_status, is_admin) values
  ('c2000000-0000-4000-8000-000000000001', 'active', false),
  ('c2000000-0000-4000-8000-000000000002', 'inactive', false);

do $$
declare
  v_price uuid := 'a1000000-0000-4000-8000-00000000ae01';
  v_cfg uuid := 'a1000000-0000-4000-8000-00000000ae02';
  v_model text := 'claude-haiku-4-5-20251001';
  v_as timestamptz := '2026-09-19 17:00:00+00';
  v_paid uuid := 'c2000000-0000-4000-8000-000000000001';
  v_free uuid := 'c2000000-0000-4000-8000-000000000002';
  r record;
  r2 record;
  v_fair record;
  v_head integer;
  v_payload jsonb := '{"restaurantId":"11111111-1111-4111-8111-111111111111","selectionMode":"ai"}'::jsonb;
  v_targets jsonb;
begin
  -- In-flight guest request: transfer must rewrite guest_session → account.
  select * into r from public.ai_reserve(
    p_account_tier => 'guest',
    p_config_version_id => v_cfg,
    p_feature_class => 'guest',
    p_idempotency_key => 'g13a2-guest-inflight',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":100}'::jsonb,
    p_as_of => v_as,
    p_guest_id => 'guest-a2-inflight'
  );
  if r.status <> 'reserved' then
    raise exception 'FAIL: guest inflight reserve %', r;
  end if;
  perform public.ai_dispatch(r.request_id);

  select * into r2 from public.ai_transfer_guest_to_account('guest-a2-inflight', v_paid);
  if r2.already_claimed is not false or r2.transferred_customer_microdollars < 1 then
    raise exception 'FAIL: inflight transfer %', r2;
  end if;

  select bucket_targets into v_targets
  from public.ai_requests
  where id = r.request_id;
  if v_targets::text like '%guest_session%' then
    raise exception 'FAIL: inflight targets still guest_session %', v_targets;
  end if;
  if v_targets::text not like '%"k": "account"%'
     and v_targets::text not like '%"k":"account"%' then
    raise exception 'FAIL: inflight targets missing account %', v_targets;
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_targets) x
    where x->>'k' = 'account' and coalesce((x->>'t')::boolean, false)
  ) then
    raise exception 'FAIL: rewritten account target must not consume turns';
  end if;

  -- Settle after rewrite must debit the account bucket, not guest_session.
  select * into r2 from public.ai_settle(r.request_id, '{"input":80}'::jsonb);
  if r2.status <> 'settled' then
    raise exception 'FAIL: settle after transfer %', r2;
  end if;
  if exists (
    select 1 from public.ai_bucket_balances
    where bucket_kind = 'guest_session'
      and bucket_key = 'guest-a2-inflight'
      and (
        customer_reserved <> 0
        or customer_consumed <> 0
        or platform_reserved <> 0
        or platform_consumed <> 0
      )
  ) then
    raise exception 'FAIL: guest_session leftover after transferred settle';
  end if;
  if not exists (
    select 1 from public.ai_bucket_balances
    where bucket_kind = 'account'
      and bucket_key = v_paid::text
      and customer_consumed = 80
      and platform_consumed = 80
  ) then
    raise exception 'FAIL: account did not absorb transferred settle';
  end if;

  -- Stale reserved → failed_before_dispatch
  select * into r from public.ai_reserve(
    p_account_tier => 'paid',
    p_config_version_id => v_cfg,
    p_feature_class => 'optional',
    p_idempotency_key => 'g13a2-stale-reserved',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":10}'::jsonb,
    p_as_of => v_as,
    p_user_id => v_paid
  );
  update public.ai_requests set updated_at = now() - interval '20 minutes' where id = r.request_id;
  select * into r2 from public.ai_recover_stale_requests(now() - interval '15 minutes', 25)
    where request_id = r.request_id;
  if r2.previous_status <> 'reserved' or r2.status <> 'failed_before_dispatch' then
    raise exception 'FAIL: stale reserved recovery %', r2;
  end if;

  -- Stale dispatched → assumed_spent + customer release
  select * into r from public.ai_reserve(
    p_account_tier => 'paid',
    p_config_version_id => v_cfg,
    p_feature_class => 'optional',
    p_idempotency_key => 'g13a2-stale-dispatched',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":10}'::jsonb,
    p_as_of => v_as,
    p_user_id => v_paid
  );
  perform public.ai_dispatch(r.request_id);
  update public.ai_requests set updated_at = now() - interval '20 minutes' where id = r.request_id;
  select * into r2 from public.ai_recover_stale_requests(now() - interval '15 minutes', 25)
    where request_id = r.request_id;
  if r2.previous_status <> 'dispatched' or r2.status <> 'assumed_spent' then
    raise exception 'FAIL: stale dispatched recovery %', r2;
  end if;
  if (
    select customer_released_at from public.ai_requests where id = r.request_id
  ) is null then
    raise exception 'FAIL: stale dispatched must release customer';
  end if;

  -- Payload store is idempotent and bounded
  select * into r from public.ai_store_result_payload(r.request_id, v_payload);
  if r.stored is not true then
    raise exception 'FAIL: first payload store %', r;
  end if;
  select * into r2 from public.ai_store_result_payload(
    r.request_id,
    '{"restaurantId":"22222222-2222-4222-8222-222222222222","selectionMode":"random_fallback"}'::jsonb
  );
  if r2.stored is not false or r2.result_payload <> v_payload then
    raise exception 'FAIL: payload must not overwrite %', r2;
  end if;
  begin
    perform public.ai_store_result_payload(r.request_id, to_jsonb(repeat('x', 20000)));
    raise exception 'FAIL: oversized payload must reject';
  exception
    when others then
      if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '22023' then
        raise exception 'FAIL: oversized expected 22023, got % %', sqlstate, sqlerrm;
      end if;
  end;

  -- Feature-specific fair-use: paid optional vs whole account; guest has no reset date
  select * into v_fair from public.ai_fair_use_state(
    p_as_of => v_as,
    p_user_id => v_paid,
    p_feature_class => 'optional'
  );
  if v_fair.status is null or v_fair.resets_on is null then
    raise exception 'FAIL: paid optional fair use %', v_fair;
  end if;

  select * into r from public.ai_reserve(
    p_account_tier => 'free',
    p_config_version_id => v_cfg,
    p_feature_class => 'optional',
    p_idempotency_key => 'g13a2-free-opt',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":1}'::jsonb,
    p_as_of => v_as,
    p_user_id => v_free
  );
  if r.status <> 'reserved' then
    raise exception 'FAIL: free optional reserve %', r;
  end if;
  select * into v_fair from public.ai_fair_use_state(
    p_as_of => v_as,
    p_user_id => v_free,
    p_feature_class => 'optional'
  );
  if v_fair.resets_on is null then
    raise exception 'FAIL: free optional still has a monthly reset %', v_fair;
  end if;

  select * into r from public.ai_reserve(
    p_account_tier => 'guest',
    p_config_version_id => v_cfg,
    p_feature_class => 'guest',
    p_idempotency_key => 'g13a2-guest-fair',
    p_model_id => v_model,
    p_price_version_id => v_price,
    p_provider => 'anthropic',
    p_usage_units => '{"input":1}'::jsonb,
    p_as_of => v_as,
    p_guest_id => 'guest-a2-fair'
  );
  select * into v_fair from public.ai_fair_use_state(
    p_as_of => v_as,
    p_guest_id => 'guest-a2-fair'
  );
  if v_fair.resets_on is not null then
    raise exception 'FAIL: guest lifetime must not advertise monthly reset %', v_fair;
  end if;
  if v_fair.guest_turns_remaining is null or v_fair.guest_turns_remaining < 0 then
    raise exception 'FAIL: guest turns remaining %', v_fair;
  end if;

  select count(*) into v_head from public.ai_ops_headroom(v_as);
  if v_head < 1 then
    raise exception 'FAIL: ops headroom empty';
  end if;
  if not exists (
    select 1 from public.ai_ops_headroom(v_as)
    where bucket_kind = 'global' and remaining_microdollars >= 0
  ) then
    raise exception 'FAIL: ops headroom missing global remaining';
  end if;
end $$;

select 'PASS: G13-A2 transfer rewrite, stale recovery, fair-use, payload, headroom';
rollback;
