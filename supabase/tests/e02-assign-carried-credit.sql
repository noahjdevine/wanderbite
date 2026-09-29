-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '30s';

do $$
declare
  market uuid := 'e2ac0000-0000-4000-8000-000000000010';
  other_market uuid := 'e2ac0000-0000-4000-8000-000000000020';
  admin uuid := 'e2ac0000-0000-4000-8000-000000000003';
  happy uuid := 'e2ac0000-0000-4000-8000-000000000001';
  cover uuid := 'e2ac0000-0000-4000-8000-000000000002';
  cover_pair uuid := 'e2ac0000-0000-4000-8000-00000000001f';
  survivor uuid := 'e2ac0000-0000-4000-8000-000000000004';
  sibling uuid := 'e2ac0000-0000-4000-8000-000000000005';
  month_user uuid := 'e2ac0000-0000-4000-8000-000000000006';
  low_user uuid := 'e2ac0000-0000-4000-8000-000000000007';
  low_sib uuid := 'e2ac0000-0000-4000-8000-000000000008';
  pair_user uuid := 'e2ac0000-0000-4000-8000-000000000009';
  dup_user uuid := 'e2ac0000-0000-4000-8000-00000000000a';
  caller uuid := 'e2ac0000-0000-4000-8000-00000000000b';
  owner uuid := 'e2ac0000-0000-4000-8000-00000000000c';
  t1_user uuid := 'e2ac0000-0000-4000-8000-00000000000d';
  due_user uuid := 'e2ac0000-0000-4000-8000-00000000000e';
  legacy_cycle_user uuid := 'e2ac0000-0000-4000-8000-00000000000f';
  legacy_other uuid := 'e2ac0000-0000-4000-8000-000000000011';
  cap_user uuid := 'e2ac0000-0000-4000-8000-000000000012';
  cap_sib uuid := 'e2ac0000-0000-4000-8000-000000000013';
  slot_user uuid := 'e2ac0000-0000-4000-8000-000000000014';
  mal uuid := 'e2ac0000-0000-4000-8000-000000000015';
  spent_user uuid := 'e2ac0000-0000-4000-8000-000000000016';
  expired_user uuid := 'e2ac0000-0000-4000-8000-000000000017';
  legacy_wf uuid := 'e2ac0000-0000-4000-8000-000000000018';
  inactive uuid := 'e2ac0000-0000-4000-8000-000000000019';
  past_user uuid := 'e2ac0000-0000-4000-8000-00000000001a';
  expiry_user uuid := 'e2ac0000-0000-4000-8000-00000000001b';
  null_user uuid := 'e2ac0000-0000-4000-8000-00000000001c';
  filler uuid := 'e2ac0000-0000-4000-8000-00000000001d';
  invalid_user uuid := 'e2ac0000-0000-4000-8000-00000000001e';
  ny uuid := 'e2ac0000-0000-4000-8000-000000000101';
  cover_rest uuid := 'e2ac0000-0000-4000-8000-000000000102';
  exact_rest uuid := 'e2ac0000-0000-4000-8000-000000000103';
  ended_rest uuid := 'e2ac0000-0000-4000-8000-000000000104';
  withdrawn_rest uuid := 'e2ac0000-0000-4000-8000-000000000105';
  paused_rest uuid := 'e2ac0000-0000-4000-8000-000000000106';
  other_rest uuid := 'e2ac0000-0000-4000-8000-000000000107';
  empty_rest uuid := 'e2ac0000-0000-4000-8000-000000000109';
  low_rest uuid := 'e2ac0000-0000-4000-8000-00000000010a';
  pair_a uuid := 'e2ac0000-0000-4000-8000-00000000010b';
  pair_b uuid := 'e2ac0000-0000-4000-8000-00000000010c';
  sib_b uuid := 'e2ac0000-0000-4000-8000-00000000010e';
  sib_pair_a uuid := 'e2ac0000-0000-4000-8000-00000000010f';
  sib_pair_b uuid := 'e2ac0000-0000-4000-8000-000000000111';
  full_rest uuid := 'e2ac0000-0000-4000-8000-000000000113';
  std uuid := 'e2ac0000-0000-4000-8000-000000000114';
  no_version uuid := 'e2ac0000-0000-4000-8000-000000000108';
  past_rest uuid := 'e2ac0000-0000-4000-8000-000000000121';
  redeemed_rest uuid := 'e2ac0000-0000-4000-8000-000000000122';
  v_ny uuid := 'e2ac0000-0000-4000-8000-000000000201';
  v_cover uuid := 'e2ac0000-0000-4000-8000-000000000202';
  v_exact uuid := 'e2ac0000-0000-4000-8000-000000000203';
  v_ended uuid := 'e2ac0000-0000-4000-8000-000000000204';
  v_withdrawn uuid := 'e2ac0000-0000-4000-8000-000000000205';
  v_paused uuid := 'e2ac0000-0000-4000-8000-000000000206';
  v_other uuid := 'e2ac0000-0000-4000-8000-000000000207';
  v_empty uuid := 'e2ac0000-0000-4000-8000-000000000209';
  v_low uuid := 'e2ac0000-0000-4000-8000-00000000020a';
  v_pair_a uuid := 'e2ac0000-0000-4000-8000-00000000020b';
  v_pair_b uuid := 'e2ac0000-0000-4000-8000-00000000020c';
  v_sib_b uuid := 'e2ac0000-0000-4000-8000-00000000020e';
  v_sib_pair_a uuid := 'e2ac0000-0000-4000-8000-00000000020f';
  v_sib_pair_b uuid := 'e2ac0000-0000-4000-8000-000000000211';
  v_full uuid := 'e2ac0000-0000-4000-8000-000000000213';
  v_std uuid := 'e2ac0000-0000-4000-8000-000000000214';
  happy_credit uuid := 'e2ac0000-0000-4000-8000-000000000301';
  happy_credit_2 uuid := 'e2ac0000-0000-4000-8000-000000000302';
  cover_credit uuid := 'e2ac0000-0000-4000-8000-000000000303';
  survivor_credit uuid := 'e2ac0000-0000-4000-8000-000000000304';
  survivor_expired uuid := 'e2ac0000-0000-4000-8000-000000000305';
  sib_credit_1 uuid := 'e2ac0000-0000-4000-8000-000000000306';
  sib_credit_2 uuid := 'e2ac0000-0000-4000-8000-000000000307';
  origin_credit uuid := 'e2ac0000-0000-4000-8000-000000000308';
  low_credit uuid := 'e2ac0000-0000-4000-8000-000000000309';
  low_sib_1 uuid := 'e2ac0000-0000-4000-8000-00000000030a';
  low_sib_2 uuid := 'e2ac0000-0000-4000-8000-00000000030b';
  pair_credit_1 uuid := 'e2ac0000-0000-4000-8000-00000000030c';
  pair_credit_2 uuid := 'e2ac0000-0000-4000-8000-00000000030d';
  dup_credit_1 uuid := 'e2ac0000-0000-4000-8000-00000000030e';
  dup_credit_2 uuid := 'e2ac0000-0000-4000-8000-00000000030f';
  owner_credit uuid := 'e2ac0000-0000-4000-8000-000000000311';
  t1_credit uuid := 'e2ac0000-0000-4000-8000-000000000312';
  due_credit uuid := 'e2ac0000-0000-4000-8000-000000000313';
  legacy_cycle_credit uuid := 'e2ac0000-0000-4000-8000-000000000314';
  legacy_other_credit uuid := 'e2ac0000-0000-4000-8000-000000000315';
  legacy_other_old uuid := 'e2ac0000-0000-4000-8000-000000000316';
  cap_credit uuid := 'e2ac0000-0000-4000-8000-000000000317';
  cap_sib_1 uuid := 'e2ac0000-0000-4000-8000-000000000318';
  cap_sib_2 uuid := 'e2ac0000-0000-4000-8000-000000000319';
  slot_other uuid := 'e2ac0000-0000-4000-8000-00000000031a';
  slot_credit uuid := 'e2ac0000-0000-4000-8000-00000000031b';
  spent_credit uuid := 'e2ac0000-0000-4000-8000-00000000031c';
  expired_credit uuid := 'e2ac0000-0000-4000-8000-00000000031d';
  legacy_wf_credit uuid := 'e2ac0000-0000-4000-8000-00000000031e';
  inactive_credit uuid := 'e2ac0000-0000-4000-8000-00000000031f';
  null_credit uuid := 'e2ac0000-0000-4000-8000-000000000321';
  invalid_credit uuid := 'e2ac0000-0000-4000-8000-000000000322';
  expiry_credit uuid := 'e2ac0000-0000-4000-8000-000000000323';
  mal_null_credit uuid := 'e2ac0000-0000-4000-8000-000000000331';
  mal_cross_credit uuid := 'e2ac0000-0000-4000-8000-000000000332';
  mal_cross_other uuid := 'e2ac0000-0000-4000-8000-000000000333';
  mal_slot_credit uuid := 'e2ac0000-0000-4000-8000-000000000334';
  mal_cycle_credit uuid := 'e2ac0000-0000-4000-8000-000000000335';
  tier_2000 jsonb := '[{"threshold_cents":4000,"discount_cents":2000}]'::jsonb;
  tier_1999 jsonb := '[{"threshold_cents":4000,"discount_cents":1999}]'::jsonb;
  tier_1000 jsonb := '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb;
  chicago date;
  prev date;
  old_period date;
  t1 timestamptz;
  t2 timestamptz;
  t2_past timestamptz;
  cover_until timestamptz;
  linked record;
  again record;
  issued record;
  verified_row record;
  credits_ids uuid[];
  def text;
  mal_cycles integer;
  mal_items integer;
  current_cycle uuid;
  origin_cycle uuid;
  happy_item uuid;
  happy_expires timestamptz;
  happy_period date;
  happy_slot smallint;
  dup_item uuid;
  low_sib_cycle uuid;
  cap_sib_cycle uuid;
  sib_current uuid;
  t2_date date;
  deadline timestamptz;
  past_item uuid;
  redeemed_item uuid;
  expiry_item uuid;
  filler_item uuid;
  token text := repeat('a1', 32);
  expired_text text;
begin
  chicago := public.chicago_month_start(now());
  prev := (chicago - interval '1 month')::date;
  old_period := (chicago - interval '2 months')::date;
  t1 := (prev + interval '1 month')::timestamp at time zone 'America/Chicago';
  t2 := (prev + interval '2 months')::timestamp at time zone 'America/Chicago';
  t2_past := (old_period + interval '2 months')::timestamp at time zone 'America/Chicago';
  cover_until := t2 + interval '1 hour';
  if not (t2 > now() and t2 < now() + interval '840 hours' and cover_until < now() + interval '840 hours') then
    raise exception 'FAIL: previous-month T2 is not a future short window';
  end if;
  if now() < t2_past then
    raise exception 'FAIL: two-month-old T2 is still in the future';
  end if;
  if (t2 at time zone 'America/Chicago')::date
     is distinct from (t2 at time zone 'America/New_York')::date then
    raise exception 'FAIL: T2 is not a shared Chicago and New York calendar date';
  end if;

  def := pg_get_functiondef('public.assign_carried_credit(uuid,uuid,uuid,uuid)'::regprocedure);
  if def like '%generate_challenge_cycle%'
     or def like '%link_pending_credits%'
     or def like '%issue_period_credits%'
     or def like '%rollover_credits%'
     or def like '%generateMonthlyChallengeForUser%'
     or def like '%restaurant_base_cents%'
     or def like '%version_selection_ok%'
     or def ~* 'update[[:space:]]+public\.user_profiles'
  then
    raise exception 'FAIL: assign_carried_credit calls a forbidden helper or writes a profile';
  end if;
  if pg_get_functiondef('public.version_selection_ok(uuid,timestamptz)'::regprocedure) not like '%840 hours%' then
    raise exception 'FAIL: version_selection_ok no longer requires 840 hours';
  end if;
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'assign_carried_credit'
      and p.prosecdef
      and pg_get_function_identity_arguments(p.oid) =
        'p_user_id uuid, p_credit_id uuid, p_market_id uuid, p_restaurant_id uuid'
      and exists (
        select 1 from unnest(p.proconfig) as cfg
        where cfg like 'search_path=pg_catalog, public%'
      )
  ) then
    raise exception 'FAIL: assign_carried_credit signature or search_path';
  end if;
  if has_function_privilege('anon', 'public.assign_carried_credit(uuid, uuid, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.assign_carried_credit(uuid, uuid, uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.assign_carried_credit(uuid, uuid, uuid, uuid)', 'EXECUTE')
  then
    raise exception 'FAIL: assign_carried_credit grants';
  end if;

  insert into auth.users (id) values
    (admin), (happy), (cover), (cover_pair), (survivor), (sibling), (month_user),
    (low_user), (low_sib), (pair_user), (dup_user), (caller), (owner), (t1_user),
    (due_user), (legacy_cycle_user), (legacy_other), (cap_user), (cap_sib), (slot_user),
    (mal), (spent_user), (expired_user), (legacy_wf), (inactive), (past_user),
    (expiry_user), (null_user), (filler), (invalid_user);
  insert into public.user_profiles (id, subscription_status, role) values
    (admin, 'active', 'admin'),
    (happy, 'active', 'subscriber'),
    (cover, 'active', 'subscriber'),
    (cover_pair, 'active', 'subscriber'),
    (survivor, 'active', 'subscriber'),
    (sibling, 'active', 'subscriber'),
    (month_user, 'active', 'subscriber'),
    (low_user, 'active', 'subscriber'),
    (low_sib, 'active', 'subscriber'),
    (pair_user, 'active', 'subscriber'),
    (dup_user, 'active', 'subscriber'),
    (caller, 'active', 'subscriber'),
    (owner, 'active', 'subscriber'),
    (t1_user, 'active', 'subscriber'),
    (due_user, 'active', 'subscriber'),
    (legacy_cycle_user, 'active', 'subscriber'),
    (legacy_other, 'active', 'subscriber'),
    (cap_user, 'active', 'subscriber'),
    (cap_sib, 'active', 'subscriber'),
    (slot_user, 'active', 'subscriber'),
    (mal, 'active', 'subscriber'),
    (spent_user, 'active', 'subscriber'),
    (expired_user, 'active', 'subscriber'),
    (legacy_wf, 'active', 'subscriber'),
    (inactive, 'inactive', 'subscriber'),
    (past_user, 'active', 'subscriber'),
    (expiry_user, 'active', 'subscriber'),
    (null_user, 'active', 'subscriber'),
    (filler, 'active', 'subscriber'),
    (invalid_user, 'active', 'subscriber');
  update public.user_profiles
  set workflow_version = 'credits'
  where id in (
    happy, cover, cover_pair, survivor, sibling, month_user, low_user, low_sib,
    pair_user, dup_user, caller, owner, t1_user, due_user, legacy_cycle_user,
    legacy_other, cap_user, cap_sib, slot_user, mal, spent_user, expired_user,
    inactive, expiry_user, null_user, invalid_user
  );
  select array_agg(id order by id) into credits_ids
  from public.user_profiles
  where workflow_version = 'credits';

  insert into public.markets (id, name, slug) values
    (market, 'E02 Carried', 'e02-carried'),
    (other_market, 'E02 Carried Other', 'e02-carried-other');
  insert into public.restaurants (id, name, status, market_id) values
    (ny, 'E02 carried NY', 'active', market),
    (cover_rest, 'E02 carried cover', 'active', market),
    (exact_rest, 'E02 carried exact', 'active', market),
    (ended_rest, 'E02 carried ended', 'active', market),
    (withdrawn_rest, 'E02 carried withdrawn', 'active', market),
    (paused_rest, 'E02 carried paused', 'paused', market),
    (other_rest, 'E02 carried other market', 'active', other_market),
    (no_version, 'E02 carried no version', 'active', market),
    (empty_rest, 'E02 carried empty tier', 'active', market),
    (low_rest, 'E02 carried 1999', 'active', market),
    (pair_a, 'E02 carried pair A', 'active', market),
    (pair_b, 'E02 carried pair B', 'active', market),
    (sib_b, 'E02 carried sibling B', 'active', market),
    (sib_pair_a, 'E02 carried sibling pair A', 'active', market),
    (sib_pair_b, 'E02 carried sibling pair B', 'active', market),
    (full_rest, 'E02 carried full', 'active', market),
    (std, 'E02 carried standard', 'active', market),
    (past_rest, 'E02 past-deadline fixture', 'active', market),
    (redeemed_rest, 'E02 redeemed-existing fixture', 'active', market);

  insert into public.offer_versions (
    id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
    capacity_timezone, capacity_window_kind, capacity_max_redemptions, published_by,
    withdrawn_from_selection_at
  ) values
    (v_ny, ny, 'America/New_York', now() - interval '1 day', now() + interval '400 days', tier_2000, '[]'::jsonb, '[]'::jsonb, 'America/New_York', 'calendar_month', 30, admin, null),
    (v_cover, cover_rest, 'America/Chicago', now() - interval '1 day', cover_until, tier_2000, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, admin, null),
    (v_exact, exact_rest, 'America/Chicago', now() - interval '1 day', t2, tier_2000, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, admin, null),
    (v_ended, ended_rest, 'America/Chicago', now() - interval '2 days', now() - interval '1 hour', tier_2000, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, admin, null),
    (v_withdrawn, withdrawn_rest, 'America/Chicago', now() - interval '1 day', now() + interval '400 days', tier_2000, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, admin, now()),
    (v_paused, paused_rest, 'America/Chicago', now() - interval '1 day', now() + interval '400 days', tier_2000, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, admin, null),
    (v_other, other_rest, 'America/Chicago', now() - interval '1 day', now() + interval '400 days', tier_2000, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, admin, null),
    (v_empty, empty_rest, 'America/Chicago', now() - interval '1 day', now() + interval '400 days', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, admin, null),
    (v_low, low_rest, 'America/Chicago', now() - interval '1 day', now() + interval '400 days', tier_1999, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, admin, null),
    (v_pair_a, pair_a, 'America/Chicago', now() - interval '1 day', now() + interval '400 days', tier_1000, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 30, admin, null),
    (v_pair_b, pair_b, 'America/Chicago', now() - interval '1 day', now() + interval '400 days', tier_1000, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 30, admin, null),
    (v_sib_b, sib_b, 'America/Chicago', now() - interval '1 day', now() + interval '400 days', tier_2000, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 30, admin, null),
    (v_sib_pair_a, sib_pair_a, 'America/Chicago', now() - interval '1 day', now() + interval '400 days', tier_1000, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 30, admin, null),
    (v_sib_pair_b, sib_pair_b, 'America/Chicago', now() - interval '1 day', now() + interval '400 days', tier_1000, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 30, admin, null),
    (v_full, full_rest, 'America/Chicago', now() - interval '1 day', now() + interval '400 days', tier_2000, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 1, admin, null),
    (v_std, std, 'America/Chicago', now() - interval '1 day', now() + interval '400 days', tier_2000, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 30, admin, null);
  update public.restaurants r
  set current_offer_version_id = v.version_id
  from (values
    (ny, v_ny), (cover_rest, v_cover), (exact_rest, v_exact), (ended_rest, v_ended),
    (withdrawn_rest, v_withdrawn), (paused_rest, v_paused), (other_rest, v_other),
    (empty_rest, v_empty), (low_rest, v_low), (pair_a, v_pair_a), (pair_b, v_pair_b),
    (sib_b, v_sib_b), (sib_pair_a, v_sib_pair_a), (sib_pair_b, v_sib_pair_b),
    (full_rest, v_full), (std, v_std)
  ) as v(restaurant_id, version_id)
  where r.id = v.restaurant_id;

  insert into public.entitlement_credits (id, user_id, issue_period, slot_number, status, expires_at) values
    (happy_credit, happy, prev, 1, 'pending', t2),
    (happy_credit_2, happy, prev, 2, 'pending', t2),
    (cover_credit, cover, prev, 1, 'pending', t2),
    (survivor_credit, survivor, prev, 1, 'pending', t2),
    (survivor_expired, survivor, prev, 2, 'expired', t2),
    (sib_credit_1, sibling, prev, 1, 'pending', t2),
    (sib_credit_2, sibling, prev, 2, 'pending', t2),
    (origin_credit, month_user, prev, 1, 'pending', t2),
    (low_credit, low_user, prev, 1, 'pending', t2),
    (low_sib_1, low_sib, prev, 1, 'pending', t2),
    (low_sib_2, low_sib, prev, 2, 'pending', t2),
    (pair_credit_1, pair_user, prev, 1, 'pending', t2),
    (pair_credit_2, pair_user, prev, 2, 'pending', t2),
    (dup_credit_1, dup_user, prev, 1, 'pending', t2),
    (dup_credit_2, dup_user, prev, 2, 'pending', t2),
    (owner_credit, owner, prev, 1, 'pending', t2),
    (t1_credit, t1_user, prev, 1, 'pending', t1),
    (due_credit, due_user, old_period, 1, 'pending', t2_past),
    (legacy_cycle_credit, legacy_cycle_user, prev, 2, 'pending', t2),
    (legacy_other_credit, legacy_other, prev, 2, 'pending', t2),
    (cap_credit, cap_user, prev, 1, 'pending', t2),
    (cap_sib_1, cap_sib, prev, 1, 'pending', t2),
    (cap_sib_2, cap_sib, prev, 2, 'pending', t2),
    (slot_credit, slot_user, prev, 2, 'pending', t2),
    (legacy_wf_credit, legacy_wf, prev, 1, 'pending', t2),
    (inactive_credit, inactive, prev, 1, 'pending', t2),
    (null_credit, null_user, prev, 1, 'pending', t2),
    (invalid_credit, invalid_user, prev, 1, 'pending', t2);

  begin
    set local role anon;
    perform public.assign_carried_credit(happy, null, market, ny);
    reset role;
    raise exception 'FAIL: anon executed assign_carried_credit';
  exception
    when insufficient_privilege then
      reset role;
  end;
  begin
    set local role authenticated;
    perform public.assign_carried_credit(happy, null, market, ny);
    reset role;
    raise exception 'FAIL: authenticated executed assign_carried_credit';
  exception
    when insufficient_privilege then
      reset role;
  end;
  begin
    set local role service_role;
    select * into linked from public.assign_carried_credit(happy, null, market, ny);
    reset role;
  exception
    when others then
      reset role;
      raise;
  end;
  if linked.outcome is distinct from 'not_carried' or linked.cycle_id is not null then
    raise exception 'FAIL: service_role null credit was %', linked.outcome;
  end if;

  select * into linked from public.assign_carried_credit(happy, null, market, ny);
  if linked.outcome is distinct from 'not_carried' or linked.cycle_id is not null then
    raise exception 'FAIL: null credit id was %', linked.outcome;
  end if;
  select * into linked from public.assign_carried_credit(
    happy, 'e2ac0000-0000-4000-8000-00000000ffff', market, ny
  );
  if linked.outcome is distinct from 'not_carried' or linked.cycle_id is not null
     or exists (select 1 from public.challenge_cycles where user_id = happy) then
    raise exception 'FAIL: missing credit id was %', linked.outcome;
  end if;

  select * into linked from public.assign_carried_credit(caller, owner_credit, market, std);
  if linked.outcome is distinct from 'not_carried' or linked.cycle_id is not null
     or exists (select 1 from public.challenge_cycles where user_id = caller)
     or (select status from public.entitlement_credits where id = owner_credit) is distinct from 'pending'
     or (select challenge_item_id from public.entitlement_credits where id = owner_credit) is not null
     or (select expires_at from public.entitlement_credits where id = owner_credit) is distinct from t2 then
    raise exception 'FAIL: another user credit was %', linked.outcome;
  end if;

  select * into linked from public.assign_carried_credit(legacy_wf, legacy_wf_credit, market, std);
  if linked.outcome is distinct from 'legacy_workflow' or linked.cycle_id is not null
     or exists (select 1 from public.challenge_cycles where user_id = legacy_wf)
     or (select status from public.entitlement_credits where id = legacy_wf_credit) is distinct from 'pending'
     or (select workflow_version from public.user_profiles where id = legacy_wf) is distinct from 'legacy' then
    raise exception 'FAIL: legacy workflow was %', linked.outcome;
  end if;
  select * into linked from public.assign_carried_credit(inactive, inactive_credit, market, std);
  if linked.outcome is distinct from 'inactive_subscription' or linked.cycle_id is not null
     or exists (select 1 from public.challenge_cycles where user_id = inactive)
     or (select status from public.entitlement_credits where id = inactive_credit) is distinct from 'pending'
     or (select subscription_status from public.user_profiles where id = inactive) is distinct from 'inactive' then
    raise exception 'FAIL: inactive subscription was %', linked.outcome;
  end if;

  select * into linked from public.assign_carried_credit(t1_user, t1_credit, market, std);
  if linked.outcome is distinct from 'not_carried' or linked.cycle_id is not null
     or exists (select 1 from public.challenge_cycles where user_id = t1_user)
     or (select expires_at from public.entitlement_credits where id = t1_credit) is distinct from t1
     or (select status from public.entitlement_credits where id = t1_credit) is distinct from 'pending' then
    raise exception 'FAIL: T1 credit was %', linked.outcome;
  end if;

  select * into linked from public.assign_carried_credit(due_user, due_credit, market, std);
  if linked.outcome is distinct from 'carried_due' or linked.cycle_id is not null
     or exists (select 1 from public.challenge_cycles where user_id = due_user)
     or exists (
       select 1 from public.challenge_items ci
       join public.challenge_cycles cc on cc.id = ci.cycle_id
       where cc.user_id = due_user
     )
     or (select status from public.entitlement_credits where id = due_credit) is distinct from 'pending'
     or (select challenge_item_id from public.entitlement_credits where id = due_credit) is not null
     or (select expires_at from public.entitlement_credits where id = due_credit) is distinct from t2_past then
    raise exception 'FAIL: past T2 was %', linked.outcome;
  end if;

  if public.issue_period_credits(month_user, chicago) is distinct from 'created' then
    raise exception 'FAIL: current month credits were not created';
  end if;
  select * into linked from public.assign_carried_credit(
    month_user,
    (select id from public.entitlement_credits
      where user_id = month_user and issue_period = chicago and slot_number = 1),
    market, std
  );
  if linked.outcome is distinct from 'not_carried' or linked.cycle_id is not null
     or exists (select 1 from public.challenge_cycles where user_id = month_user)
     or exists (
       select 1 from public.entitlement_credits
       where user_id = month_user and issue_period = chicago and status is distinct from 'pending'
     ) then
    raise exception 'FAIL: current month assign was %', linked.outcome;
  end if;
  select * into linked from public.link_pending_credits(month_user, chicago, market, pair_a, pair_b);
  if linked.outcome is distinct from 'linked' or linked.cycle_id is null
     or public.offer_lowest_tier_cents(tier_1000) is distinct from 1000
     or (select count(*) from public.entitlement_credits
         where user_id = month_user and issue_period = chicago and status = 'linked') is distinct from 2 then
    raise exception 'FAIL: 1000-cent pair was %', linked.outcome;
  end if;
  current_cycle := linked.cycle_id;

  select * into linked from public.assign_carried_credit(pair_user, pair_credit_1, market, pair_a);
  if linked.outcome is distinct from 'below_floor' or linked.cycle_id is not null then
    raise exception 'FAIL: carried 1000 A was %', linked.outcome;
  end if;
  select * into linked from public.assign_carried_credit(pair_user, pair_credit_2, market, pair_b);
  if linked.outcome is distinct from 'below_floor' or linked.cycle_id is not null
     or exists (select 1 from public.challenge_cycles where user_id = pair_user)
     or exists (
       select 1 from public.entitlement_credits
       where id in (pair_credit_1, pair_credit_2)
         and (status is distinct from 'pending' or challenge_item_id is not null)
     )
     or exists (
       select 1 from public.capacity_reservations
       where restaurant_id in (pair_a, pair_b) and challenge_item_id in (
         select ci.id from public.challenge_items ci
         join public.challenge_cycles cc on cc.id = ci.cycle_id
         where cc.user_id = pair_user
       )
     ) then
    raise exception 'FAIL: carried 1000 pair was not below_floor';
  end if;

  select * into linked from public.assign_carried_credit(low_user, low_credit, market, low_rest);
  if linked.outcome is distinct from 'below_floor' or linked.cycle_id is not null
     or exists (select 1 from public.challenge_cycles where user_id = low_user)
     or (select status from public.entitlement_credits where id = low_credit) is distinct from 'pending'
     or (select challenge_item_id from public.entitlement_credits where id = low_credit) is not null
     or exists (select 1 from public.capacity_reservations where restaurant_id = low_rest) then
    raise exception 'FAIL: 1999 floor was %', linked.outcome;
  end if;
  select * into linked from public.assign_carried_credit(null_user, null_credit, market, empty_rest);
  if linked.outcome is distinct from 'below_floor' or linked.cycle_id is not null
     or exists (select 1 from public.challenge_cycles where user_id = null_user)
     or (select challenge_item_id from public.entitlement_credits where id = null_credit) is not null then
    raise exception 'FAIL: null tier was %', linked.outcome;
  end if;

  foreach exact_rest in array array[exact_rest, ended_rest, withdrawn_rest, paused_rest, other_rest, no_version] loop
    select * into linked from public.assign_carried_credit(invalid_user, invalid_credit, market, exact_rest);
    if linked.outcome is distinct from 'invalid_restaurant' or linked.cycle_id is not null then
      raise exception 'FAIL: invalid restaurant % was %', exact_rest, linked.outcome;
    end if;
  end loop;
  select * into linked from public.assign_carried_credit(invalid_user, invalid_credit, other_market, std);
  if linked.outcome is distinct from 'invalid_restaurant' or linked.cycle_id is not null
     or exists (select 1 from public.challenge_cycles where user_id = invalid_user)
     or (select status from public.entitlement_credits where id = invalid_credit) is distinct from 'pending'
     or (select challenge_item_id from public.entitlement_credits where id = invalid_credit) is not null then
    raise exception 'FAIL: market mismatch was %', linked.outcome;
  end if;

  select issue_period, slot_number, expires_at
    into happy_period, happy_slot, happy_expires
  from public.entitlement_credits
  where id = happy_credit;
  select * into linked from public.assign_carried_credit(happy, happy_credit, market, ny);
  if linked.outcome is distinct from 'linked' or linked.cycle_id is null then
    raise exception 'FAIL: assign one was %', linked.outcome;
  end if;
  select ci.id, ci.redemption_deadline
    into happy_item, deadline
  from public.challenge_items ci
  where ci.cycle_id = linked.cycle_id and ci.slot_number = 1;
  t2_date := (happy_expires at time zone 'America/Chicago')::date;
  if (select id from public.entitlement_credits where id = happy_credit) is distinct from happy_credit
     or (select issue_period from public.entitlement_credits where id = happy_credit) is distinct from happy_period
     or (select slot_number from public.entitlement_credits where id = happy_credit) is distinct from happy_slot
     or (select expires_at from public.entitlement_credits where id = happy_credit) is distinct from happy_expires
     or (select status from public.entitlement_credits where id = happy_credit) is distinct from 'linked'
     or (select challenge_item_id from public.entitlement_credits where id = happy_credit) is distinct from happy_item
     or (select credit_id from public.challenge_items where id = happy_item) is distinct from happy_credit
     or (select cycle_month from public.challenge_cycles where id = linked.cycle_id) is distinct from happy_period
     or (select count(*) from public.challenge_items where cycle_id = linked.cycle_id) is distinct from 1
     or deadline is distinct from least(now() + interval '840 hours', happy_expires)
     or deadline > happy_expires
     or deadline is distinct from happy_expires
     or deadline >= now() + interval '840 hours'
     or (select workflow_version from public.user_profiles where id = happy) is distinct from 'credits'
     or (select status from public.entitlement_credits where id = happy_credit_2) is distinct from 'pending'
  then
    raise exception 'FAIL: assign one did not keep the carried credit';
  end if;
  if exists (
    select 1
    from public.capacity_reservations cr
    join public.challenge_items ci on ci.id = cr.challenge_item_id
    where ci.id = happy_item
      and not (
        (cr.bucket_start::timestamp at time zone cr.capacity_timezone) < ci.redemption_deadline
        and ((cr.bucket_start + interval '1 month')::timestamp at time zone cr.capacity_timezone) > ci.assigned_at
      )
  ) or not exists (
    select 1 from public.capacity_reservations where challenge_item_id = happy_item
  ) or exists (
    select 1
    from public.capacity_reservations cr
    where cr.challenge_item_id = happy_item
      and (cr.bucket_start::timestamp at time zone cr.capacity_timezone) >= happy_expires
  ) then
    raise exception 'FAIL: reservation window does not match the stored deadline';
  end if;
  if not exists (
    select 1
    from public.capacity_reservations cr
    where cr.challenge_item_id = happy_item
      and cr.capacity_timezone = 'America/New_York'
      and cr.bucket_start = t2_date
      and (cr.bucket_start::timestamp at time zone cr.capacity_timezone) < deadline
  ) or (
    select bool_and(cr.bucket_start < t2_date)
    from public.capacity_reservations cr
    where cr.challenge_item_id = happy_item
      and cr.bucket_start = t2_date
  ) is distinct from false then
    raise exception 'FAIL: New York month bucket was rejected by a date comparison';
  end if;

  select * into again from public.assign_carried_credit(happy, happy_credit, market, std);
  if again.outcome is distinct from 'existing' or again.cycle_id is distinct from linked.cycle_id
     or (select restaurant_id from public.challenge_items where id = happy_item) is distinct from ny
     or (select count(*) from public.challenge_items where cycle_id = linked.cycle_id) is distinct from 1 then
    raise exception 'FAIL: retry moved the restaurant or cycle';
  end if;

  if public.version_selection_ok(v_cover, now()) then
    raise exception 'FAIL: version_selection_ok accepted a T2-only offer';
  end if;
  select * into again from public.assign_carried_credit(cover, cover_credit, market, cover_rest);
  if again.outcome is distinct from 'linked' or again.cycle_id is null
     or (select redemption_deadline from public.challenge_items ci
         where ci.cycle_id = again.cycle_id) is distinct from t2 then
    raise exception 'FAIL: offer covering T2 only was %', again.outcome;
  end if;
  if public.issue_period_credits(cover_pair, chicago) is distinct from 'created' then
    raise exception 'FAIL: cover pair credits were not created';
  end if;
  select * into again from public.link_pending_credits(cover_pair, chicago, market, cover_rest, pair_a);
  if again.outcome is distinct from 'invalid_restaurants' or again.cycle_id is not null
     or exists (select 1 from public.challenge_cycles where user_id = cover_pair) then
    raise exception 'FAIL: current-month pair accepted a T2-only offer: %', again.outcome;
  end if;

  select * into again from public.assign_carried_credit(survivor, survivor_credit, market, std);
  if again.outcome is distinct from 'linked'
     or (select count(*) from public.entitlement_credits where user_id = survivor) is distinct from 2
     or (select count(*) from public.challenge_cycles where user_id = survivor) is distinct from 1
     or (select count(*) from public.challenge_items ci
         join public.challenge_cycles cc on cc.id = ci.cycle_id
         where cc.user_id = survivor) is distinct from 1
     or (select status from public.entitlement_credits where id = survivor_expired) is distinct from 'expired'
     or (select challenge_item_id from public.entitlement_credits where id = survivor_expired) is not null then
    raise exception 'FAIL: single survivor was %', again.outcome;
  end if;

  if public.issue_period_credits(sibling, chicago) is distinct from 'created' then
    raise exception 'FAIL: sibling current credits were not created';
  end if;
  select * into again from public.link_pending_credits(sibling, chicago, market, sib_pair_a, sib_pair_b);
  if again.outcome is distinct from 'linked' then
    raise exception 'FAIL: sibling current pair was %', again.outcome;
  end if;
  sib_current := again.cycle_id;
  select * into again from public.assign_carried_credit(sibling, sib_credit_1, market, std);
  if again.outcome is distinct from 'linked' then
    raise exception 'FAIL: sibling slot 1 was %', again.outcome;
  end if;
  origin_cycle := again.cycle_id;
  select * into again from public.assign_carried_credit(sibling, sib_credit_2, market, sib_b);
  if again.outcome is distinct from 'linked' or again.cycle_id is distinct from origin_cycle
     or origin_cycle = sib_current
     or (select count(*) from public.challenge_items where cycle_id = origin_cycle and slot_number in (1, 2)) is distinct from 2
     or (select count(*) from public.challenge_items where cycle_id = sib_current) is distinct from 2
     or (select count(*) from public.challenge_cycles where user_id = sibling) is distinct from 2 then
    raise exception 'FAIL: sibling join changed the current cycle';
  end if;

  select * into again from public.assign_carried_credit(month_user, origin_credit, market, std);
  if again.outcome is distinct from 'linked' or again.cycle_id = current_cycle
     or (select cycle_month from public.challenge_cycles where id = again.cycle_id) is distinct from prev
     or (select count(*) from public.challenge_items where cycle_id = current_cycle) is distinct from 2
     or (select count(*) from public.challenge_items where cycle_id = again.cycle_id) is distinct from 1 then
    raise exception 'FAIL: origin assign changed the current-month cycle';
  end if;

  select * into again from public.assign_carried_credit(low_sib, low_sib_1, market, std);
  if again.outcome is distinct from 'linked' then
    raise exception 'FAIL: below-floor sibling setup was %', again.outcome;
  end if;
  low_sib_cycle := again.cycle_id;
  select * into again from public.assign_carried_credit(low_sib, low_sib_2, market, low_rest);
  if again.outcome is distinct from 'below_floor' or again.cycle_id is not null
     or (select id from public.challenge_cycles where user_id = low_sib) is distinct from low_sib_cycle
     or (select count(*) from public.challenge_items where cycle_id = low_sib_cycle) is distinct from 1
     or (select status from public.entitlement_credits where id = low_sib_2) is distinct from 'pending'
     or (select challenge_item_id from public.entitlement_credits where id = low_sib_2) is not null then
    raise exception 'FAIL: below floor removed the sibling';
  end if;

  select * into again from public.assign_carried_credit(dup_user, dup_credit_1, market, std);
  if again.outcome is distinct from 'linked' then
    raise exception 'FAIL: duplicate setup was %', again.outcome;
  end if;
  select ci.id into dup_item
  from public.challenge_items ci
  where ci.cycle_id = again.cycle_id and ci.slot_number = 1;
  select * into linked from public.assign_carried_credit(dup_user, dup_credit_2, market, std);
  if linked.outcome is distinct from 'duplicate_restaurant' or linked.cycle_id is not null
     or (select id from public.challenge_items where cycle_id = again.cycle_id) is distinct from dup_item
     or (select restaurant_id from public.challenge_items where id = dup_item) is distinct from std
     or (select status from public.entitlement_credits where id = dup_credit_2) is distinct from 'pending'
     or (select challenge_item_id from public.entitlement_credits where id = dup_credit_2) is not null
     or (select count(*) from public.challenge_items where cycle_id = again.cycle_id) is distinct from 1 then
    raise exception 'FAIL: duplicate restaurant was %', linked.outcome;
  end if;

  insert into public.challenge_cycles (id, user_id, cycle_month, status, swap_count_used)
  values ('e2ac0000-0000-4000-8000-000000000401', legacy_cycle_user, prev, 'active', 0);
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
  ) values (
    'e2ac0000-0000-4000-8000-000000000402', 'e2ac0000-0000-4000-8000-000000000401',
    pair_a, 1, 'assigned', v_pair_a, now(), now() + interval '1 day'
  );
  select * into linked from public.assign_carried_credit(legacy_cycle_user, legacy_cycle_credit, market, std);
  if linked.outcome is distinct from 'legacy_cycle_present' or linked.cycle_id is not null
     or (select status from public.entitlement_credits where id = legacy_cycle_credit) is distinct from 'pending'
     or (select credit_id from public.challenge_items where id = 'e2ac0000-0000-4000-8000-000000000402') is not null
     or (select count(*) from public.challenge_items
         where cycle_id = 'e2ac0000-0000-4000-8000-000000000401') is distinct from 1 then
    raise exception 'FAIL: legacy cycle was %', linked.outcome;
  end if;

  insert into public.challenge_cycles (id, user_id, cycle_month, status, swap_count_used)
  values ('e2ac0000-0000-4000-8000-000000000403', legacy_other, prev, 'active', 0);
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
  ) values (
    'e2ac0000-0000-4000-8000-000000000404', 'e2ac0000-0000-4000-8000-000000000403',
    pair_b, 1, 'assigned', v_pair_b, now(), now() + interval '1 day'
  );
  insert into public.entitlement_credits (
    id, user_id, issue_period, slot_number, status, challenge_item_id, expires_at
  ) values (
    legacy_other_old, legacy_other, date '2020-01-01', 1, 'expired',
    'e2ac0000-0000-4000-8000-000000000404', now()
  );
  update public.challenge_items
  set credit_id = legacy_other_old
  where id = 'e2ac0000-0000-4000-8000-000000000404';
  select * into linked from public.assign_carried_credit(legacy_other, legacy_other_credit, market, std);
  if linked.outcome is distinct from 'legacy_cycle_present' or linked.cycle_id is not null
     or (select status from public.entitlement_credits where id = legacy_other_credit) is distinct from 'pending' then
    raise exception 'FAIL: other-period cycle was %', linked.outcome;
  end if;

  insert into public.challenge_cycles (id, user_id, cycle_month, status, swap_count_used)
  values ('e2ac0000-0000-4000-8000-000000000405', slot_user, prev, 'active', 0);
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
  ) values (
    'e2ac0000-0000-4000-8000-000000000406', 'e2ac0000-0000-4000-8000-000000000405',
    sib_b, 2, 'assigned', v_sib_b, now(), t2
  );
  insert into public.entitlement_credits (
    id, user_id, issue_period, slot_number, status, challenge_item_id, expires_at
  ) values (
    slot_other, slot_user, prev, 1, 'linked', 'e2ac0000-0000-4000-8000-000000000406', t2
  );
  update public.challenge_items
  set credit_id = slot_other
  where id = 'e2ac0000-0000-4000-8000-000000000406';
  select * into linked from public.assign_carried_credit(slot_user, slot_credit, market, std);
  if linked.outcome is distinct from 'slot_taken' or linked.cycle_id is not null
     or (select status from public.entitlement_credits where id = slot_credit) is distinct from 'pending'
     or (select challenge_item_id from public.entitlement_credits where id = slot_credit) is not null
     or (select count(*) from public.challenge_items
         where cycle_id = 'e2ac0000-0000-4000-8000-000000000405') is distinct from 1
     or (select credit_id from public.challenge_items where id = 'e2ac0000-0000-4000-8000-000000000406')
        is distinct from slot_other then
    raise exception 'FAIL: slot taken was %', linked.outcome;
  end if;

  insert into public.challenge_cycles (id, user_id, cycle_month, status, swap_count_used)
  values
    ('e2ac0000-0000-4000-8000-000000000411', filler, chicago, 'active', 0),
    ('e2ac0000-0000-4000-8000-000000000421', spent_user, prev, 'active', 0),
    ('e2ac0000-0000-4000-8000-000000000431', expired_user, prev, 'active', 0);
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
  ) values
    ('e2ac0000-0000-4000-8000-000000000412', 'e2ac0000-0000-4000-8000-000000000411',
      full_rest, 1, 'assigned', v_full, now(), now() + interval '840 hours'),
    ('e2ac0000-0000-4000-8000-000000000422', 'e2ac0000-0000-4000-8000-000000000421',
      pair_a, 1, 'redeemed', v_pair_a, now() - interval '1 day', t2),
    ('e2ac0000-0000-4000-8000-000000000432', 'e2ac0000-0000-4000-8000-000000000431',
      pair_b, 1, 'expired', v_pair_b, now() - interval '1 day', t2);
  insert into public.capacity_reservations (
    challenge_item_id, offer_version_id, restaurant_id, capacity_timezone, bucket_start, status
  ) values (
    'e2ac0000-0000-4000-8000-000000000412', v_full, full_rest, 'America/Chicago', chicago, 'reserved'
  );
  filler_item := 'e2ac0000-0000-4000-8000-000000000412';
  if not (
    (chicago::timestamp at time zone 'America/Chicago') < t2
    and ((chicago + interval '1 month')::timestamp at time zone 'America/Chicago') > now()
  ) then
    raise exception 'FAIL: filler bucket would not overlap the carried window';
  end if;
  insert into public.entitlement_credits (
    id, user_id, issue_period, slot_number, status, challenge_item_id, expires_at
  ) values
    (spent_credit, spent_user, prev, 1, 'spent', 'e2ac0000-0000-4000-8000-000000000422', t2),
    (expired_credit, expired_user, prev, 1, 'expired', 'e2ac0000-0000-4000-8000-000000000432', t2);
  update public.challenge_items set credit_id = spent_credit
  where id = 'e2ac0000-0000-4000-8000-000000000422';
  update public.challenge_items set credit_id = expired_credit
  where id = 'e2ac0000-0000-4000-8000-000000000432';
  select * into linked from public.assign_carried_credit(spent_user, spent_credit, market, std);
  if linked.outcome is distinct from 'not_carried'
     or (select status from public.entitlement_credits where id = spent_credit) is distinct from 'spent'
     or (select count(*) from public.challenge_cycles where user_id = spent_user) is distinct from 1 then
    raise exception 'FAIL: spent credit was %', linked.outcome;
  end if;
  select * into linked from public.assign_carried_credit(expired_user, expired_credit, market, std);
  if linked.outcome is distinct from 'not_carried'
     or (select status from public.entitlement_credits where id = expired_credit) is distinct from 'expired' then
    raise exception 'FAIL: expired credit was %', linked.outcome;
  end if;

  select * into linked from public.assign_carried_credit(cap_user, cap_credit, market, full_rest);
  if linked.outcome is distinct from 'capacity_full' or linked.cycle_id is not null
     or exists (select 1 from public.challenge_cycles where user_id = cap_user)
     or (select status from public.entitlement_credits where id = cap_credit) is distinct from 'pending'
     or (select challenge_item_id from public.entitlement_credits where id = cap_credit) is not null
     or (select count(*) from public.capacity_reservations
         where restaurant_id = full_rest and status = 'reserved') is distinct from 1
     or (select challenge_item_id from public.capacity_reservations
         where restaurant_id = full_rest and status = 'reserved') is distinct from filler_item then
    raise exception 'FAIL: capacity full left a cycle: %', linked.outcome;
  end if;
  select * into again from public.assign_carried_credit(cap_sib, cap_sib_1, market, sib_b);
  if again.outcome is distinct from 'linked' then
    raise exception 'FAIL: capacity sibling setup was %', again.outcome;
  end if;
  cap_sib_cycle := again.cycle_id;
  select * into linked from public.assign_carried_credit(cap_sib, cap_sib_2, market, full_rest);
  if linked.outcome is distinct from 'capacity_full' or linked.cycle_id is not null
     or (select id from public.challenge_cycles where user_id = cap_sib) is distinct from cap_sib_cycle
     or (select count(*) from public.challenge_items where cycle_id = cap_sib_cycle) is distinct from 1
     or (select status from public.entitlement_credits where id = cap_sib_1) is distinct from 'linked'
     or (select status from public.entitlement_credits where id = cap_sib_2) is distinct from 'pending'
     or (select challenge_item_id from public.entitlement_credits where id = cap_sib_2) is not null
     or (select count(*) from public.capacity_reservations
         where restaurant_id = full_rest and status = 'reserved') is distinct from 1 then
    raise exception 'FAIL: capacity full removed the sibling';
  end if;

  insert into public.challenge_cycles (id, user_id, cycle_month, status, swap_count_used) values
    ('e2ac0000-0000-4000-8000-000000000441', mal, date '2024-01-01', 'active', 0),
    ('e2ac0000-0000-4000-8000-000000000442', mal, date '2024-02-01', 'active', 0),
    ('e2ac0000-0000-4000-8000-000000000443', mal, date '2024-03-01', 'active', 0),
    ('e2ac0000-0000-4000-8000-000000000444', mal, date '2024-06-01', 'active', 0);
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status
  ) values
    ('e2ac0000-0000-4000-8000-000000000451', 'e2ac0000-0000-4000-8000-000000000441', std, 1, 'assigned'),
    ('e2ac0000-0000-4000-8000-000000000452', 'e2ac0000-0000-4000-8000-000000000442', std, 1, 'assigned'),
    ('e2ac0000-0000-4000-8000-000000000453', 'e2ac0000-0000-4000-8000-000000000443', std, 2, 'assigned'),
    ('e2ac0000-0000-4000-8000-000000000454', 'e2ac0000-0000-4000-8000-000000000444', std, 1, 'assigned');
  insert into public.entitlement_credits (
    id, user_id, issue_period, slot_number, status, challenge_item_id, expires_at
  ) values
    (mal_null_credit, mal, date '2024-01-01', 1, 'linked', 'e2ac0000-0000-4000-8000-000000000451', t2),
    (mal_cross_credit, mal, date '2024-02-01', 1, 'linked', 'e2ac0000-0000-4000-8000-000000000452', t2),
    (mal_cross_other, mal, date '2024-05-01', 1, 'expired', null, t2),
    (mal_slot_credit, mal, date '2024-03-01', 1, 'linked', 'e2ac0000-0000-4000-8000-000000000453', t2),
    (mal_cycle_credit, mal, date '2024-04-01', 1, 'linked', 'e2ac0000-0000-4000-8000-000000000454', t2);
  update public.challenge_items set credit_id = mal_cross_other
  where id = 'e2ac0000-0000-4000-8000-000000000452';
  update public.challenge_items set credit_id = mal_slot_credit
  where id = 'e2ac0000-0000-4000-8000-000000000453';
  update public.challenge_items set credit_id = mal_cycle_credit
  where id = 'e2ac0000-0000-4000-8000-000000000454';
  select count(*) into mal_cycles from public.challenge_cycles where user_id = mal;
  select count(*) into mal_items from public.challenge_items ci
  join public.challenge_cycles cc on cc.id = ci.cycle_id
  where cc.user_id = mal;
  select * into linked from public.assign_carried_credit(mal, mal_null_credit, market, sib_b);
  if linked.outcome is distinct from 'not_carried' or linked.cycle_id is not null
     or (select credit_id from public.challenge_items where id = 'e2ac0000-0000-4000-8000-000000000451') is not null then
    raise exception 'FAIL: null item credit_id was %', linked.outcome;
  end if;
  select * into linked from public.assign_carried_credit(mal, mal_cross_credit, market, sib_b);
  if linked.outcome is distinct from 'not_carried'
     or (select credit_id from public.challenge_items where id = 'e2ac0000-0000-4000-8000-000000000452')
        is distinct from mal_cross_other then
    raise exception 'FAIL: crossed credit link was %', linked.outcome;
  end if;
  select * into linked from public.assign_carried_credit(mal, mal_slot_credit, market, sib_b);
  if linked.outcome is distinct from 'not_carried'
     or (select slot_number from public.challenge_items where id = 'e2ac0000-0000-4000-8000-000000000453') is distinct from 2 then
    raise exception 'FAIL: slot mismatch was %', linked.outcome;
  end if;
  select * into linked from public.assign_carried_credit(mal, mal_cycle_credit, market, sib_b);
  if linked.outcome is distinct from 'not_carried'
     or (select cycle_month from public.challenge_cycles where id = 'e2ac0000-0000-4000-8000-000000000444')
        is distinct from date '2024-06-01'
     or (select count(*) from public.challenge_cycles where user_id = mal) is distinct from mal_cycles
     or (select count(*) from public.challenge_items ci
         join public.challenge_cycles cc on cc.id = ci.cycle_id
         where cc.user_id = mal) is distinct from mal_items then
    raise exception 'FAIL: wrong origin cycle was %', linked.outcome;
  end if;

  begin
    insert into public.entitlement_credits (
      user_id, issue_period, slot_number, status, challenge_item_id, expires_at
    ) values (mal, date '2024-07-01', 1, 'linked', null, now());
    raise exception 'FAIL: linked credit accepted a null item';
  exception
    when check_violation then
      null;
  end;
  begin
    insert into public.entitlement_credits (
      user_id, issue_period, slot_number, status, challenge_item_id, expires_at
    ) values (
      mal, date '2024-07-01', 1, 'linked', 'e2ac0000-0000-4000-8000-00000000ffff', now()
    );
    raise exception 'FAIL: credit accepted a missing item';
  exception
    when foreign_key_violation then
      null;
  end;

  select * into issued from public.issue_challenge_redemption(
    happy, happy_item, token, 'cipher', 'iviviviviviv', now() + interval '2 days'
  );
  if issued.outcome is distinct from 'created'
     or (select expires_at from public.redemptions where challenge_item_id = happy_item) is distinct from deadline
     or deadline >= now() + interval '840 hours'
     or (select status from public.entitlement_credits where id = happy_credit) is distinct from 'linked' then
    raise exception 'FAIL: carried QR expiry was %', issued.outcome;
  end if;
  select issue_period, slot_number, expires_at
    into happy_period, happy_slot, happy_expires
  from public.entitlement_credits
  where id = happy_credit;
  select * into verified_row from public.verify_redemption_and_settle(token, ny);
  if verified_row.id is null
     or (select status from public.entitlement_credits where id = happy_credit) is distinct from 'spent'
     or (select issue_period from public.entitlement_credits where id = happy_credit) is distinct from happy_period
     or (select slot_number from public.entitlement_credits where id = happy_credit) is distinct from happy_slot
     or (select expires_at from public.entitlement_credits where id = happy_credit) is distinct from happy_expires
     or (select id from public.entitlement_credits where id = happy_credit) is distinct from happy_credit
     or (select status from public.entitlement_credits where id = happy_credit_2) is distinct from 'pending' then
    raise exception 'FAIL: verify did not spend only the carried credit';
  end if;
  select * into verified_row from public.verify_redemption_and_settle(token, ny);
  if found
     or (select count(*) from public.entitlement_credits where user_id = happy and status = 'spent') is distinct from 1
     or (select status from public.entitlement_credits where id = happy_credit_2) is distinct from 'pending'
     or (select expires_at from public.entitlement_credits where id = happy_credit) is distinct from happy_expires then
    raise exception 'FAIL: second verify spent another credit';
  end if;

  -- past_deadline fixture: assigned item, no redemption row, deadline already before now().
  -- Not produced by assign_carried_credit.
  insert into public.challenge_cycles (id, user_id, cycle_month, status, swap_count_used)
  values ('e2ac0000-0000-4000-8000-000000000461', past_user, chicago, 'active', 0);
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, redemption_deadline
  ) values (
    'e2ac0000-0000-4000-8000-000000000462', 'e2ac0000-0000-4000-8000-000000000461',
    past_rest, 1, 'assigned', now() - interval '1 hour'
  ) returning id into past_item;
  select * into issued from public.issue_challenge_redemption(
    past_user, past_item, repeat('e2', 32), 'cipher', 'iviviviviviv', now() + interval '2 days'
  );
  if issued.outcome is distinct from 'past_deadline'
     or exists (select 1 from public.redemptions where challenge_item_id = past_item)
     or (select status from public.challenge_items where id = past_item) is distinct from 'assigned' then
    raise exception 'FAIL: past_deadline fixture was %', issued.outcome;
  end if;
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, redemption_deadline
  ) values (
    'e2ac0000-0000-4000-8000-000000000463', 'e2ac0000-0000-4000-8000-000000000461',
    redeemed_rest, 2, 'redeemed', now() + interval '1 day'
  ) returning id into redeemed_item;
  insert into public.redemptions (
    user_id, restaurant_id, challenge_item_id, token_hash, encrypted_code, code_iv, status, expires_at
  ) values (
    past_user, redeemed_rest, redeemed_item, repeat('cd', 32), 'cipher', 'iviviviviviv', 'verified', now() + interval '1 day'
  );
  select * into issued from public.issue_challenge_redemption(
    past_user, redeemed_item, repeat('cd', 32), 'cipher', 'iviviviviviv', now() + interval '2 days'
  );
  if issued.outcome is distinct from 'existing' then
    raise exception 'FAIL: redeemed item was %', issued.outcome;
  end if;
  update public.challenge_items
  set redemption_deadline = now() - interval '1 hour'
  where id = redeemed_item;
  select * into issued from public.issue_challenge_redemption(
    past_user, redeemed_item, repeat('cd', 32), 'cipher', 'iviviviviviv', now() + interval '2 days'
  );
  if issued.outcome is distinct from 'existing'
     or (select count(*) from public.redemptions where challenge_item_id = redeemed_item) is distinct from 1 then
    raise exception 'FAIL: redeemed past deadline was %', issued.outcome;
  end if;

  -- expiry due fixture: linked credit, reserved capacity, deadline already before now().
  -- Separate from the past_deadline no-code fixture.
  insert into public.challenge_cycles (id, user_id, cycle_month, status, swap_count_used)
  values ('e2ac0000-0000-4000-8000-000000000471', expiry_user, prev, 'active', 0);
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
  ) values (
    'e2ac0000-0000-4000-8000-000000000472', 'e2ac0000-0000-4000-8000-000000000471',
    std, 1, 'assigned', v_std, now() - interval '2 days', now() - interval '1 hour'
  ) returning id into expiry_item;
  insert into public.entitlement_credits (
    id, user_id, issue_period, slot_number, status, challenge_item_id, expires_at
  ) values (
    expiry_credit, expiry_user, prev, 1, 'linked', expiry_item, t2
  );
  update public.challenge_items set credit_id = expiry_credit where id = expiry_item;
  insert into public.capacity_reservations (
    challenge_item_id, offer_version_id, restaurant_id, capacity_timezone, bucket_start, status
  ) values (
    expiry_item, v_std, std, 'America/Chicago', chicago, 'reserved'
  );
  expired_text := public.expire_version_bound_assignment(expiry_item);
  if expired_text is distinct from 'expired'
     or (select status from public.challenge_items where id = expiry_item) is distinct from 'expired'
     or (select status from public.entitlement_credits where id = expiry_credit) is distinct from 'expired'
     or exists (
       select 1 from public.capacity_reservations
       where challenge_item_id = expiry_item and status = 'reserved'
     )
     or not exists (
       select 1 from public.capacity_reservations
       where challenge_item_id = expiry_item and status = 'released'
     ) then
    raise exception 'FAIL: expiry due fixture outcome % item % credit % credit_id % reservations %',
      expired_text,
      (select status from public.challenge_items where id = expiry_item),
      (select status from public.entitlement_credits where id = expiry_credit),
      (select credit_id from public.challenge_items where id = expiry_item),
      (select string_agg(status, ',') from public.capacity_reservations where challenge_item_id = expiry_item);
  end if;

  if (select array_agg(id order by id) from public.user_profiles where workflow_version = 'credits')
     is distinct from credits_ids then
    raise exception 'FAIL: workflow_version set changed';
  end if;
end $$;

rollback;
select 'PASS: E02 carried assignment, floor, deadline, and grants';
