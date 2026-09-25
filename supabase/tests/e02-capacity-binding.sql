-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '20s';

insert into auth.users (id) values
  ('e0200000-0000-4000-8000-000000000001'),
  ('e0200000-0000-4000-8000-000000000002'),
  ('e0200000-0000-4000-8000-000000000003');
insert into public.user_profiles (id, subscription_status, role) values
  ('e0200000-0000-4000-8000-000000000001', 'active', 'subscriber'),
  ('e0200000-0000-4000-8000-000000000002', 'active', 'subscriber'),
  ('e0200000-0000-4000-8000-000000000003', 'active', 'admin');
insert into public.markets (id, name, slug)
  values ('e0200000-0000-4000-8000-000000000010', 'E02 Market', 'e02-market');

insert into public.restaurants (id, name, status, market_id) values
  ('e0200000-0000-4000-8000-000000000021', 'E02 Legacy A', 'active', 'e0200000-0000-4000-8000-000000000010'),
  ('e0200000-0000-4000-8000-000000000022', 'E02 Legacy B', 'active', 'e0200000-0000-4000-8000-000000000010'),
  ('e0200000-0000-4000-8000-000000000023', 'E02 Legacy Low', 'active', 'e0200000-0000-4000-8000-000000000010'),
  ('e0200000-0000-4000-8000-000000000031', 'E02 Version A', 'paused', 'e0200000-0000-4000-8000-000000000010'),
  ('e0200000-0000-4000-8000-000000000032', 'E02 Version B', 'active', 'e0200000-0000-4000-8000-000000000010'),
  ('e0200000-0000-4000-8000-000000000033', 'E02 Cap', 'active', 'e0200000-0000-4000-8000-000000000010');

insert into public.restaurant_offers (restaurant_id, active, discount_amount_cents, min_spend_cents) values
  ('e0200000-0000-4000-8000-000000000021', true, 1000, 4000),
  ('e0200000-0000-4000-8000-000000000022', true, 1000, 4000),
  ('e0200000-0000-4000-8000-000000000023', true, 999, 4000);

insert into public.offer_versions (
  id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
  capacity_timezone, capacity_window_kind, capacity_max_redemptions, published_by
) values
  (
    'e0200000-0000-4000-8000-0000000000a1',
    'e0200000-0000-4000-8000-000000000031',
    'America/Chicago', now() - interval '1 day', now() + interval '400 days',
    '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    'America/Chicago', 'calendar_month', 5,
    'e0200000-0000-4000-8000-000000000003'
  ),
  (
    'e0200000-0000-4000-8000-0000000000a2',
    'e0200000-0000-4000-8000-000000000032',
    'America/Chicago', now() - interval '1 day', now() + interval '400 days',
    '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    'America/Chicago', 'calendar_month', 5,
    'e0200000-0000-4000-8000-000000000003'
  ),
  (
    'e0200000-0000-4000-8000-0000000000a3',
    'e0200000-0000-4000-8000-000000000033',
    'America/Chicago', now() - interval '1 day', now() + interval '400 days',
    '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    'America/Chicago', 'calendar_month', 1,
    'e0200000-0000-4000-8000-000000000003'
  );

update public.restaurants
set current_offer_version_id = 'e0200000-0000-4000-8000-0000000000a1'
where id = 'e0200000-0000-4000-8000-000000000031';
update public.restaurants
set current_offer_version_id = 'e0200000-0000-4000-8000-0000000000a2'
where id = 'e0200000-0000-4000-8000-000000000032';
update public.restaurants
set current_offer_version_id = 'e0200000-0000-4000-8000-0000000000a3'
where id = 'e0200000-0000-4000-8000-000000000033';

do $$
declare
  gen record;
  swapped record;
  issued record;
  expired text;
  chicago date;
  item_id uuid;
  other_item uuid;
  version_cycle uuid;
  n integer;
  deadline timestamptz;
  assigned timestamptz;
begin
  if public.chicago_month_start('2026-11-01 00:01+00') is distinct from date '2026-10-01' then
    raise exception 'FAIL: 00:01 UTC on the 1st is still the previous Chicago month';
  end if;
  if public.chicago_month_start('2026-11-01 06:00+00') is distinct from date '2026-11-01' then
    raise exception 'FAIL: 06:00 UTC on the 1st is not the new Chicago month';
  end if;

  chicago := public.chicago_month_start(now());
  select * into gen from public.generate_challenge_cycle(
    'e0200000-0000-4000-8000-000000000001',
    (chicago - interval '1 month')::date,
    'e0200000-0000-4000-8000-000000000010',
    array[
      'e0200000-0000-4000-8000-000000000031'::uuid,
      'e0200000-0000-4000-8000-000000000032'::uuid
    ]
  );
  if gen.outcome is distinct from 'local_month_not_open' or gen.cycle_id is not null then
    raise exception 'FAIL: wrong Chicago month inserted a version-bound cycle: %', gen.outcome;
  end if;

  select * into gen from public.generate_challenge_cycle(
    'e0200000-0000-4000-8000-000000000001',
    chicago,
    'e0200000-0000-4000-8000-000000000010',
    array[
      'e0200000-0000-4000-8000-000000000031'::uuid,
      'e0200000-0000-4000-8000-000000000032'::uuid
    ]
  );
  if gen.outcome is distinct from 'not_activatable' and gen.outcome is distinct from 'invalid_restaurants' then
    raise exception 'FAIL: paused version restaurant was accepted: %', gen.outcome;
  end if;

  if (public.activate_restaurant(
    'e0200000-0000-4000-8000-000000000031',
    'e0200000-0000-4000-8000-000000000003'
  ) ->> 'ok') is distinct from 'true' then
    raise exception 'FAIL: activate did not move the paused restaurant';
  end if;

  select * into gen from public.generate_challenge_cycle(
    'e0200000-0000-4000-8000-000000000001',
    chicago,
    'e0200000-0000-4000-8000-000000000010',
    array[
      'e0200000-0000-4000-8000-000000000021'::uuid,
      'e0200000-0000-4000-8000-000000000023'::uuid
    ]
  );
  if gen.outcome is distinct from 'pair_below_floor' then
    raise exception 'FAIL: 1999-cent legacy pair was accepted: %', gen.outcome;
  end if;

  select * into gen from public.generate_challenge_cycle(
    'e0200000-0000-4000-8000-000000000001',
    chicago,
    'e0200000-0000-4000-8000-000000000010',
    array[
      'e0200000-0000-4000-8000-000000000021'::uuid,
      'e0200000-0000-4000-8000-000000000022'::uuid
    ]
  );
  if gen.outcome is distinct from 'created' and gen.outcome is distinct from 'existing' then
    raise exception 'FAIL: 2000-cent legacy pair was rejected: %', gen.outcome;
  end if;

  select * into gen from public.generate_challenge_cycle(
    'e0200000-0000-4000-8000-000000000002',
    chicago,
    'e0200000-0000-4000-8000-000000000010',
    array[
      'e0200000-0000-4000-8000-000000000031'::uuid,
      'e0200000-0000-4000-8000-000000000032'::uuid
    ]
  );
  if gen.outcome is distinct from 'created' then
    raise exception 'FAIL: active version pair without a flat offer was rejected: %', gen.outcome;
  end if;
  version_cycle := gen.cycle_id;

  select ci.id, ci.assigned_at, ci.redemption_deadline
    into item_id, assigned, deadline
  from public.challenge_items ci
  where ci.cycle_id = gen.cycle_id and ci.slot_number = 1;
  if assigned is null or deadline is distinct from assigned + interval '840 hours' then
    raise exception 'FAIL: deadline is not assigned_at plus 840 hours';
  end if;
  select count(*) into n
  from public.capacity_reservations
  where challenge_item_id = item_id and status = 'reserved';
  if n < 1 then
    raise exception 'FAIL: version-bound item has no reservation';
  end if;

  select * into gen from public.generate_challenge_cycle(
    'e0200000-0000-4000-8000-000000000001',
    date_trunc('month', now())::date,
    'e0200000-0000-4000-8000-000000000010',
    array[
      'e0200000-0000-4000-8000-000000000033'::uuid,
      'e0200000-0000-4000-8000-000000000032'::uuid
    ]
  );
  if public.chicago_month_start(now()) is distinct from date_trunc('month', now())::date
     and gen.outcome is distinct from 'local_month_not_open' then
    raise exception 'FAIL: UTC month inserted a version-bound cycle at the previous Chicago evening: %', gen.outcome;
  end if;

  if has_function_privilege('anon', 'public.generate_challenge_cycle(uuid, date, uuid, uuid[])', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.generate_challenge_cycle(uuid, date, uuid, uuid[])', 'EXECUTE')
    or has_table_privilege('anon', 'public.capacity_reservations', 'SELECT')
    or has_table_privilege('authenticated', 'public.capacity_reservations', 'INSERT')
  then
    raise exception 'FAIL: client role can execute generate or write capacity_reservations';
  end if;

  select * into gen from public.generate_challenge_cycle(
    'e0200000-0000-4000-8000-000000000003',
    chicago,
    'e0200000-0000-4000-8000-000000000010',
    array[
      'e0200000-0000-4000-8000-000000000033'::uuid,
      'e0200000-0000-4000-8000-000000000021'::uuid
    ]
  );
  if gen.outcome is distinct from 'created' then
    raise exception 'FAIL: could not fill the last seat: %', gen.outcome;
  end if;

  select ci.id into other_item
  from public.challenge_items ci
  where ci.cycle_id = version_cycle and ci.status = 'assigned'
  limit 1;
  select * into swapped from public.swap_challenge_item(
    'e0200000-0000-4000-8000-000000000002',
    other_item,
    'e0200000-0000-4000-8000-000000000033'
  );
  if swapped.outcome is distinct from 'capacity_full' then
    raise exception 'FAIL: full replacement did not keep the original: %', swapped.outcome;
  end if;

  update public.challenge_items
  set redemption_deadline = now() - interval '1 minute'
  where id = item_id;
  expired := public.expire_version_bound_assignment(item_id);
  if expired is distinct from 'expired' then
    raise exception 'FAIL: never-opened item did not expire: %', expired;
  end if;
  if exists (
    select 1 from public.capacity_reservations
    where challenge_item_id = item_id and status = 'reserved'
  ) then
    raise exception 'FAIL: expiry left reserved rows';
  end if;

  perform 1;
end $$;

rollback;
select 'PASS: E02 capacity binding, pair floor, deadline, and grants';
