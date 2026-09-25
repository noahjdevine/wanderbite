-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '30s';

insert into auth.users (id) values
  ('e2b00000-0000-4000-8000-000000000001'),
  ('e2b00000-0000-4000-8000-000000000002'),
  ('e2b00000-0000-4000-8000-000000000003'),
  ('e2b00000-0000-4000-8000-000000000004'),
  ('e2b00000-0000-4000-8000-000000000005'),
  ('e2b00000-0000-4000-8000-000000000006'),
  ('e2b00000-0000-4000-8000-000000000007'),
  ('e2b00000-0000-4000-8000-000000000008'),
  ('e2b00000-0000-4000-8000-000000000009'),
  ('e2b00000-0000-4000-8000-00000000000a'),
  ('e2b00000-0000-4000-8000-00000000000b'),
  ('e2b00000-0000-4000-8000-00000000000c'),
  ('e2b00000-0000-4000-8000-00000000000d'),
  ('e2b00000-0000-4000-8000-00000000000e');

insert into public.user_profiles (id, subscription_status, role) values
  ('e2b00000-0000-4000-8000-000000000001', 'active', 'subscriber'),
  ('e2b00000-0000-4000-8000-000000000002', 'active', 'subscriber'),
  ('e2b00000-0000-4000-8000-000000000003', 'active', 'admin'),
  ('e2b00000-0000-4000-8000-000000000004', 'active', 'subscriber'),
  ('e2b00000-0000-4000-8000-000000000005', 'active', 'subscriber'),
  ('e2b00000-0000-4000-8000-000000000006', 'active', 'subscriber'),
  ('e2b00000-0000-4000-8000-000000000007', 'active', 'subscriber'),
  ('e2b00000-0000-4000-8000-000000000008', 'active', 'subscriber'),
  ('e2b00000-0000-4000-8000-000000000009', 'active', 'subscriber'),
  ('e2b00000-0000-4000-8000-00000000000a', 'active', 'subscriber'),
  ('e2b00000-0000-4000-8000-00000000000b', 'active', 'subscriber'),
  ('e2b00000-0000-4000-8000-00000000000c', 'active', 'subscriber'),
  ('e2b00000-0000-4000-8000-00000000000d', 'active', 'subscriber'),
  ('e2b00000-0000-4000-8000-00000000000e', 'active', 'subscriber');

update public.user_profiles
set workflow_version = 'credits'
where id in (
  'e2b00000-0000-4000-8000-000000000001',
  'e2b00000-0000-4000-8000-000000000002',
  'e2b00000-0000-4000-8000-000000000005',
  'e2b00000-0000-4000-8000-000000000007',
  'e2b00000-0000-4000-8000-000000000008',
  'e2b00000-0000-4000-8000-000000000009',
  'e2b00000-0000-4000-8000-00000000000a',
  'e2b00000-0000-4000-8000-00000000000b',
  'e2b00000-0000-4000-8000-00000000000e'
);

insert into public.markets (id, name, slug) values
  ('e2b00000-0000-4000-8000-000000000010', 'E02B Market', 'e02b-market'),
  ('e2b00000-0000-4000-8000-000000000011', 'E02B Other', 'e02b-other');

insert into public.restaurants (id, name, status, market_id) values
  ('e2b00000-0000-4000-8000-000000000021', 'E02B A', 'active', 'e2b00000-0000-4000-8000-000000000010'),
  ('e2b00000-0000-4000-8000-000000000022', 'E02B B', 'active', 'e2b00000-0000-4000-8000-000000000010'),
  ('e2b00000-0000-4000-8000-000000000023', 'E02B Low A', 'active', 'e2b00000-0000-4000-8000-000000000010'),
  ('e2b00000-0000-4000-8000-000000000024', 'E02B Low B', 'active', 'e2b00000-0000-4000-8000-000000000010'),
  ('e2b00000-0000-4000-8000-000000000031', 'E02B Paused', 'paused', 'e2b00000-0000-4000-8000-000000000010'),
  ('e2b00000-0000-4000-8000-000000000032', 'E02B Paused Mate', 'active', 'e2b00000-0000-4000-8000-000000000010'),
  ('e2b00000-0000-4000-8000-000000000041', 'E02B Flat A', 'active', 'e2b00000-0000-4000-8000-000000000010'),
  ('e2b00000-0000-4000-8000-000000000042', 'E02B Flat B', 'active', 'e2b00000-0000-4000-8000-000000000010'),
  ('e2b00000-0000-4000-8000-000000000051', 'E02B Withdrawn', 'active', 'e2b00000-0000-4000-8000-000000000010'),
  ('e2b00000-0000-4000-8000-000000000052', 'E02B Withdrawn Mate', 'active', 'e2b00000-0000-4000-8000-000000000010'),
  ('e2b00000-0000-4000-8000-000000000061', 'E02B Room', 'active', 'e2b00000-0000-4000-8000-000000000010'),
  ('e2b00000-0000-4000-8000-000000000062', 'E02B Full', 'active', 'e2b00000-0000-4000-8000-000000000010'),
  ('e2b00000-0000-4000-8000-000000000071', 'E02B Other Market', 'active', 'e2b00000-0000-4000-8000-000000000011');

insert into public.restaurant_offers (restaurant_id, active, discount_amount_cents, min_spend_cents) values
  ('e2b00000-0000-4000-8000-000000000041', true, 1000, 4000),
  ('e2b00000-0000-4000-8000-000000000042', true, 1000, 4000),
  ('e2b00000-0000-4000-8000-000000000021', true, 1000, 4000),
  ('e2b00000-0000-4000-8000-000000000022', true, 1000, 4000);

insert into public.offer_versions (
  id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
  capacity_timezone, capacity_window_kind, capacity_max_redemptions, published_by
) values
  ('e2b00000-0000-4000-8000-0000000000a1', 'e2b00000-0000-4000-8000-000000000021', 'America/Chicago', now() - interval '1 day', now() + interval '400 days', '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, 'e2b00000-0000-4000-8000-000000000003'),
  ('e2b00000-0000-4000-8000-0000000000a2', 'e2b00000-0000-4000-8000-000000000022', 'America/Chicago', now() - interval '1 day', now() + interval '400 days', '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, 'e2b00000-0000-4000-8000-000000000003'),
  ('e2b00000-0000-4000-8000-0000000000a3', 'e2b00000-0000-4000-8000-000000000023', 'America/Chicago', now() - interval '1 day', now() + interval '400 days', '[{"threshold_cents":4000,"discount_cents":500}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, 'e2b00000-0000-4000-8000-000000000003'),
  ('e2b00000-0000-4000-8000-0000000000a4', 'e2b00000-0000-4000-8000-000000000024', 'America/Chicago', now() - interval '1 day', now() + interval '400 days', '[{"threshold_cents":4000,"discount_cents":500}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, 'e2b00000-0000-4000-8000-000000000003'),
  ('e2b00000-0000-4000-8000-0000000000b1', 'e2b00000-0000-4000-8000-000000000031', 'America/Chicago', now() - interval '1 day', now() + interval '400 days', '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, 'e2b00000-0000-4000-8000-000000000003'),
  ('e2b00000-0000-4000-8000-0000000000b2', 'e2b00000-0000-4000-8000-000000000032', 'America/Chicago', now() - interval '1 day', now() + interval '400 days', '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, 'e2b00000-0000-4000-8000-000000000003'),
  ('e2b00000-0000-4000-8000-0000000000c1', 'e2b00000-0000-4000-8000-000000000051', 'America/Chicago', now() - interval '1 day', now() + interval '400 days', '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, 'e2b00000-0000-4000-8000-000000000003'),
  ('e2b00000-0000-4000-8000-0000000000c2', 'e2b00000-0000-4000-8000-000000000052', 'America/Chicago', now() - interval '1 day', now() + interval '400 days', '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, 'e2b00000-0000-4000-8000-000000000003'),
  ('e2b00000-0000-4000-8000-0000000000d1', 'e2b00000-0000-4000-8000-000000000061', 'America/Chicago', now() - interval '1 day', now() + interval '400 days', '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, 'e2b00000-0000-4000-8000-000000000003'),
  ('e2b00000-0000-4000-8000-0000000000d2', 'e2b00000-0000-4000-8000-000000000062', 'America/Chicago', now() - interval '1 day', now() + interval '400 days', '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 1, 'e2b00000-0000-4000-8000-000000000003'),
  ('e2b00000-0000-4000-8000-0000000000e1', 'e2b00000-0000-4000-8000-000000000071', 'America/Chicago', now() - interval '1 day', now() + interval '400 days', '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', 5, 'e2b00000-0000-4000-8000-000000000003');

update public.restaurants set current_offer_version_id = 'e2b00000-0000-4000-8000-0000000000a1' where id = 'e2b00000-0000-4000-8000-000000000021';
update public.restaurants set current_offer_version_id = 'e2b00000-0000-4000-8000-0000000000a2' where id = 'e2b00000-0000-4000-8000-000000000022';
update public.restaurants set current_offer_version_id = 'e2b00000-0000-4000-8000-0000000000a3' where id = 'e2b00000-0000-4000-8000-000000000023';
update public.restaurants set current_offer_version_id = 'e2b00000-0000-4000-8000-0000000000a4' where id = 'e2b00000-0000-4000-8000-000000000024';
update public.restaurants set current_offer_version_id = 'e2b00000-0000-4000-8000-0000000000b1' where id = 'e2b00000-0000-4000-8000-000000000031';
update public.restaurants set current_offer_version_id = 'e2b00000-0000-4000-8000-0000000000b2' where id = 'e2b00000-0000-4000-8000-000000000032';
update public.restaurants set current_offer_version_id = 'e2b00000-0000-4000-8000-0000000000c1' where id = 'e2b00000-0000-4000-8000-000000000051';
update public.restaurants set current_offer_version_id = 'e2b00000-0000-4000-8000-0000000000c2' where id = 'e2b00000-0000-4000-8000-000000000052';
update public.restaurants set current_offer_version_id = 'e2b00000-0000-4000-8000-0000000000d1' where id = 'e2b00000-0000-4000-8000-000000000061';
update public.restaurants set current_offer_version_id = 'e2b00000-0000-4000-8000-0000000000d2' where id = 'e2b00000-0000-4000-8000-000000000062';
update public.restaurants set current_offer_version_id = 'e2b00000-0000-4000-8000-0000000000e1' where id = 'e2b00000-0000-4000-8000-000000000071';
update public.offer_versions
set withdrawn_from_selection_at = now()
where id = 'e2b00000-0000-4000-8000-0000000000c1';

do $$
declare
  chicago date;
  market uuid := 'e2b00000-0000-4000-8000-000000000010';
  happy uuid := 'e2b00000-0000-4000-8000-000000000001';
  cap_user uuid := 'e2b00000-0000-4000-8000-000000000002';
  legacy uuid := 'e2b00000-0000-4000-8000-000000000004';
  incomplete uuid := 'e2b00000-0000-4000-8000-000000000005';
  filler uuid := 'e2b00000-0000-4000-8000-000000000006';
  low_user uuid := 'e2b00000-0000-4000-8000-000000000007';
  paused_user uuid := 'e2b00000-0000-4000-8000-000000000008';
  other_user uuid := 'e2b00000-0000-4000-8000-000000000009';
  flat_user uuid := 'e2b00000-0000-4000-8000-00000000000a';
  withdrawn_user uuid := 'e2b00000-0000-4000-8000-00000000000b';
  privilege uuid := 'e2b00000-0000-4000-8000-00000000000c';
  expired_user uuid := 'e2b00000-0000-4000-8000-00000000000e';
  outcome text;
  linked record;
  again record;
  legacy_gen record;
  issued record;
  verified_row record;
  expired_text text;
  n integer;
  cycle_id uuid;
  item_a uuid;
  item_b uuid;
  filler_item uuid;
  filler_cycle uuid;
  stored timestamptz;
  expected timestamptz;
begin
  if (date '2026-03-01' + interval '1 month')::timestamp at time zone 'America/Chicago'
     is distinct from timestamptz '2026-04-01 05:00:00+00' then
    raise exception 'FAIL: April Chicago midnight is not 05:00 UTC';
  end if;
  if (date '2026-11-01' + interval '1 month')::timestamp at time zone 'America/Chicago'
     is distinct from timestamptz '2026-12-01 06:00:00+00' then
    raise exception 'FAIL: December Chicago midnight is not 06:00 UTC';
  end if;
  if (date '2026-02-01' + interval '1 month')::timestamp at time zone 'America/Chicago'
     is distinct from timestamptz '2026-03-01 06:00:00+00' then
    raise exception 'FAIL: March Chicago midnight is not 06:00 UTC';
  end if;
  if (date '2026-10-01' + interval '1 month')::timestamp at time zone 'America/Chicago'
     is distinct from timestamptz '2026-11-01 05:00:00+00' then
    raise exception 'FAIL: November Chicago midnight is not 05:00 UTC';
  end if;

  if has_function_privilege('anon', 'public.issue_period_credits(uuid, date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.issue_period_credits(uuid, date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.link_pending_credits(uuid, date, uuid, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.link_pending_credits(uuid, date, uuid, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.expire_due_pending_credits()', 'EXECUTE')
     or has_table_privilege('anon', 'public.entitlement_credits', 'SELECT')
     or has_table_privilege('authenticated', 'public.entitlement_credits', 'INSERT')
     or has_table_privilege('authenticated', 'public.entitlement_credits', 'UPDATE')
     or has_column_privilege('authenticated', 'public.user_profiles', 'workflow_version', 'UPDATE')
     or has_column_privilege('authenticated', 'public.user_profiles', 'workflow_version', 'INSERT')
  then
    raise exception 'FAIL: client role can write credits or workflow_version';
  end if;

  if pg_get_functiondef('public.link_pending_credits(uuid,date,uuid,uuid,uuid)'::regprocedure) like '%generate_challenge_cycle%' then
    raise exception 'FAIL: link_pending_credits calls generate_challenge_cycle';
  end if;

  perform set_config('request.jwt.claim.sub', privilege::text, true);
  begin
    set local role authenticated;
    update public.user_profiles set workflow_version = 'credits' where id = privilege;
    raise exception 'FAIL: authenticated updated workflow_version';
  exception
    when insufficient_privilege then
      null;
  end;
  reset role;
  if (select workflow_version from public.user_profiles where id = privilege) is distinct from 'legacy' then
    raise exception 'FAIL: workflow_version changed without a grant';
  end if;

  grant update (workflow_version) on table public.user_profiles to authenticated;
  begin
    set local role authenticated;
    update public.user_profiles set workflow_version = 'credits' where id = privilege;
    raise exception 'FAIL: trigger allowed workflow_version = credits';
  exception
    when insufficient_privilege then
      null;
  end;
  reset role;
  revoke update (workflow_version) on table public.user_profiles from authenticated;
  if (select workflow_version from public.user_profiles where id = privilege) is distinct from 'legacy' then
    raise exception 'FAIL: trigger left workflow_version as credits';
  end if;

  begin
    set local role authenticated;
    insert into public.user_profiles (id, workflow_version)
    values ('e2b00000-0000-4000-8000-00000000000d', 'credits');
    raise exception 'FAIL: authenticated insert set workflow_version';
  exception
    when insufficient_privilege then
      null;
  end;
  reset role;

  chicago := public.chicago_month_start(now());
  outcome := public.issue_period_credits(happy, chicago);
  if outcome is distinct from 'created' then
    raise exception 'FAIL: first issue was %', outcome;
  end if;
  select expires_at into stored
  from public.entitlement_credits
  where user_id = happy and slot_number = 1;
  expected := (chicago + interval '1 month')::timestamp at time zone 'America/Chicago';
  if stored is distinct from expected then
    raise exception 'FAIL: issued expires_at % is not %', stored, expected;
  end if;
  if (select count(*) from public.challenge_cycles where user_id = happy) <> 0
     or (select count(*) from public.entitlement_credits where user_id = happy) <> 2 then
    raise exception 'FAIL: issue created a cycle or the wrong credit count';
  end if;
  outcome := public.issue_period_credits(happy, chicago);
  if outcome is distinct from 'existing' then
    raise exception 'FAIL: second issue was %', outcome;
  end if;

  insert into public.entitlement_credits (user_id, issue_period, slot_number, status, expires_at)
  values (incomplete, chicago, 1, 'pending', expected);
  outcome := public.issue_period_credits(incomplete, chicago);
  if outcome is distinct from 'incomplete_credits' then
    raise exception 'FAIL: one slot issue was %', outcome;
  end if;
  outcome := public.issue_period_credits(incomplete, chicago);
  if outcome is distinct from 'incomplete_credits'
     or (select count(*) from public.entitlement_credits where user_id = incomplete) <> 1 then
    raise exception 'FAIL: one slot was filled on retry';
  end if;

  select * into legacy_gen from public.generate_challenge_cycle(
    legacy, chicago, market,
    array['e2b00000-0000-4000-8000-000000000041'::uuid, 'e2b00000-0000-4000-8000-000000000042'::uuid]
  );
  if legacy_gen.outcome is distinct from 'created' then
    raise exception 'FAIL: legacy generate was %', legacy_gen.outcome;
  end if;
  if exists (select 1 from public.entitlement_credits where user_id = legacy) then
    raise exception 'FAIL: legacy generate wrote credits';
  end if;

  outcome := public.issue_period_credits(low_user, chicago);
  outcome := public.issue_period_credits(paused_user, chicago);
  outcome := public.issue_period_credits(other_user, chicago);
  outcome := public.issue_period_credits(flat_user, chicago);
  outcome := public.issue_period_credits(withdrawn_user, chicago);
  outcome := public.issue_period_credits(cap_user, chicago);
  outcome := public.issue_period_credits(expired_user, chicago);
  if (select count(*) from public.entitlement_credits
      where user_id in (low_user, paused_user, other_user, flat_user, withdrawn_user, cap_user, expired_user)
        and status = 'pending') <> 14 then
    raise exception 'FAIL: refusal users were not issued two pending credits';
  end if;

  select * into linked from public.link_pending_credits(
    low_user, chicago, market,
    'e2b00000-0000-4000-8000-000000000023',
    'e2b00000-0000-4000-8000-000000000024'
  );
  if linked.outcome is distinct from 'pair_below_floor' then
    raise exception 'FAIL: 1000-cent version pair was %', linked.outcome;
  end if;

  select * into linked from public.link_pending_credits(
    paused_user, chicago, market,
    'e2b00000-0000-4000-8000-000000000031',
    'e2b00000-0000-4000-8000-000000000032'
  );
  if linked.outcome is distinct from 'invalid_restaurants' then
    raise exception 'FAIL: paused restaurant was %', linked.outcome;
  end if;

  select * into linked from public.link_pending_credits(
    other_user, chicago, market,
    'e2b00000-0000-4000-8000-000000000071',
    'e2b00000-0000-4000-8000-000000000022'
  );
  if linked.outcome is distinct from 'invalid_restaurants' then
    raise exception 'FAIL: other-market restaurant was %', linked.outcome;
  end if;

  select * into linked from public.link_pending_credits(
    flat_user, chicago, market,
    'e2b00000-0000-4000-8000-000000000041',
    'e2b00000-0000-4000-8000-000000000042'
  );
  if linked.outcome is distinct from 'invalid_restaurants' then
    raise exception 'FAIL: flat offer without a version was %', linked.outcome;
  end if;
  if public.restaurant_base_cents('e2b00000-0000-4000-8000-000000000041') is distinct from 1000 then
    raise exception 'FAIL: fixture flat offer is not what restaurant_base_cents accepts';
  end if;

  select * into linked from public.link_pending_credits(
    withdrawn_user, chicago, market,
    'e2b00000-0000-4000-8000-000000000051',
    'e2b00000-0000-4000-8000-000000000052'
  );
  if linked.outcome is distinct from 'invalid_restaurants' then
    raise exception 'FAIL: withdrawn version was %', linked.outcome;
  end if;

  if exists (
    select 1 from public.challenge_cycles
    where user_id in (low_user, paused_user, other_user, flat_user, withdrawn_user)
  ) or exists (
    select 1 from public.entitlement_credits
    where user_id in (low_user, paused_user, other_user, flat_user, withdrawn_user)
      and status is distinct from 'pending'
  ) then
    raise exception 'FAIL: an ineligible pair wrote a cycle or moved a credit';
  end if;

  insert into public.challenge_cycles (id, user_id, cycle_month, status, swap_count_used)
  values ('e2b00000-0000-4000-8000-0000000000f1', filler, chicago, 'active', 0)
  returning id into filler_cycle;
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
  ) values (
    'e2b00000-0000-4000-8000-0000000000f2', filler_cycle,
    'e2b00000-0000-4000-8000-000000000062', 1, 'assigned',
    'e2b00000-0000-4000-8000-0000000000d2', now(), now() + interval '840 hours'
  ) returning id into filler_item;
  insert into public.capacity_reservations (
    challenge_item_id, offer_version_id, restaurant_id, capacity_timezone, bucket_start, status
  ) values (
    filler_item, 'e2b00000-0000-4000-8000-0000000000d2',
    'e2b00000-0000-4000-8000-000000000062', 'America/Chicago', chicago, 'reserved'
  );

  select * into linked from public.link_pending_credits(
    cap_user, chicago, market,
    'e2b00000-0000-4000-8000-000000000061',
    'e2b00000-0000-4000-8000-000000000062'
  );
  if linked.outcome is distinct from 'capacity_full' or linked.cycle_id is not null then
    raise exception 'FAIL: second-restaurant capacity was %', linked.outcome;
  end if;
  if (select count(*) from public.entitlement_credits where user_id = cap_user and status = 'pending') <> 2
     or exists (select 1 from public.challenge_cycles where user_id = cap_user)
     or exists (
       select 1 from public.capacity_reservations
       where restaurant_id = 'e2b00000-0000-4000-8000-000000000061'
     )
     or (select count(*) from public.capacity_reservations
         where restaurant_id = 'e2b00000-0000-4000-8000-000000000062' and status = 'reserved') <> 1
  then
    raise exception 'FAIL: capacity rollback left a cycle, item, or extra reservation';
  end if;

  select * into linked from public.link_pending_credits(
    happy, chicago, market,
    'e2b00000-0000-4000-8000-000000000021',
    'e2b00000-0000-4000-8000-000000000022'
  );
  if linked.outcome is distinct from 'linked' or linked.cycle_id is null then
    raise exception 'FAIL: valid pair was %', linked.outcome;
  end if;
  cycle_id := linked.cycle_id;
  select * into again from public.link_pending_credits(
    happy, chicago, market,
    'e2b00000-0000-4000-8000-000000000021',
    'e2b00000-0000-4000-8000-000000000022'
  );
  if again.outcome is distinct from 'existing' or again.cycle_id is distinct from cycle_id
     or (select count(*) from public.challenge_cycles where user_id = happy) <> 1
     or (select count(*) from public.entitlement_credits where user_id = happy and status = 'linked') <> 2
  then
    raise exception 'FAIL: duplicate reveal did not reuse the cycle';
  end if;

  select id into item_a from public.challenge_items where cycle_id = cycle_id and slot_number = 1;
  select id into item_b from public.challenge_items where cycle_id = cycle_id and slot_number = 2;
  select * into issued from public.issue_challenge_redemption(
    happy, item_a,
    'abababababababababababababababababababababababababababababababab',
    'cipher', 'iviviviviviv', now() + interval '2 days'
  );
  if issued.outcome is distinct from 'created' then
    raise exception 'FAIL: issue code was %', issued.outcome;
  end if;
  if (select status from public.entitlement_credits where user_id = happy and slot_number = 1) is distinct from 'linked' then
    raise exception 'FAIL: issuing a code spent the credit';
  end if;

  select * into verified_row from public.verify_redemption_and_settle(
    'abababababababababababababababababababababababababababababababab',
    'e2b00000-0000-4000-8000-000000000021'
  );
  if verified_row.id is null
     or (select status from public.entitlement_credits where user_id = happy and slot_number = 1) is distinct from 'spent'
     or (select status from public.entitlement_credits where user_id = happy and slot_number = 2) is distinct from 'linked'
  then
    raise exception 'FAIL: verify did not spend only the verified credit';
  end if;
  select * into again from public.link_pending_credits(
    happy, chicago, market,
    'e2b00000-0000-4000-8000-000000000021',
    'e2b00000-0000-4000-8000-000000000022'
  );
  if again.outcome is distinct from 'existing' or again.cycle_id is distinct from cycle_id then
    raise exception 'FAIL: spent plus linked reveal created another cycle';
  end if;

  update public.challenge_items
  set redemption_deadline = now() - interval '1 minute'
  where id = item_b;
  expired_text := public.expire_version_bound_assignment(item_b);
  if expired_text is distinct from 'expired' then
    raise exception 'FAIL: sibling expiry was %', expired_text;
  end if;
  if (select status from public.entitlement_credits where challenge_item_id = item_b) is distinct from 'expired'
     or (select challenge_item_id from public.entitlement_credits where challenge_item_id = item_b) is null
     or (select status from public.entitlement_credits where user_id = happy and slot_number = 1) is distinct from 'spent'
     or exists (
       select 1 from public.capacity_reservations
       where challenge_item_id = item_b and status = 'reserved'
     )
  then
    raise exception 'FAIL: one-item expiry changed the sibling or dropped the item link';
  end if;
  select * into again from public.link_pending_credits(
    happy, chicago, market,
    'e2b00000-0000-4000-8000-000000000021',
    'e2b00000-0000-4000-8000-000000000022'
  );
  if again.outcome is distinct from 'existing' or again.cycle_id is distinct from cycle_id
     or (select count(*) from public.entitlement_credits where user_id = happy) <> 2
     or (select count(*) from public.challenge_cycles where user_id = happy) <> 1
  then
    raise exception 'FAIL: spent plus expired reveal created another pair';
  end if;

  update public.entitlement_credits
  set expires_at = now() - interval '1 minute'
  where user_id = expired_user and status = 'pending';
  select * into linked from public.link_pending_credits(
    expired_user, chicago, market,
    'e2b00000-0000-4000-8000-000000000021',
    'e2b00000-0000-4000-8000-000000000022'
  );
  if linked.outcome is distinct from 'credits_expired'
     or exists (select 1 from public.challenge_cycles where user_id = expired_user)
     or exists (
       select 1 from public.entitlement_credits
       where user_id = expired_user and (status is distinct from 'expired' or challenge_item_id is not null)
     )
  then
    raise exception 'FAIL: past expires_at was %', linked.outcome;
  end if;

  begin
    insert into public.entitlement_credits (
      user_id, issue_period, slot_number, status, challenge_item_id, expires_at
    ) values (
      filler, date '2020-01-01', 1, 'pending', filler_item, now()
    );
    raise exception 'FAIL: pending credit accepted an item id';
  exception
    when check_violation then
      null;
  end;
  insert into public.entitlement_credits (
    user_id, issue_period, slot_number, status, challenge_item_id, expires_at
  ) values (
    filler, date '2020-01-01', 1, 'expired', filler_item, now()
  );
  get diagnostics n = row_count;
  if n is distinct from 1 then
    raise exception 'FAIL: expired credit could not keep its item id';
  end if;
end $$;

rollback;
select 'PASS: E02-B credits, locks, expiry, and workflow grants';
