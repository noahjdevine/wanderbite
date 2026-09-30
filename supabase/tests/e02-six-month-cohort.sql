-- Disposable six-month cohort walk. Rolled back. Not the E04 supply-simulation gate.
-- History for closed months is seeded. issue_period_credits runs only for the open month.
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

create function pg_temp.put_spent(
  p_item uuid,
  p_credit uuid,
  p_user uuid,
  p_cycle uuid,
  p_restaurant uuid,
  p_version uuid,
  p_slot integer,
  p_period date,
  p_expires timestamptz,
  p_swapped_from uuid
) returns void
language plpgsql
as $$
begin
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, offer_version_id,
    assigned_at, redemption_deadline, swapped_from_item_id
  ) values (
    p_item, p_cycle, p_restaurant, p_slot, 'assigned', p_version,
    now() - interval '40 days', now() - interval '5 days', p_swapped_from
  );
  insert into public.entitlement_credits (
    id, user_id, issue_period, slot_number, status, challenge_item_id, expires_at
  ) values (
    p_credit, p_user, p_period, p_slot, 'spent', p_item, p_expires
  );
  update public.challenge_items set credit_id = p_credit where id = p_item;
end;
$$;

-- Fixture oracle only. The landed RPCs do not read these columns.
create function pg_temp.refuse_reason(p_user uuid, p_restaurant uuid, p_market uuid)
returns text
language plpgsql
stable
as $$
declare
  tags text[];
  dietary text[];
  allergies text[];
  excluded text[];
  rest_market uuid;
  verified_6 integer;
  verified_12 integer;
begin
  select coalesce(r.cuisine_tags, '{}'::text[]), r.market_id
    into tags, rest_market
  from public.restaurants r
  where r.id = p_restaurant;
  select coalesce(up.dietary_flags, '{}'::text[]), coalesce(up.allergy_flags, '{}'::text[])
    into dietary, allergies
  from public.user_profiles up
  where up.id = p_user;
  select coalesce(pref.excluded_cuisines, '{}'::text[])
    into excluded
  from public.user_preferences pref
  where pref.user_id = p_user;
  excluded := coalesce(excluded, '{}'::text[]);

  if 'vegan' = any(dietary)
     and exists (select 1 from unnest(tags) tag where lower(tag) = 'cheese') then
    return 'dietary_exclusion';
  end if;
  if exists (
    select 1
    from unnest(allergies) allergy
    join unnest(tags) tag on lower(tag) like '%' || lower(allergy) || '%'
      or lower(allergy) like '%' || lower(tag) || '%'
    where lower(allergy) = 'peanut'
  ) then
    return 'allergy';
  end if;
  if 'italian' = any(excluded)
     and exists (select 1 from unnest(tags) tag where lower(tag) like '%pasta%') then
    return 'excluded_cuisine';
  end if;

  select count(*) into verified_6
  from public.redemptions rd
  where rd.user_id = p_user
    and rd.restaurant_id = p_restaurant
    and rd.status = 'verified'
    and rd.verified_at >= now() - interval '6 months';
  select count(*) into verified_12
  from public.redemptions rd
  where rd.user_id = p_user
    and rd.restaurant_id = p_restaurant
    and rd.status = 'verified'
    and rd.verified_at >= now() - interval '12 months';
  if verified_6 > 0 or verified_12 >= 2 then
    return 'cooldown';
  end if;
  if rest_market is distinct from p_market then
    return 'outside_market';
  end if;
  return null;
end;
$$;

create table pg_temp.rejections (reason text not null);
create table pg_temp.cohort_report (line text not null);

do $$
declare
  market uuid := 'e26c0000-0000-4000-8000-000000000010';
  other_market uuid := 'e26c0000-0000-4000-8000-000000000011';
  happy uuid := 'e26c0000-0000-4000-8000-000000000001';
  thin uuid := 'e26c0000-0000-4000-8000-000000000002';
  holder uuid := 'e26c0000-0000-4000-8000-000000000003';
  r_pair_a uuid := 'e26c0000-0000-4000-8000-000000000101';
  r_pair_b uuid := 'e26c0000-0000-4000-8000-000000000102';
  r_carried_a uuid := 'e26c0000-0000-4000-8000-000000000103';
  r_carried_b uuid := 'e26c0000-0000-4000-8000-000000000104';
  r_low uuid := 'e26c0000-0000-4000-8000-000000000105';
  r_cheese uuid := 'e26c0000-0000-4000-8000-000000000106';
  r_peanut uuid := 'e26c0000-0000-4000-8000-000000000107';
  r_pasta uuid := 'e26c0000-0000-4000-8000-000000000108';
  r_other uuid := 'e26c0000-0000-4000-8000-000000000109';
  r_full uuid := 'e26c0000-0000-4000-8000-00000000010a';
  r_swap uuid := 'e26c0000-0000-4000-8000-00000000010b';
  r_floor_a uuid := 'e26c0000-0000-4000-8000-00000000010c';
  r_floor_b uuid := 'e26c0000-0000-4000-8000-00000000010d';
  r_cool uuid := 'e26c0000-0000-4000-8000-00000000010e';
  r_hist_5b uuid := 'e26c0000-0000-4000-8000-00000000010f';
  r_hist_4a uuid := 'e26c0000-0000-4000-8000-000000000111';
  r_hist_4b uuid := 'e26c0000-0000-4000-8000-000000000112';
  r_hist_2src uuid := 'e26c0000-0000-4000-8000-000000000113';
  r_hist_2succ uuid := 'e26c0000-0000-4000-8000-000000000114';
  r_hist_2b uuid := 'e26c0000-0000-4000-8000-000000000115';
  v_pair_a uuid := 'e26c0000-0000-4000-8000-000000000201';
  v_pair_b uuid := 'e26c0000-0000-4000-8000-000000000202';
  v_carried_a uuid := 'e26c0000-0000-4000-8000-000000000203';
  v_carried_b uuid := 'e26c0000-0000-4000-8000-000000000204';
  v_low uuid := 'e26c0000-0000-4000-8000-000000000205';
  v_cheese uuid := 'e26c0000-0000-4000-8000-000000000206';
  v_peanut uuid := 'e26c0000-0000-4000-8000-000000000207';
  v_pasta uuid := 'e26c0000-0000-4000-8000-000000000208';
  v_other uuid := 'e26c0000-0000-4000-8000-000000000209';
  v_full uuid := 'e26c0000-0000-4000-8000-00000000020a';
  v_swap uuid := 'e26c0000-0000-4000-8000-00000000020b';
  v_floor_a uuid := 'e26c0000-0000-4000-8000-00000000020c';
  v_floor_b uuid := 'e26c0000-0000-4000-8000-00000000020d';
  v_cool uuid := 'e26c0000-0000-4000-8000-00000000020e';
  v_hist_5b uuid := 'e26c0000-0000-4000-8000-00000000020f';
  v_hist_4a uuid := 'e26c0000-0000-4000-8000-000000000211';
  v_hist_4b uuid := 'e26c0000-0000-4000-8000-000000000212';
  v_hist_2src uuid := 'e26c0000-0000-4000-8000-000000000213';
  v_hist_2succ uuid := 'e26c0000-0000-4000-8000-000000000214';
  v_hist_2b uuid := 'e26c0000-0000-4000-8000-000000000215';
  c_p5_1 uuid := 'e26c0000-0000-4000-8000-000000000311';
  c_p5_2 uuid := 'e26c0000-0000-4000-8000-000000000312';
  c_p4_1 uuid := 'e26c0000-0000-4000-8000-000000000321';
  c_p4_2 uuid := 'e26c0000-0000-4000-8000-000000000322';
  c_p3_1 uuid := 'e26c0000-0000-4000-8000-000000000331';
  c_p3_2 uuid := 'e26c0000-0000-4000-8000-000000000332';
  c_p2_1 uuid := 'e26c0000-0000-4000-8000-000000000341';
  c_p2_2 uuid := 'e26c0000-0000-4000-8000-000000000342';
  c_p1_1 uuid := 'e26c0000-0000-4000-8000-000000000351';
  c_p1_2 uuid := 'e26c0000-0000-4000-8000-000000000352';
  i_p5_1 uuid := 'e26c0000-0000-4000-8000-000000000411';
  i_p5_2 uuid := 'e26c0000-0000-4000-8000-000000000412';
  i_p4_1 uuid := 'e26c0000-0000-4000-8000-000000000421';
  i_p4_2 uuid := 'e26c0000-0000-4000-8000-000000000422';
  i_p2_src uuid := 'e26c0000-0000-4000-8000-000000000431';
  i_p2_succ uuid := 'e26c0000-0000-4000-8000-000000000432';
  i_p2_2 uuid := 'e26c0000-0000-4000-8000-000000000433';
  i_holder uuid := 'e26c0000-0000-4000-8000-000000000441';
  cy5 uuid := 'e26c0000-0000-4000-8000-000000000511';
  cy4 uuid := 'e26c0000-0000-4000-8000-000000000521';
  cy2 uuid := 'e26c0000-0000-4000-8000-000000000531';
  cy_holder uuid := 'e26c0000-0000-4000-8000-000000000541';
  chicago date;
  p5 date;
  p4 date;
  p3 date;
  p2 date;
  p1 date;
  p0 date;
  t1_p1 timestamptz;
  t2_p1 timestamptz;
  t2_p3 timestamptz;
  t1_p0 timestamptz;
  long_until timestamptz;
  cool_verified timestamptz;
  reason text;
  rest uuid;
  rolled record;
  assigned record;
  linked record;
  issued text;
  carried_cycle uuid;
  current_cycle uuid;
  current_item uuid;
  carried_item uuid;
  successor uuid;
  saved_credit uuid;
  match_num integer;
  match_den integer;
  thin_num integer;
  thin_den integer;
  spend integer;
  n_dietary integer;
  n_allergy integer;
  n_excluded integer;
  n_cooldown integer;
  n_market integer;
  n_pair_floor integer;
  n_below integer;
  n_capacity integer;
  passers uuid[];
begin
  chicago := public.chicago_month_start(now());
  p0 := chicago;
  p1 := (chicago - interval '1 month')::date;
  p2 := (chicago - interval '2 months')::date;
  p3 := (chicago - interval '3 months')::date;
  p4 := (chicago - interval '4 months')::date;
  p5 := (chicago - interval '5 months')::date;
  perform pg_temp.expect(
    p5 = (public.chicago_month_start(now()) - interval '5 month')::date,
    'oldest period is five Chicago months back'
  );
  t1_p1 := (p1 + interval '1 month')::timestamp at time zone 'America/Chicago';
  t2_p1 := (p1 + interval '2 months')::timestamp at time zone 'America/Chicago';
  t2_p3 := (p3 + interval '2 months')::timestamp at time zone 'America/Chicago';
  t1_p0 := (p0 + interval '1 month')::timestamp at time zone 'America/Chicago';
  long_until := now() + interval '400 days';
  cool_verified := (p5 + interval '10 days')::timestamp at time zone 'America/Chicago';
  perform pg_temp.expect(t1_p1 <= now() and now() < t2_p1, 'N=1 is between T1 and T2');
  perform pg_temp.expect(now() >= t2_p3, 'N=3 T2 is already due');
  perform pg_temp.expect(
    cool_verified >= now() - interval '6 months' and cool_verified < now(),
    'N=5 redemption is inside six months'
  );

  insert into auth.users (id) values (happy), (thin), (holder);
  insert into public.user_profiles (
    id, subscription_status, role, workflow_version, dietary_flags, allergy_flags
  ) values
    (happy, 'active', 'subscriber', 'credits', array['vegan'], array['peanut']),
    (thin, 'active', 'subscriber', 'credits', array['vegan'], array['peanut']),
    (holder, 'active', 'subscriber', 'legacy', '{}', '{}');
  insert into public.user_preferences (user_id, excluded_cuisines) values
    (happy, array['italian']),
    (thin, array['italian']);
  insert into public.markets (id, name, slug) values
    (market, 'E02 Six Month Cohort', 'e02-six-month-cohort'),
    (other_market, 'E02 Six Month Other', 'e02-six-month-other');
  insert into public.restaurants (id, name, status, market_id, cuisine_tags) values
    (r_pair_a, 'E02 Cohort Pair A', 'active', market, array['salad']),
    (r_pair_b, 'E02 Cohort Pair B', 'active', market, array['salad']),
    (r_carried_a, 'E02 Cohort Carried A', 'active', market, array['grill']),
    (r_carried_b, 'E02 Cohort Carried B', 'active', market, array['seafood']),
    (r_low, 'E02 Cohort Low 1999', 'active', market, array['soup']),
    (r_cheese, 'E02 Cohort Cheese', 'active', market, array['cheese']),
    (r_peanut, 'E02 Cohort Peanut', 'active', market, array['peanut']),
    (r_pasta, 'E02 Cohort Pasta', 'active', market, array['pasta']),
    (r_other, 'E02 Cohort Other Market', 'active', other_market, array['salad']),
    (r_full, 'E02 Cohort Full Bucket', 'active', market, array['grill']),
    (r_swap, 'E02 Cohort Swap', 'active', market, array['seafood']),
    (r_floor_a, 'E02 Cohort Floor A', 'active', market, array['salad']),
    (r_floor_b, 'E02 Cohort Floor B', 'active', market, array['grill']),
    (r_cool, 'E02 Cohort Cooldown', 'active', market, array['salad']),
    (r_hist_5b, 'E02 Cohort Hist 5b', 'active', other_market, array['grill']),
    (r_hist_4a, 'E02 Cohort Hist 4a', 'active', other_market, array['grill']),
    (r_hist_4b, 'E02 Cohort Hist 4b', 'active', other_market, array['seafood']),
    (r_hist_2src, 'E02 Cohort Hist 2 Source', 'active', other_market, array['grill']),
    (r_hist_2succ, 'E02 Cohort Hist 2 Successor', 'active', other_market, array['seafood']),
    (r_hist_2b, 'E02 Cohort Hist 2b', 'active', other_market, array['salad']);
  perform pg_temp.make_version(v_pair_a, r_pair_a, 1000, 80, long_until);
  perform pg_temp.make_version(v_pair_b, r_pair_b, 1000, 80, long_until);
  perform pg_temp.make_version(v_carried_a, r_carried_a, 2000, 80, long_until);
  perform pg_temp.make_version(v_carried_b, r_carried_b, 2500, 80, long_until);
  perform pg_temp.make_version(v_low, r_low, 1999, 80, long_until);
  perform pg_temp.make_version(v_cheese, r_cheese, 2000, 80, long_until);
  perform pg_temp.make_version(v_peanut, r_peanut, 2000, 80, long_until);
  perform pg_temp.make_version(v_pasta, r_pasta, 2000, 80, long_until);
  perform pg_temp.make_version(v_other, r_other, 2000, 80, long_until);
  perform pg_temp.make_version(v_full, r_full, 2200, 1, long_until);
  perform pg_temp.make_version(v_swap, r_swap, 1500, 80, long_until);
  perform pg_temp.make_version(v_floor_a, r_floor_a, 999, 80, long_until);
  perform pg_temp.make_version(v_floor_b, r_floor_b, 999, 80, long_until);
  perform pg_temp.make_version(v_cool, r_cool, 2000, 80, long_until);
  perform pg_temp.make_version(v_hist_5b, r_hist_5b, 2000, 80, long_until);
  perform pg_temp.make_version(v_hist_4a, r_hist_4a, 2000, 80, long_until);
  perform pg_temp.make_version(v_hist_4b, r_hist_4b, 2000, 80, long_until);
  perform pg_temp.make_version(v_hist_2src, r_hist_2src, 2000, 80, long_until);
  perform pg_temp.make_version(v_hist_2succ, r_hist_2succ, 2000, 80, long_until);
  perform pg_temp.make_version(v_hist_2b, r_hist_2b, 2000, 80, long_until);
  perform pg_temp.expect(
    public.offer_lowest_tier_cents((select tiers from public.offer_versions where id = v_pair_a)) = 1000
    and public.offer_lowest_tier_cents((select tiers from public.offer_versions where id = v_pair_b)) = 1000
    and public.offer_lowest_tier_cents((select tiers from public.offer_versions where id = v_carried_a)) >= 2000
    and public.offer_lowest_tier_cents((select tiers from public.offer_versions where id = v_carried_b)) >= 2000
    and public.offer_lowest_tier_cents((select tiers from public.offer_versions where id = v_low)) = 1999
    and public.offer_lowest_tier_cents((select tiers from public.offer_versions where id = v_floor_a))
      + public.offer_lowest_tier_cents((select tiers from public.offer_versions where id = v_floor_b)) < 2000
    and public.offer_lowest_tier_cents((select tiers from public.offer_versions where id = v_swap)) >= 1000,
    'sealed floors'
  );

  insert into public.challenge_cycles (id, user_id, cycle_month, status, swap_count_used) values
    (cy5, happy, p5, 'completed', 0),
    (cy4, happy, p4, 'completed', 0),
    (cy2, happy, p2, 'completed', 0),
    (cy_holder, holder, p0, 'active', 0);
  perform pg_temp.put_spent(i_p5_1, c_p5_1, happy, cy5, r_cool, v_cool, 1, p5, t1_p1, null);
  perform pg_temp.put_spent(i_p5_2, c_p5_2, happy, cy5, r_hist_5b, v_hist_5b, 2, p5, t1_p1, null);
  perform pg_temp.put_spent(i_p4_1, c_p4_1, happy, cy4, r_hist_4a, v_hist_4a, 1, p4, t1_p1, null);
  perform pg_temp.put_spent(i_p4_2, c_p4_2, happy, cy4, r_hist_4b, v_hist_4b, 2, p4, t1_p1, null);
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at
  ) values (
    i_p2_src, cy2, r_hist_2src, 1, 'swapped_out', v_hist_2src, now() - interval '70 days'
  );
  perform pg_temp.put_spent(i_p2_succ, c_p2_1, happy, cy2, r_hist_2succ, v_hist_2succ, 1, p2, t1_p1, i_p2_src);
  perform pg_temp.put_spent(i_p2_2, c_p2_2, happy, cy2, r_hist_2b, v_hist_2b, 2, p2, t1_p1, null);
  insert into public.credit_swap_allowances (user_id, swap_month, source_item_id)
  values (happy, p2, i_p2_src);
  insert into public.entitlement_credits (
    id, user_id, issue_period, slot_number, status, expires_at
  ) values
    (c_p3_1, happy, p3, 1, 'pending', t2_p3),
    (c_p3_2, happy, p3, 2, 'pending', t2_p3),
    (c_p1_1, happy, p1, 1, 'pending', t1_p1),
    (c_p1_2, happy, p1, 2, 'pending', t1_p1);
  insert into public.redemptions (
    user_id, restaurant_id, challenge_item_id, token_hash, encrypted_code, code_iv,
    status, verified_at, expires_at
  ) values (
    happy, r_cool, i_p5_1, repeat('c1', 32), 'cipher', 'iviviviviviv',
    'verified', cool_verified, now() + interval '35 days'
  );
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
  ) values (
    i_holder, cy_holder, r_full, 1, 'assigned', v_full, now(), now() + interval '20 days'
  );
  insert into public.capacity_reservations (
    challenge_item_id, offer_version_id, restaurant_id, capacity_timezone, bucket_start, status
  ) values (
    i_holder, v_full, r_full, 'America/Chicago', chicago, 'reserved'
  );
  foreach rest in array array[
    r_pair_a, r_pair_b, r_carried_a, r_carried_b, r_low, r_full, r_swap, r_cool
  ] loop
    insert into public.redemptions (
      user_id, restaurant_id, token_hash, encrypted_code, code_iv, status, verified_at, expires_at
    ) values (
      thin, rest, lpad(replace(rest::text, '-', ''), 64, '0'), 'cipher', 'iviviviviviv',
      'verified', now() - interval '1 day', now() + interval '35 days'
    );
  end loop;

  -- N=2 is already spent, including the swap successor, before rollover.
  perform pg_temp.expect(
    (select status from public.entitlement_credits where id = c_p2_1) = 'spent'
    and (select challenge_item_id from public.entitlement_credits where id = c_p2_1) = i_p2_succ
    and (select credit_id from public.challenge_items where id = i_p2_succ) = c_p2_1
    and (select swapped_from_item_id from public.challenge_items where id = i_p2_succ) = i_p2_src
    and (select status from public.challenge_items where id = i_p2_src) = 'swapped_out'
    and (select credit_id from public.challenge_items where id = i_p2_src) is null
    and (select status from public.entitlement_credits where id = c_p2_2) = 'spent'
    and (select challenge_item_id from public.entitlement_credits where id = c_p2_2) = i_p2_2
    and (select credit_id from public.challenge_items where id = i_p2_2) = c_p2_2
    and (select swap_count_used from public.challenge_cycles where id = cy2) = 0
    and exists (
      select 1 from public.credit_swap_allowances
      where user_id = happy and swap_month = p2 and source_item_id = i_p2_src
    ),
    'N=2 spent links before rollover'
  );

  select * into rolled from public.rollover_credits(happy);
  perform pg_temp.expect(rolled.outcome = 'rolled' and rolled.exception_inserted is false, 'rollover ' || rolled.outcome);
  perform pg_temp.expect(
    (select status from public.entitlement_credits where id = c_p1_1) = 'pending'
    and (select status from public.entitlement_credits where id = c_p1_2) = 'pending'
    and (select challenge_item_id from public.entitlement_credits where id = c_p1_1) is null
    and (select challenge_item_id from public.entitlement_credits where id = c_p1_2) is null
    and (select expires_at from public.entitlement_credits where id = c_p1_1) = t2_p1
    and (select expires_at from public.entitlement_credits where id = c_p1_2) = t2_p1
    and (select issue_period from public.entitlement_credits where id = c_p1_1) = p1
    and (select slot_number from public.entitlement_credits where id = c_p1_1) = 1
    and (select slot_number from public.entitlement_credits where id = c_p1_2) = 2,
    'N=1 rolled to T2'
  );
  perform pg_temp.expect(
    (select status from public.entitlement_credits where id = c_p3_1) = 'expired'
    and (select status from public.entitlement_credits where id = c_p3_2) = 'expired'
    and (select challenge_item_id from public.entitlement_credits where id = c_p3_1) is null
    and (select challenge_item_id from public.entitlement_credits where id = c_p3_2) is null
    and (select expires_at from public.entitlement_credits where id = c_p3_1) = t2_p3
    and (select expires_at from public.entitlement_credits where id = c_p3_2) = t2_p3
    and (select expires_at from public.entitlement_credits where id = c_p3_1)
      is distinct from ((p3 + interval '3 months')::timestamp at time zone 'America/Chicago')
    and not exists (select 1 from public.challenge_cycles where user_id = happy and cycle_month = p3),
    'N=3 expired without a third month'
  );
  perform pg_temp.expect(
    (select status from public.entitlement_credits where id = c_p2_1) = 'spent'
    and (select challenge_item_id from public.entitlement_credits where id = c_p2_1) = i_p2_succ
    and not exists (select 1 from public.credit_rollover_exceptions where user_id = happy),
    'spent N=2 did not consume the carry cap'
  );

  -- Selector refusals while both carried credits are still pending. No RPC.
  foreach rest in array array[r_cheese, r_peanut, r_pasta, r_cool, r_other] loop
    reason := pg_temp.refuse_reason(happy, rest, market);
    perform pg_temp.expect(reason is not null, 'missing refusal');
    insert into pg_temp.rejections (reason) values (reason);
  end loop;
  perform pg_temp.expect(pg_temp.refuse_reason(happy, r_cheese, market) = 'dietary_exclusion', 'diet');
  perform pg_temp.expect(pg_temp.refuse_reason(happy, r_peanut, market) = 'allergy', 'allergy');
  perform pg_temp.expect(pg_temp.refuse_reason(happy, r_pasta, market) = 'excluded_cuisine', 'cuisine');
  perform pg_temp.expect(pg_temp.refuse_reason(happy, r_cool, market) = 'cooldown', 'cooldown');
  perform pg_temp.expect(pg_temp.refuse_reason(happy, r_other, market) = 'outside_market', 'market');
  perform pg_temp.expect(
    (select status from public.entitlement_credits where id = c_p1_1) = 'pending'
    and (select challenge_item_id from public.entitlement_credits where id = c_p1_1) is null
    and not exists (select 1 from public.challenge_cycles where user_id = happy and cycle_month = p1),
    'selector left the carried credit pending'
  );

  perform pg_temp.expect(pg_temp.refuse_reason(happy, r_low, market) is null, '1999 restaurant refused');
  select * into assigned from public.assign_carried_credit(happy, c_p1_1, market, r_low);
  perform pg_temp.expect(assigned.outcome = 'below_floor', 'below_floor ' || assigned.outcome);
  insert into pg_temp.rejections (reason) values ('below_floor');
  perform pg_temp.expect(
    (select status from public.entitlement_credits where id = c_p1_1) = 'pending'
    and (select challenge_item_id from public.entitlement_credits where id = c_p1_1) is null
    and not exists (select 1 from public.challenge_items where restaurant_id = r_low)
    and not exists (select 1 from public.challenge_cycles where user_id = happy and cycle_month = p1),
    'below_floor kept the credit pending'
  );

  perform pg_temp.expect(pg_temp.refuse_reason(happy, r_full, market) is null, 'full restaurant refused');
  select * into assigned from public.assign_carried_credit(happy, c_p1_1, market, r_full);
  perform pg_temp.expect(assigned.outcome = 'capacity_full', 'capacity_full ' || assigned.outcome);
  insert into pg_temp.rejections (reason) values ('capacity_full');
  perform pg_temp.expect(
    (select status from public.entitlement_credits where id = c_p1_1) = 'pending'
    and (select challenge_item_id from public.entitlement_credits where id = c_p1_1) is null
    and (select count(*) from public.capacity_reservations
      where restaurant_id = r_full and status = 'reserved') = 1
    and (select count(*) from public.challenge_items where restaurant_id = r_full) = 1,
    'capacity_full left the pre-seeded seat'
  );

  perform pg_temp.expect(
    pg_temp.refuse_reason(happy, r_carried_a, market) is null
    and pg_temp.refuse_reason(happy, r_carried_b, market) is null
    and r_carried_a is distinct from r_carried_b,
    'carried restaurants refused or identical'
  );
  select * into assigned from public.assign_carried_credit(happy, c_p1_1, market, r_carried_a);
  perform pg_temp.expect(assigned.outcome = 'linked', 'carried A ' || assigned.outcome);
  carried_cycle := assigned.cycle_id;
  select * into assigned from public.assign_carried_credit(happy, c_p1_2, market, r_carried_b);
  perform pg_temp.expect(
    assigned.outcome = 'linked' and assigned.cycle_id = carried_cycle,
    'carried B ' || assigned.outcome
  );
  select * into assigned from public.assign_carried_credit(happy, c_p1_1, market, r_carried_a);
  perform pg_temp.expect(assigned.outcome = 'existing' and assigned.cycle_id = carried_cycle, 'existing is not the floor proof');
  perform pg_temp.expect(
    (select count(*) from public.challenge_items where cycle_id = carried_cycle and status = 'assigned') = 2
    and (select count(distinct restaurant_id) from public.challenge_items where cycle_id = carried_cycle) = 2
    and (select swap_count_used from public.challenge_cycles where id = carried_cycle) = 0,
    'one origin cycle for both carried slots'
  );

  issued := public.issue_period_credits(happy, p0);
  perform pg_temp.expect(issued = 'created', 'issue ' || issued);
  issued := public.issue_period_credits(happy, p0);
  perform pg_temp.expect(issued = 'existing', 'reissue ' || issued);
  perform pg_temp.expect(
    (select count(*) from public.entitlement_credits where user_id = happy and issue_period = p0) = 2
    and (select count(*) from public.entitlement_credits
      where user_id = happy and issue_period = p0 and status = 'pending' and challenge_item_id is null
        and slot_number in (1, 2) and expires_at = t1_p0) = 2
    and not exists (select 1 from public.challenge_cycles where user_id = happy and cycle_month = p0),
    'open month has two pending credits'
  );

  perform pg_temp.expect(
    pg_temp.refuse_reason(happy, r_floor_a, market) is null
    and pg_temp.refuse_reason(happy, r_floor_b, market) is null,
    'under-floor pair refused by selector'
  );
  select * into linked from public.link_pending_credits(happy, p0, market, r_floor_a, r_floor_b);
  perform pg_temp.expect(linked.outcome = 'pair_below_floor' and linked.cycle_id is null, 'pair floor ' || linked.outcome);
  insert into pg_temp.rejections (reason) values ('pair_below_floor');
  perform pg_temp.expect(
    (select count(*) from public.entitlement_credits
      where user_id = happy and issue_period = p0 and status = 'pending' and challenge_item_id is null) = 2
    and not exists (select 1 from public.challenge_cycles where user_id = happy and cycle_month = p0),
    'under-floor pair stayed pending'
  );

  perform pg_temp.expect(
    pg_temp.refuse_reason(happy, r_pair_a, market) is null
    and pg_temp.refuse_reason(happy, r_pair_b, market) is null,
    '1000-cent pair refused'
  );
  select * into linked from public.link_pending_credits(happy, p0, market, r_pair_a, r_pair_b);
  perform pg_temp.expect(linked.outcome = 'linked', 'current link ' || linked.outcome);
  current_cycle := linked.cycle_id;
  perform pg_temp.expect(current_cycle is not null and current_cycle is distinct from carried_cycle, 'two cycles');
  perform pg_temp.expect(
    (select count(*) from public.challenge_items ci
      join public.offer_versions v on v.id = ci.offer_version_id
      where ci.cycle_id = current_cycle
        and ci.slot_number in (1, 2)
        and ci.status = 'assigned'
        and public.offer_lowest_tier_cents(v.tiers) = 1000) = 2
    and (select sum(public.offer_lowest_tier_cents(v.tiers))
      from public.challenge_items ci
      join public.offer_versions v on v.id = ci.offer_version_id
      where ci.cycle_id = current_cycle and ci.status = 'assigned') = 2000,
    'exact combined 2000 cent floor'
  );
  perform pg_temp.expect(
    (select ci.credit_id from public.challenge_items ci
      join public.entitlement_credits ec on ec.challenge_item_id = ci.id
      where ec.user_id = happy and ec.issue_period = p0 and ec.slot_number = 1) =
    (select id from public.entitlement_credits where user_id = happy and issue_period = p0 and slot_number = 1)
    and (select ci.credit_id from public.challenge_items ci
      join public.entitlement_credits ec on ec.challenge_item_id = ci.id
      where ec.user_id = happy and ec.issue_period = p0 and ec.slot_number = 2) =
    (select id from public.entitlement_credits where user_id = happy and issue_period = p0 and slot_number = 2),
    'reciprocal current links'
  );

  select ci.id, ec.id into current_item, saved_credit
  from public.challenge_items ci
  join public.entitlement_credits ec on ec.challenge_item_id = ci.id
  where ec.user_id = happy and ec.issue_period = p0 and ec.slot_number = 1;
  select * into assigned from public.swap_linked_credit_item(happy, current_item, r_swap);
  perform pg_temp.expect(assigned.outcome = 'created', 'swap ' || assigned.outcome);
  successor := assigned.replacement_item_id;
  perform pg_temp.expect(
    (select id from public.entitlement_credits where challenge_item_id = successor) = saved_credit
    and (select credit_id from public.challenge_items where id = current_item) is null
    and (select status from public.challenge_items where id = current_item) = 'swapped_out'
    and (select swap_count_used from public.challenge_cycles where id = current_cycle) = 0
    and (select swap_count_used from public.challenge_cycles where id = cy2) = 0
    and (select count(*) from public.credit_swap_allowances where user_id = happy and swap_month = p0) = 1
    and exists (
      select 1 from public.credit_swap_allowances
      where user_id = happy and swap_month = p2 and source_item_id = i_p2_src
    ),
    'one current-month allowance and an older allowance did not block it'
  );

  select ci.id into carried_item
  from public.challenge_items ci
  join public.entitlement_credits ec on ec.challenge_item_id = ci.id
  where ec.user_id = happy and ec.issue_period = p1 and ec.slot_number = 1;
  select * into assigned from public.swap_linked_credit_item(happy, carried_item, r_swap);
  perform pg_temp.expect(assigned.outcome = 'swap_exhausted', 'second swap ' || assigned.outcome);
  perform pg_temp.expect(
    (select challenge_item_id from public.entitlement_credits where id = saved_credit) = successor
    and (select credit_id from public.challenge_items where id = successor) = saved_credit
    and (select status from public.challenge_items where id = current_item) = 'swapped_out'
    and (select id from public.challenge_items where id = carried_item and credit_id is not null) = carried_item
    and (select count(*) from public.credit_swap_allowances where user_id = happy and swap_month = p0) = 1
    and (select swap_count_used from public.challenge_cycles where id = current_cycle) = 0
    and (select swap_count_used from public.challenge_cycles where id = carried_cycle) = 0,
    'exhausted swap left the first swap in place'
  );

  perform pg_temp.expect(
    (select count(*) from public.entitlement_credits where user_id = happy and status = 'linked') = 4
    and (select count(distinct ci.cycle_id)
      from public.entitlement_credits ec
      join public.challenge_items ci on ci.id = ec.challenge_item_id
      where ec.user_id = happy and ec.status = 'linked') = 2
    and not exists (
      select 1 from public.entitlement_credits ec
      join public.challenge_items ci on ci.id = ec.challenge_item_id
      where ec.user_id = happy and ci.slot_number not in (1, 2)
    )
    and not exists (
      select 1 from public.entitlement_credits
      where user_id = happy
      group by issue_period
      having count(*) <> 2
    )
    and (select count(*) from public.challenge_items where cycle_id = cy4) = 2
    and (select status from public.challenge_cycles where id = cy4) = 'completed'
    and (select swap_count_used from public.challenge_cycles where id = cy4) = 0
    and (select count(*) from public.challenge_items where restaurant_id = r_cool) = 1
    and not exists (
      select 1 from public.challenge_items
      where restaurant_id in (r_cheese, r_peanut, r_pasta, r_other, r_low, r_floor_a, r_floor_b)
    ),
    'four linked credits on two cycles'
  );

  issued := public.issue_period_credits(thin, p0);
  perform pg_temp.expect(issued = 'created', 'thin issue ' || issued);
  passers := '{}'::uuid[];
  for rest in
    select r.id from public.restaurants r order by r.id
  loop
    reason := pg_temp.refuse_reason(thin, rest, market);
    if reason is null then
      passers := passers || rest;
    else
      insert into pg_temp.rejections (reason) values (reason);
    end if;
  end loop;
  perform pg_temp.expect(
    cardinality(passers) = 2
    and passers @> array[r_floor_a, r_floor_b]::uuid[]
    and array[r_floor_a, r_floor_b]::uuid[] @> passers,
    'thin catalog passers'
  );
  select * into linked from public.link_pending_credits(thin, p0, market, r_floor_a, r_floor_b);
  perform pg_temp.expect(linked.outcome = 'pair_below_floor' and linked.cycle_id is null, 'thin pair ' || linked.outcome);
  insert into pg_temp.rejections (reason) values ('pair_below_floor');
  perform pg_temp.expect(
    (select count(*) from public.entitlement_credits
      where user_id = thin and issue_period = p0 and status = 'pending' and challenge_item_id is null) = 2
    and (select count(*) from public.entitlement_credits where user_id = thin) = 2
    and not exists (select 1 from public.challenge_cycles where user_id = thin),
    'thin catalog stayed pending'
  );

  select count(*)::integer into match_num
  from public.entitlement_credits ec
  where ec.user_id = happy
    and ec.issue_period between p5 and p0
    and (ec.challenge_item_id is not null or ec.status in ('spent', 'linked'));
  select count(*)::integer into match_den
  from public.entitlement_credits ec
  where ec.user_id = happy
    and ec.issue_period between p5 and p0;
  select count(*)::integer into thin_num
  from public.entitlement_credits ec
  where ec.user_id = thin
    and (ec.challenge_item_id is not null or ec.status in ('spent', 'linked'));
  select count(*)::integer into thin_den
  from public.entitlement_credits ec
  where ec.user_id = thin and ec.issue_period = p0;
  select coalesce(sum((tier.value ->> 'threshold_cents')::integer), 0)::integer into spend
  from public.entitlement_credits ec
  join public.challenge_items ci on ci.id = ec.challenge_item_id
  join public.offer_versions v on v.id = ci.offer_version_id
  cross join lateral jsonb_array_elements(v.tiers) as tier(value)
  where ec.user_id = happy and ec.status = 'linked';
  select
    count(*) filter (where rj.reason = 'dietary_exclusion'),
    count(*) filter (where rj.reason = 'allergy'),
    count(*) filter (where rj.reason = 'excluded_cuisine'),
    count(*) filter (where rj.reason = 'cooldown'),
    count(*) filter (where rj.reason = 'outside_market'),
    count(*) filter (where rj.reason = 'pair_below_floor'),
    count(*) filter (where rj.reason = 'below_floor'),
    count(*) filter (where rj.reason = 'capacity_full')
  into n_dietary, n_allergy, n_excluded, n_cooldown, n_market, n_pair_floor, n_below, n_capacity
  from pg_temp.rejections rj;
  perform pg_temp.expect(match_num = 10 and match_den = 12, 'match rate');
  perform pg_temp.expect(thin_num = 0 and thin_den = 2, 'thin match');
  perform pg_temp.expect(
    (select count(distinct issue_period) from public.entitlement_credits where user_id = happy) = 6,
    'simulated months'
  );
  perform pg_temp.expect(
    n_dietary = 2 and n_allergy = 2 and n_excluded = 2 and n_cooldown = 9
    and n_market = 8 and n_pair_floor = 2 and n_below = 1 and n_capacity = 1,
    format(
      'rejection counts d=%s a=%s e=%s c=%s m=%s p=%s b=%s f=%s',
      n_dietary, n_allergy, n_excluded, n_cooldown, n_market, n_pair_floor, n_below, n_capacity
    )
  );
  perform pg_temp.expect(
    (select count(*) from public.capacity_reservations
      where restaurant_id = r_full and status in ('reserved', 'consumed')) = 1,
    'capacity seats'
  );
  perform pg_temp.expect(spend = 16000, 'qualifying spend');
  insert into pg_temp.cohort_report (line) values (format(
    'E02 cohort simulated_months=6 match %s/%s dietary_exclusion=%s allergy=%s excluded_cuisine=%s cooldown=%s outside_market=%s pair_below_floor=%s below_floor=%s capacity_full=%s capacity_reserved_seats=1 required_qualifying_spend_cents=%s fixture_assumption thin_match=%s/%s',
    match_num, match_den, n_dietary, n_allergy, n_excluded, n_cooldown, n_market,
    n_pair_floor, n_below, n_capacity, spend, thin_num, thin_den
  ));
end;
$$;

select line from pg_temp.cohort_report;
select 'PASS: E02 six-month cohort match 10/12';
rollback;
