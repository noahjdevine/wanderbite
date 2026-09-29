-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '30s';

create function pg_temp.expect(cond boolean, msg text)
returns void
language plpgsql
as $$
begin
  if cond is not true then
    raise exception 'FAIL: %', msg;
  end if;
end;
$$;

create function pg_temp.make_version(
  p_id uuid,
  p_restaurant uuid,
  p_discount integer,
  p_cap integer,
  p_until timestamptz
) returns void
language plpgsql
as $$
begin
  insert into public.offer_versions (
    id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
    capacity_timezone, capacity_window_kind, capacity_max_redemptions
  ) values (
    p_id, p_restaurant, 'America/Chicago', now() - interval '1 day', p_until,
    jsonb_build_array(jsonb_build_object('threshold_cents', 4000, 'discount_cents', p_discount)),
    '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', p_cap
  );
  update public.restaurants
  set current_offer_version_id = p_id, status = 'active'
  where id = p_restaurant;
end;
$$;

create function pg_temp.put_cycle(p_id uuid, p_user uuid, p_month date)
returns void
language plpgsql
as $$
begin
  insert into public.challenge_cycles (id, user_id, cycle_month, status, swap_count_used)
  values (p_id, p_user, p_month, 'active', 0);
end;
$$;

create function pg_temp.put_linked(
  p_item uuid,
  p_credit uuid,
  p_user uuid,
  p_cycle uuid,
  p_restaurant uuid,
  p_version uuid,
  p_slot integer,
  p_period date,
  p_expires timestamptz,
  p_deadline timestamptz
) returns void
language plpgsql
as $$
begin
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
  ) values (
    p_item, p_cycle, p_restaurant, p_slot, 'assigned', p_version, now(), p_deadline
  );
  insert into public.entitlement_credits (
    id, user_id, issue_period, slot_number, status, challenge_item_id, expires_at
  ) values (
    p_credit, p_user, p_period, p_slot, 'linked', p_item, p_expires
  );
  update public.challenge_items set credit_id = p_credit where id = p_item;
end;
$$;

do $$
declare
  market uuid := 'e2c50000-0000-4000-8000-000000000010';
  u_main uuid := 'e2c50000-0000-4000-8000-000000000001';
  u_pair uuid := 'e2c50000-0000-4000-8000-000000000002';
  u_t2 uuid := 'e2c50000-0000-4000-8000-000000000003';
  u_low uuid := 'e2c50000-0000-4000-8000-000000000004';
  u_cap uuid := 'e2c50000-0000-4000-8000-000000000005';
  u_xmonth uuid := 'e2c50000-0000-4000-8000-000000000006';
  u_legacy uuid := 'e2c50000-0000-4000-8000-000000000007';
  u_refuse uuid := 'e2c50000-0000-4000-8000-000000000008';
  u_hop uuid := 'e2c50000-0000-4000-8000-000000000009';
  u_gap uuid := 'e2c50000-0000-4000-8000-00000000000a';
  u_bad uuid := 'e2c50000-0000-4000-8000-00000000000b';
  u_past uuid := 'e2c50000-0000-4000-8000-00000000000c';
  u_cross uuid := 'e2c50000-0000-4000-8000-00000000000d';
  u_inactive uuid := 'e2c50000-0000-4000-8000-00000000000e';
  u_flat uuid := 'e2c50000-0000-4000-8000-00000000000f';
  u_roll uuid := 'e2c50000-0000-4000-8000-000000000011';
  u_holder uuid := 'e2c50000-0000-4000-8000-000000000012';
  r_a uuid := 'e2c50000-0000-4000-8000-000000000101';
  r_b uuid := 'e2c50000-0000-4000-8000-000000000102';
  r_c uuid := 'e2c50000-0000-4000-8000-000000000103';
  r_pair_sib uuid := 'e2c50000-0000-4000-8000-000000000104';
  r_pair_repl uuid := 'e2c50000-0000-4000-8000-000000000105';
  r_low uuid := 'e2c50000-0000-4000-8000-000000000106';
  r_t2 uuid := 'e2c50000-0000-4000-8000-000000000107';
  r_past uuid := 'e2c50000-0000-4000-8000-000000000108';
  r_flat uuid := 'e2c50000-0000-4000-8000-000000000109';
  r_cap uuid := 'e2c50000-0000-4000-8000-00000000010a';
  r_leg1 uuid := 'e2c50000-0000-4000-8000-00000000010b';
  r_leg2 uuid := 'e2c50000-0000-4000-8000-00000000010c';
  r_leg3 uuid := 'e2c50000-0000-4000-8000-00000000010d';
  v_a uuid := 'e2c50000-0000-4000-8000-000000000201';
  v_b uuid := 'e2c50000-0000-4000-8000-000000000202';
  v_c uuid := 'e2c50000-0000-4000-8000-000000000203';
  v_pair_sib uuid := 'e2c50000-0000-4000-8000-000000000204';
  v_pair_repl uuid := 'e2c50000-0000-4000-8000-000000000205';
  v_low uuid := 'e2c50000-0000-4000-8000-000000000206';
  v_t2 uuid := 'e2c50000-0000-4000-8000-000000000207';
  v_past uuid := 'e2c50000-0000-4000-8000-000000000208';
  v_cap uuid := 'e2c50000-0000-4000-8000-00000000020a';
  chicago date;
  prev date;
  t1 timestamptz;
  t2 timestamptz;
  long_until timestamptz;
  past_deadline timestamptz;
  def text;
  swapped record;
  again record;
  from_b record;
  saved_credit uuid;
  credit_period date;
  credit_slot smallint;
  credit_expires timestamptz;
  successor uuid;
  hop_c uuid;
begin
  chicago := public.chicago_month_start(now());
  prev := (chicago - interval '1 month')::date;
  t1 := (prev + interval '1 month')::timestamp at time zone 'America/Chicago';
  t2 := (prev + interval '2 months')::timestamp at time zone 'America/Chicago';
  long_until := now() + interval '400 days';
  past_deadline := now() + interval '2 days';
  perform pg_temp.expect(t1 <= now(), 'T1 is not already due');
  perform pg_temp.expect(t2 > now() and t2 < now() + interval '840 hours', 'T2 is not a shortened future window');

  def := pg_get_functiondef('public.swap_linked_credit_item(uuid,uuid,uuid)'::regprocedure);
  perform pg_temp.expect(
    position('set credit_id = null' in def) > 0
    and position('set credit_id = null' in def) < position('set challenge_item_id = new_item_id' in def)
    and position('set challenge_item_id = new_item_id' in def) < position('set credit_id = credit.id' in def),
    'credit detach order'
  );
  perform pg_temp.expect(def not like '%swap_count_used%', 'credits swap touches swap_count_used');
  perform pg_temp.expect(
    position('least(v_now + interval ''840 hours'', credit.expires_at)' in def) > 0
    and position('least(source.redemption_deadline, v_now + interval ''840 hours'')' in def) > 0,
    'carried deadline expression'
  );
  perform pg_temp.expect(
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'swap_linked_credit_item'
        and p.prosecdef
        and pg_get_function_identity_arguments(p.oid) =
          'p_user_id uuid, p_item_id uuid, p_replacement_restaurant_id uuid'
        and exists (
          select 1 from unnest(p.proconfig) as cfg
          where cfg like 'search_path=pg_catalog, public%'
        )
    ),
    'swap_linked_credit_item signature or search_path'
  );
  perform pg_temp.expect(
    not has_function_privilege('anon', 'public.swap_linked_credit_item(uuid, uuid, uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.swap_linked_credit_item(uuid, uuid, uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.swap_linked_credit_item(uuid, uuid, uuid)', 'EXECUTE'),
    'swap_linked_credit_item grants'
  );
  perform pg_temp.expect(
    (select relrowsecurity from pg_class where oid = 'public.credit_swap_allowances'::regclass)
    and not has_table_privilege('anon', 'public.credit_swap_allowances', 'SELECT')
    and not has_table_privilege('anon', 'public.credit_swap_allowances', 'INSERT')
    and not has_table_privilege('authenticated', 'public.credit_swap_allowances', 'INSERT')
    and has_table_privilege('service_role', 'public.credit_swap_allowances', 'SELECT')
    and not has_table_privilege('service_role', 'public.credit_swap_allowances', 'INSERT')
    and not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = 'credit_swap_allowances'
    ),
    'allowance table grants'
  );
  perform pg_temp.expect(
    position('legacy_workflow' in pg_get_functiondef('public.swap_challenge_item(uuid,uuid,uuid)'::regprocedure)) > 0
    and position('workflow_version' in pg_get_functiondef('public.swap_challenge_item(uuid,uuid,uuid)'::regprocedure)) > 0,
    'legacy swap refuses credits profiles'
  );

  insert into auth.users (id) values
    (u_main), (u_pair), (u_t2), (u_low), (u_cap), (u_xmonth), (u_legacy), (u_refuse),
    (u_hop), (u_gap), (u_bad), (u_past), (u_cross), (u_inactive), (u_flat), (u_roll), (u_holder);
  insert into public.user_profiles (id, subscription_status, role, workflow_version) values
    (u_main, 'active', 'subscriber', 'credits'),
    (u_pair, 'active', 'subscriber', 'credits'),
    (u_t2, 'active', 'subscriber', 'credits'),
    (u_low, 'active', 'subscriber', 'credits'),
    (u_cap, 'active', 'subscriber', 'credits'),
    (u_xmonth, 'active', 'subscriber', 'credits'),
    (u_legacy, 'active', 'subscriber', 'legacy'),
    (u_refuse, 'active', 'subscriber', 'credits'),
    (u_hop, 'active', 'subscriber', 'credits'),
    (u_gap, 'active', 'subscriber', 'credits'),
    (u_bad, 'active', 'subscriber', 'credits'),
    (u_past, 'active', 'subscriber', 'credits'),
    (u_cross, 'active', 'subscriber', 'credits'),
    (u_inactive, 'inactive', 'subscriber', 'credits'),
    (u_flat, 'active', 'subscriber', 'credits'),
    (u_roll, 'active', 'subscriber', 'credits'),
    (u_holder, 'active', 'subscriber', 'legacy');
  insert into public.markets (id, name, slug) values (market, 'E02 Credit Swaps', 'e02-credit-swaps');
  insert into public.restaurants (id, name, status, market_id) values
    (r_a, 'E02S A', 'active', market),
    (r_b, 'E02S B', 'active', market),
    (r_c, 'E02S C', 'active', market),
    (r_pair_sib, 'E02S Pair Sib', 'active', market),
    (r_pair_repl, 'E02S Pair Repl', 'active', market),
    (r_low, 'E02S Low', 'active', market),
    (r_t2, 'E02S T2', 'active', market),
    (r_past, 'E02S Past', 'active', market),
    (r_flat, 'E02S Flat', 'active', market),
    (r_cap, 'E02S Cap', 'active', market),
    (r_leg1, 'E02S Leg 1', 'active', market),
    (r_leg2, 'E02S Leg 2', 'active', market),
    (r_leg3, 'E02S Leg 3', 'active', market);
  insert into public.restaurant_offers (restaurant_id, active, discount_amount_cents, min_spend_cents) values
    (r_flat, true, 2000, 4000),
    (r_leg1, true, 1000, 4000),
    (r_leg2, true, 1000, 4000),
    (r_leg3, true, 1000, 4000);
  perform pg_temp.make_version(v_a, r_a, 2000, 80, long_until);
  perform pg_temp.make_version(v_b, r_b, 2000, 80, long_until);
  perform pg_temp.make_version(v_c, r_c, 2000, 80, long_until);
  perform pg_temp.make_version(v_pair_sib, r_pair_sib, 1000, 20, long_until);
  perform pg_temp.make_version(v_pair_repl, r_pair_repl, 999, 20, long_until);
  perform pg_temp.make_version(v_low, r_low, 1999, 20, long_until);
  perform pg_temp.make_version(v_t2, r_t2, 2000, 20, t2 + interval '1 hour');
  perform pg_temp.make_version(v_past, r_past, 2000, 20, past_deadline + interval '1 hour');
  perform pg_temp.make_version(v_cap, r_cap, 2000, 1, long_until);
  perform pg_temp.expect(not public.version_selection_ok(v_t2, now()), 'T2 version covers 840 hours');
  perform pg_temp.expect(not public.version_selection_ok(v_past, now()), 'past version covers 840 hours');

  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-000000000501', u_main, chicago);
  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-000000000502', u_main, prev);
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-000000000401', 'e2c50000-0000-4000-8000-000000000301',
    u_main, 'e2c50000-0000-4000-8000-000000000501', r_a, v_a, 1, chicago, now() + interval '60 days', now() + interval '20 days'
  );
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-000000000402', 'e2c50000-0000-4000-8000-000000000302',
    u_main, 'e2c50000-0000-4000-8000-000000000501', r_b, v_b, 2, chicago, now() + interval '60 days', now() + interval '20 days'
  );
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-000000000403', 'e2c50000-0000-4000-8000-000000000303',
    u_main, 'e2c50000-0000-4000-8000-000000000502', r_b, v_b, 1, prev, t2, now() + interval '20 days'
  );
  select id, issue_period, slot_number, expires_at
    into saved_credit, credit_period, credit_slot, credit_expires
  from public.entitlement_credits
  where id = 'e2c50000-0000-4000-8000-000000000301';

  select * into swapped from public.swap_linked_credit_item(
    u_main, 'e2c50000-0000-4000-8000-000000000401', r_c
  );
  perform pg_temp.expect(swapped.outcome = 'created', 'current swap ' || swapped.outcome);
  successor := swapped.replacement_item_id;
  perform pg_temp.expect(
    (select ci.credit_id from public.challenge_items ci where ci.id = successor) = saved_credit
    and (select ci.credit_id from public.challenge_items ci where ci.id = 'e2c50000-0000-4000-8000-000000000401') is null
    and (select ec.challenge_item_id from public.entitlement_credits ec where ec.id = saved_credit) = successor
    and (select ec.issue_period from public.entitlement_credits ec where ec.id = saved_credit) = credit_period
    and (select ec.slot_number from public.entitlement_credits ec where ec.id = saved_credit) = credit_slot
    and (select ec.expires_at from public.entitlement_credits ec where ec.id = saved_credit) = credit_expires
    and (select ec.id from public.entitlement_credits ec where ec.challenge_item_id = successor) = saved_credit,
    'current credit move'
  );
  perform pg_temp.expect(
    (select count(*) from public.credit_swap_allowances where user_id = u_main and swap_month = chicago) = 1
    and (select source_item_id from public.credit_swap_allowances where user_id = u_main) =
      'e2c50000-0000-4000-8000-000000000401'
    and (select swap_count_used from public.challenge_cycles where id = 'e2c50000-0000-4000-8000-000000000501') = 0,
    'current allowance'
  );
  perform pg_temp.expect(
    (select count(*) from public.challenge_items ci where ci.credit_id = saved_credit) = 1,
    'one credit holder after create'
  );
  begin
    update public.challenge_items as ci
    set credit_id = saved_credit
    where ci.id = 'e2c50000-0000-4000-8000-000000000402';
    raise exception 'FAIL: second credit_id was accepted';
  exception
    when unique_violation then
      null;
  end;
  perform pg_temp.expect(
    (select count(*) from public.challenge_items ci where ci.credit_id = saved_credit) = 1
    and (select credit_id from public.challenge_items where id = 'e2c50000-0000-4000-8000-000000000401') is null,
    'unique credit index still one holder'
  );

  select * into swapped from public.swap_linked_credit_item(
    u_main, 'e2c50000-0000-4000-8000-000000000403', r_c
  );
  perform pg_temp.expect(swapped.outcome = 'swap_exhausted', 'monthly cap ' || swapped.outcome);
  perform pg_temp.expect(
    (select status from public.challenge_items where id = 'e2c50000-0000-4000-8000-000000000403') = 'assigned'
    and (select credit_id from public.challenge_items where id = 'e2c50000-0000-4000-8000-000000000403') =
      'e2c50000-0000-4000-8000-000000000303'
    and (select count(*) from public.credit_swap_allowances where user_id = u_main) = 1,
    'exhausted carried item unchanged'
  );

  select * into again from public.swap_linked_credit_item(
    u_main, 'e2c50000-0000-4000-8000-000000000401', null
  );
  perform pg_temp.expect(
    again.outcome = 'existing'
    and again.replacement_item_id = successor
    and again.source_item_id = 'e2c50000-0000-4000-8000-000000000401',
    'idempotent retry ' || again.outcome
  );
  perform pg_temp.expect(
    (select count(*) from public.credit_swap_allowances where user_id = u_main) = 1
    and (select ec.challenge_item_id from public.entitlement_credits ec where ec.id = saved_credit) = successor,
    'retry did not consume another allowance'
  );

  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-000000000511', u_xmonth, chicago);
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-000000000411', 'e2c50000-0000-4000-8000-000000000311',
    u_xmonth, 'e2c50000-0000-4000-8000-000000000511', r_a, v_a, 1, chicago, now() + interval '60 days', now() + interval '20 days'
  );
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-000000000412', 'e2c50000-0000-4000-8000-000000000312',
    u_xmonth, 'e2c50000-0000-4000-8000-000000000511', r_b, v_b, 2, chicago, now() + interval '60 days', now() + interval '20 days'
  );
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status
  ) values (
    'e2c50000-0000-4000-8000-000000000413', 'e2c50000-0000-4000-8000-000000000511', r_a, 1, 'swapped_out'
  );
  insert into public.credit_swap_allowances (user_id, swap_month, source_item_id)
  values (u_xmonth, prev, 'e2c50000-0000-4000-8000-000000000413');
  select * into swapped from public.swap_linked_credit_item(
    u_xmonth, 'e2c50000-0000-4000-8000-000000000411', r_c
  );
  perform pg_temp.expect(swapped.outcome = 'created', 'cross-month ' || swapped.outcome);
  perform pg_temp.expect(
    (select count(*) from public.credit_swap_allowances where user_id = u_xmonth and swap_month = prev) = 1
    and (select count(*) from public.credit_swap_allowances where user_id = u_xmonth and swap_month = chicago) = 1,
    'prior month allowance stayed'
  );

  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-000000000521', u_pair, chicago);
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-000000000421', 'e2c50000-0000-4000-8000-000000000321',
    u_pair, 'e2c50000-0000-4000-8000-000000000521', r_a, v_a, 1, chicago, now() + interval '60 days', now() + interval '20 days'
  );
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-000000000422', 'e2c50000-0000-4000-8000-000000000322',
    u_pair, 'e2c50000-0000-4000-8000-000000000521', r_pair_sib, v_pair_sib, 2, chicago, now() + interval '60 days', now() + interval '20 days'
  );
  select * into swapped from public.swap_linked_credit_item(u_pair, 'e2c50000-0000-4000-8000-000000000421', r_pair_repl);
  perform pg_temp.expect(swapped.outcome = 'pair_below_floor', 'pair floor ' || swapped.outcome);
  perform pg_temp.expect(
    (select status from public.challenge_items where id = 'e2c50000-0000-4000-8000-000000000421') = 'assigned'
    and (select credit_id from public.challenge_items where id = 'e2c50000-0000-4000-8000-000000000421') =
      'e2c50000-0000-4000-8000-000000000321'
    and not exists (select 1 from public.credit_swap_allowances where user_id = u_pair),
    'pair floor left the link'
  );

  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-000000000531', u_t2, prev);
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-000000000431', 'e2c50000-0000-4000-8000-000000000331',
    u_t2, 'e2c50000-0000-4000-8000-000000000531', r_a, v_a, 1, prev, t2, t2
  );
  select * into swapped from public.swap_linked_credit_item(u_t2, 'e2c50000-0000-4000-8000-000000000431', r_t2);
  perform pg_temp.expect(swapped.outcome = 'created', 'carried T2 ' || swapped.outcome);
  perform pg_temp.expect(
    (select redemption_deadline from public.challenge_items where id = swapped.replacement_item_id) = t2
    and (select redemption_deadline from public.challenge_items where id = swapped.replacement_item_id)
      < now() + interval '840 hours'
    and (select offer_version_id from public.challenge_items where id = swapped.replacement_item_id) = v_t2,
    'carried T2 shortened deadline'
  );

  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-000000000541', u_low, prev);
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-000000000441', 'e2c50000-0000-4000-8000-000000000341',
    u_low, 'e2c50000-0000-4000-8000-000000000541', r_a, v_a, 1, prev, t2, t2
  );
  select * into swapped from public.swap_linked_credit_item(u_low, 'e2c50000-0000-4000-8000-000000000441', r_low);
  perform pg_temp.expect(swapped.outcome = 'below_floor', 'carried floor ' || swapped.outcome);
  perform pg_temp.expect(
    (select status from public.challenge_items where id = 'e2c50000-0000-4000-8000-000000000441') = 'assigned'
    and (select challenge_item_id from public.entitlement_credits where id = 'e2c50000-0000-4000-8000-000000000341') =
      'e2c50000-0000-4000-8000-000000000441'
    and not exists (select 1 from public.credit_swap_allowances where user_id = u_low),
    'below floor unchanged'
  );

  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-000000000551', u_past, prev);
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-000000000451', 'e2c50000-0000-4000-8000-000000000351',
    u_past, 'e2c50000-0000-4000-8000-000000000551', r_a, v_a, 1, prev, t1, past_deadline
  );
  select * into swapped from public.swap_linked_credit_item(u_past, 'e2c50000-0000-4000-8000-000000000451', r_past);
  perform pg_temp.expect(swapped.outcome = 'created', 'past T1 carried ' || swapped.outcome);
  perform pg_temp.expect(
    (select redemption_deadline from public.challenge_items where id = swapped.replacement_item_id)
      = least(past_deadline, now() + interval '840 hours')
    and (select redemption_deadline from public.challenge_items where id = swapped.replacement_item_id) > now()
    and (select redemption_deadline from public.challenge_items where id = swapped.replacement_item_id)
      is distinct from least(now() + interval '840 hours', t1)
    and (select expires_at from public.entitlement_credits where id = 'e2c50000-0000-4000-8000-000000000351') = t1,
    'past T1 successor deadline'
  );
  perform pg_temp.expect(
    exists (
      select 1 from public.capacity_reservations
      where challenge_item_id = swapped.replacement_item_id and status = 'reserved'
    )
    and not exists (
      select 1 from public.capacity_reservations cr
      where cr.challenge_item_id = swapped.replacement_item_id
        and (cr.bucket_start::timestamp at time zone 'America/Chicago')
          >= (select ci.redemption_deadline from public.challenge_items ci where ci.id = swapped.replacement_item_id)
    ),
    'past T1 reservation uses stored deadline'
  );

  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-000000000561', u_holder, chicago);
  insert into public.challenge_items (id, cycle_id, restaurant_id, slot_number, status, offer_version_id)
  values (
    'e2c50000-0000-4000-8000-000000000461', 'e2c50000-0000-4000-8000-000000000561', r_cap, 1, 'assigned', v_cap
  );
  insert into public.capacity_reservations (
    challenge_item_id, offer_version_id, restaurant_id, capacity_timezone, bucket_start, status
  ) values
    ('e2c50000-0000-4000-8000-000000000461', v_cap, r_cap, 'America/Chicago', chicago, 'reserved'),
    ('e2c50000-0000-4000-8000-000000000461', v_cap, r_cap, 'America/Chicago', (chicago + interval '1 month')::date, 'reserved'),
    ('e2c50000-0000-4000-8000-000000000461', v_cap, r_cap, 'America/Chicago', (chicago + interval '2 months')::date, 'reserved');
  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-000000000562', u_cap, chicago);
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-000000000462', 'e2c50000-0000-4000-8000-000000000362',
    u_cap, 'e2c50000-0000-4000-8000-000000000562', r_a, v_a, 1, chicago, now() + interval '60 days', now() + interval '20 days'
  );
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-000000000463', 'e2c50000-0000-4000-8000-000000000363',
    u_cap, 'e2c50000-0000-4000-8000-000000000562', r_b, v_b, 2, chicago, now() + interval '60 days', now() + interval '20 days'
  );
  select * into swapped from public.swap_linked_credit_item(u_cap, 'e2c50000-0000-4000-8000-000000000462', r_cap);
  perform pg_temp.expect(swapped.outcome = 'capacity_full', 'capacity ' || swapped.outcome);
  perform pg_temp.expect(
    (select status from public.challenge_items where id = 'e2c50000-0000-4000-8000-000000000462') = 'assigned'
    and (select credit_id from public.challenge_items where id = 'e2c50000-0000-4000-8000-000000000462') =
      'e2c50000-0000-4000-8000-000000000362'
    and (select challenge_item_id from public.entitlement_credits where id = 'e2c50000-0000-4000-8000-000000000362') =
      'e2c50000-0000-4000-8000-000000000462'
    and not exists (select 1 from public.credit_swap_allowances where user_id = u_cap),
    'capacity full restored the link'
  );

  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-000000000571', u_legacy, chicago);
  insert into public.challenge_items (id, cycle_id, restaurant_id, slot_number, status) values
    ('e2c50000-0000-4000-8000-000000000471', 'e2c50000-0000-4000-8000-000000000571', r_leg1, 1, 'assigned'),
    ('e2c50000-0000-4000-8000-000000000472', 'e2c50000-0000-4000-8000-000000000571', r_leg2, 2, 'assigned');
  select * into swapped from public.swap_linked_credit_item(u_legacy, 'e2c50000-0000-4000-8000-000000000471', r_leg3);
  perform pg_temp.expect(swapped.outcome = 'legacy_workflow', 'legacy function gate ' || swapped.outcome);
  perform pg_temp.expect(
    (select swap_count_used from public.challenge_cycles where id = 'e2c50000-0000-4000-8000-000000000571') = 0,
    'legacy gate incremented swap_count'
  );
  select * into swapped from public.swap_challenge_item(u_legacy, 'e2c50000-0000-4000-8000-000000000471', r_leg3);
  perform pg_temp.expect(swapped.outcome = 'created', 'legacy swap ' || swapped.outcome);
  perform pg_temp.expect(
    (select swap_count_used from public.challenge_cycles where id = 'e2c50000-0000-4000-8000-000000000571') = 1,
    'legacy swap_count'
  );

  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-000000000581', u_refuse, chicago);
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-000000000481', 'e2c50000-0000-4000-8000-000000000381',
    u_refuse, 'e2c50000-0000-4000-8000-000000000581', r_a, v_a, 1, chicago, now() + interval '60 days', now() + interval '20 days'
  );
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-000000000482', 'e2c50000-0000-4000-8000-000000000382',
    u_refuse, 'e2c50000-0000-4000-8000-000000000581', r_b, v_b, 2, chicago, now() + interval '60 days', now() + interval '20 days'
  );
  select * into swapped from public.swap_challenge_item(u_refuse, 'e2c50000-0000-4000-8000-000000000481', r_c);
  perform pg_temp.expect(swapped.outcome = 'legacy_workflow', 'credits legacy rpc ' || swapped.outcome);
  perform pg_temp.expect(
    (select status from public.challenge_items where id = 'e2c50000-0000-4000-8000-000000000481') = 'assigned'
    and (select swap_count_used from public.challenge_cycles where id = 'e2c50000-0000-4000-8000-000000000581') = 0
    and not exists (select 1 from public.credit_swap_allowances where user_id = u_refuse),
    'legacy rpc mutated a credits item'
  );

  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-000000000591', u_hop, prev);
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, offer_version_id
  ) values (
    'e2c50000-0000-4000-8000-000000000491', 'e2c50000-0000-4000-8000-000000000591', r_a, 1, 'swapped_out', v_a
  );
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-000000000492', 'e2c50000-0000-4000-8000-000000000391',
    u_hop, 'e2c50000-0000-4000-8000-000000000591', r_b, v_b, 1, prev, t2, now() + interval '14 days'
  );
  update public.challenge_items
  set swapped_from_item_id = 'e2c50000-0000-4000-8000-000000000491'
  where id = 'e2c50000-0000-4000-8000-000000000492';
  insert into public.credit_swap_allowances (user_id, swap_month, source_item_id)
  values (u_hop, prev, 'e2c50000-0000-4000-8000-000000000491');
  select * into swapped from public.swap_linked_credit_item(
    u_hop, 'e2c50000-0000-4000-8000-000000000492', r_c
  );
  perform pg_temp.expect(swapped.outcome = 'created', 'hop B to C ' || swapped.outcome);
  hop_c := swapped.replacement_item_id;
  perform pg_temp.expect(
    (select credit_id from public.challenge_items where id = 'e2c50000-0000-4000-8000-000000000491') is null
    and (select credit_id from public.challenge_items where id = 'e2c50000-0000-4000-8000-000000000492') is null
    and (select credit_id from public.challenge_items where id = hop_c) = 'e2c50000-0000-4000-8000-000000000391'
    and (select challenge_item_id from public.entitlement_credits where id = 'e2c50000-0000-4000-8000-000000000391') = hop_c
    and (select issue_period from public.entitlement_credits where id = 'e2c50000-0000-4000-8000-000000000391') = prev
    and (select expires_at from public.entitlement_credits where id = 'e2c50000-0000-4000-8000-000000000391') = t2
    and (select slot_number from public.entitlement_credits where id = 'e2c50000-0000-4000-8000-000000000391') = 1
    and (select count(*) from public.credit_swap_allowances where user_id = u_hop and swap_month = chicago) = 1
    and (select count(*) from public.credit_swap_allowances where user_id = u_hop and swap_month = prev) = 1
    and (select swap_count_used from public.challenge_cycles where id = 'e2c50000-0000-4000-8000-000000000591') = 0,
    'hop credit sits on C'
  );
  select * into again from public.swap_linked_credit_item(
    u_hop, 'e2c50000-0000-4000-8000-000000000491', null
  );
  select * into from_b from public.swap_linked_credit_item(
    u_hop, 'e2c50000-0000-4000-8000-000000000492', null
  );
  perform pg_temp.expect(
    again.outcome = 'existing' and again.replacement_item_id = hop_c
    and from_b.outcome = 'existing' and from_b.replacement_item_id = hop_c
    and (select credit_id from public.challenge_items where id = 'e2c50000-0000-4000-8000-000000000492') is null,
    'multi-hop retry from A and B'
  );

  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-0000000005a1', u_gap, chicago);
  insert into public.challenge_items (id, cycle_id, restaurant_id, slot_number, status)
  values ('e2c50000-0000-4000-8000-0000000004a1', 'e2c50000-0000-4000-8000-0000000005a1', r_a, 1, 'swapped_out');
  select * into swapped from public.swap_linked_credit_item(u_gap, 'e2c50000-0000-4000-8000-0000000004a1', null);
  perform pg_temp.expect(swapped.outcome = 'malformed_lineage', 'gap chain ' || swapped.outcome);

  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-0000000005b1', u_bad, prev);
  insert into public.challenge_items (id, cycle_id, restaurant_id, slot_number, status) values
    ('e2c50000-0000-4000-8000-0000000004b1', 'e2c50000-0000-4000-8000-0000000005b1', r_a, 1, 'swapped_out'),
    ('e2c50000-0000-4000-8000-0000000004b2', 'e2c50000-0000-4000-8000-0000000005b1', r_b, 1, 'swapped_out');
  update public.challenge_items
  set swapped_from_item_id = 'e2c50000-0000-4000-8000-0000000004b1'
  where id = 'e2c50000-0000-4000-8000-0000000004b2';
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, swapped_from_item_id, offer_version_id, redemption_deadline
  ) values (
    'e2c50000-0000-4000-8000-0000000004b3', 'e2c50000-0000-4000-8000-0000000005b1', r_c, 1, 'assigned',
    'e2c50000-0000-4000-8000-0000000004b2', v_c, now() + interval '10 days'
  );
  insert into public.entitlement_credits (
    id, user_id, issue_period, slot_number, status, challenge_item_id, expires_at
  ) values (
    'e2c50000-0000-4000-8000-0000000003b1', u_bad, prev, 1, 'linked',
    'e2c50000-0000-4000-8000-0000000004b2', t2
  );
  update public.challenge_items
  set credit_id = 'e2c50000-0000-4000-8000-0000000003b1'
  where id = 'e2c50000-0000-4000-8000-0000000004b3';
  select * into swapped from public.swap_linked_credit_item(u_bad, 'e2c50000-0000-4000-8000-0000000004b1', null);
  perform pg_temp.expect(swapped.outcome = 'malformed_lineage', 'broken reciprocity ' || swapped.outcome);

  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-0000000005d1', u_cross, prev);
  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-0000000005d2', u_cross, chicago);
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-0000000004d1', 'e2c50000-0000-4000-8000-0000000003d1',
    u_cross, 'e2c50000-0000-4000-8000-0000000005d1', r_a, v_a, 1, prev, t2, now() + interval '14 days'
  );
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-0000000004d2', 'e2c50000-0000-4000-8000-0000000003d2',
    u_cross, 'e2c50000-0000-4000-8000-0000000005d2', r_b, v_b, 1, chicago, now() + interval '60 days', now() + interval '20 days'
  );
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-0000000004d3', 'e2c50000-0000-4000-8000-0000000003d3',
    u_cross, 'e2c50000-0000-4000-8000-0000000005d2', r_c, v_c, 2, chicago, now() + interval '60 days', now() + interval '20 days'
  );
  select * into swapped from public.swap_linked_credit_item(u_cross, 'e2c50000-0000-4000-8000-0000000004d2', r_a);
  perform pg_temp.expect(swapped.outcome = 'duplicate_restaurant', 'cross-cycle ' || swapped.outcome);
  perform pg_temp.expect(
    (select restaurant_id from public.challenge_items where id = 'e2c50000-0000-4000-8000-0000000004d2') = r_b
    and not exists (select 1 from public.credit_swap_allowances where user_id = u_cross),
    'cross-cycle duplicate wrote'
  );

  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-0000000005e1', u_inactive, chicago);
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-0000000004e1', 'e2c50000-0000-4000-8000-0000000003e1',
    u_inactive, 'e2c50000-0000-4000-8000-0000000005e1', r_a, v_a, 1, chicago, now() + interval '60 days', now() + interval '20 days'
  );
  select * into swapped from public.swap_linked_credit_item(u_inactive, 'e2c50000-0000-4000-8000-0000000004e1', r_c);
  perform pg_temp.expect(swapped.outcome = 'inactive_subscription', 'inactive ' || swapped.outcome);

  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-0000000005f1', u_flat, chicago);
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-0000000004f1', 'e2c50000-0000-4000-8000-0000000003f1',
    u_flat, 'e2c50000-0000-4000-8000-0000000005f1', r_a, v_a, 1, chicago, now() + interval '60 days', now() + interval '20 days'
  );
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-0000000004f2', 'e2c50000-0000-4000-8000-0000000003f2',
    u_flat, 'e2c50000-0000-4000-8000-0000000005f1', r_b, v_b, 2, chicago, now() + interval '60 days', now() + interval '20 days'
  );
  select * into swapped from public.swap_linked_credit_item(u_flat, 'e2c50000-0000-4000-8000-0000000004f1', r_flat);
  perform pg_temp.expect(swapped.outcome = 'invalid_restaurants', 'flat-only ' || swapped.outcome);
  perform pg_temp.expect(
    (select status from public.challenge_items where id = 'e2c50000-0000-4000-8000-0000000004f1') = 'assigned'
    and not exists (select 1 from public.credit_swap_allowances where user_id = u_flat),
    'flat-only wrote'
  );

  perform pg_temp.put_cycle('e2c50000-0000-4000-8000-0000000005c1', u_roll, chicago);
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-0000000004c1', 'e2c50000-0000-4000-8000-0000000003c1',
    u_roll, 'e2c50000-0000-4000-8000-0000000005c1', r_a, v_a, 1, chicago, now() + interval '60 days', now() + interval '20 days'
  );
  perform pg_temp.put_linked(
    'e2c50000-0000-4000-8000-0000000004c2', 'e2c50000-0000-4000-8000-0000000003c2',
    u_roll, 'e2c50000-0000-4000-8000-0000000005c1', r_b, v_b, 2, chicago, now() + interval '60 days', now() + interval '20 days'
  );
  create table public.e02_force_swap_fail (id int primary key);
  insert into public.e02_force_swap_fail values (1);
  create function public.e02_force_swap_fail()
  returns trigger
  language plpgsql
  as $fn$
  begin
    if new.swapped_from_item_id is not null
       and exists (select 1 from public.e02_force_swap_fail)
    then
      raise exception 'E02_TEST_FORCE_SWAP_ROLLBACK';
    end if;
    return new;
  end;
  $fn$;
  create trigger e02_force_swap_fail_trg
    before insert on public.challenge_items
    for each row execute function public.e02_force_swap_fail();
  begin
    perform public.swap_linked_credit_item(u_roll, 'e2c50000-0000-4000-8000-0000000004c1', r_c);
    raise exception 'FAIL: forced rollback did not raise';
  exception
    when others then
      if sqlerrm not like '%E02_TEST_FORCE_SWAP_ROLLBACK%' then
        raise;
      end if;
  end;
  perform pg_temp.expect(
    (select status from public.challenge_items where id = 'e2c50000-0000-4000-8000-0000000004c1') = 'assigned'
    and (select credit_id from public.challenge_items where id = 'e2c50000-0000-4000-8000-0000000004c1') =
      'e2c50000-0000-4000-8000-0000000003c1'
    and (select challenge_item_id from public.entitlement_credits where id = 'e2c50000-0000-4000-8000-0000000003c1') =
      'e2c50000-0000-4000-8000-0000000004c1'
    and not exists (select 1 from public.credit_swap_allowances where user_id = u_roll)
    and not exists (
      select 1 from public.challenge_items
      where swapped_from_item_id = 'e2c50000-0000-4000-8000-0000000004c1'
    ),
    'forced rollback restored source'
  );
  drop trigger e02_force_swap_fail_trg on public.challenge_items;
  drop function public.e02_force_swap_fail();
  drop table public.e02_force_swap_fail;
end;
$$;

select 'PASS: E02 credit-safe swaps, lineage, deadlines, grants, forced rollback';
rollback;
