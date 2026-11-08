-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E07-A3: member creator check, partner rows stay partner, idempotent member insert.
begin;
set local statement_timeout = '15s';

do $$
declare
  member uuid := 'e07a3000-0000-4000-8000-000000000001';
  stranger uuid := 'e07a3000-0000-4000-8000-000000000002';
  grill uuid := 'e07a3000-0000-4000-8000-000000000011';
  version_id uuid := 'e07a3000-0000-4000-8000-000000000021';
  cycle_id uuid := 'e07a3000-0000-4000-8000-000000000031';
  item_id uuid := 'e07a3000-0000-4000-8000-000000000041';
  token_hash text := repeat('ab', 32);
  fn text := 'public.open_member_boost_arrival_session(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, text, uuid, text, integer, text, integer, integer, integer, boolean, jsonb)';
  opened jsonb;
  again jsonb;
  wrong jsonb;
  opened_id uuid;
  stored_expires timestamptz;
  stored_method text;
  stored_user uuid;
  stored_hash text;
  partner_method text;
  partner_user uuid;
  arrival timestamptz := '2026-09-19 03:30:00+00';
  first_expires timestamptz := '2026-09-19 07:30:00+00';
  later_expires timestamptz := '2026-09-19 09:30:00+00';
begin
  if has_function_privilege('anon', fn, 'EXECUTE')
     or has_function_privilege('authenticated', fn, 'EXECUTE')
     or not has_function_privilege('service_role', fn, 'EXECUTE') then
    raise exception 'FAIL: member arrival grants';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'boost_arrival_sessions'
      and column_name = 'check_in_method'
      and is_nullable = 'YES'
  ) or exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'boost_arrival_sessions'
      and column_name = 'created_by_token_hash'
      and is_nullable = 'NO'
  ) or exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'boost_arrival_sessions'
      and column_name = 'created_by_user_id'
      and is_nullable = 'NO'
  ) then
    raise exception 'FAIL: member check-in nullability';
  end if;

  insert into auth.users (id) values (member), (stranger);
  insert into public.user_profiles (id, subscription_status, is_admin) values
    (member, 'active', false),
    (stranger, 'active', false);
  insert into public.restaurants (id, name, status) values (grill, 'E07 A3 Grill', 'active');
  insert into public.offer_versions (
    id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
    capacity_timezone, capacity_window_kind, capacity_max_redemptions, boost_session_minutes
  ) values (
    version_id, grill, 'America/Chicago',
    '2026-09-01 05:00:00+00', '2026-12-01 06:00:00+00',
    '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    'America/Chicago', 'calendar_month', 20, null
  );
  insert into public.challenge_cycles (id, user_id, cycle_month, status) values
    (cycle_id, member, '2026-09-01', 'active');
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, offer_version_id, redemption_deadline
  ) values (
    item_id, cycle_id, grill, 1, 'assigned', version_id, '2026-10-01 00:00:00+00'
  );

  set local role service_role;

  opened := public.open_boost_arrival_session(
    grill, item_id, version_id, null, null, arrival, first_expires,
    'partner-key', token_hash, null, 0, null, 0, 0, 0, true, '["below_minimum"]'::jsonb
  );
  if opened ->> 'status' is distinct from 'created' then
    raise exception 'FAIL: partner open was %', opened;
  end if;
  select check_in_method, created_by_user_id
    into partner_method, partner_user
  from public.boost_arrival_sessions
  where id = (opened ->> 'session_id')::uuid;
  if partner_method is distinct from 'partner' or partner_user is not null then
    raise exception 'FAIL: partner row was not a partner creator';
  end if;
  reset role;
  update public.boost_arrival_sessions set status = 'closed' where id = (opened ->> 'session_id')::uuid;
  set local role service_role;

  wrong := public.open_member_boost_arrival_session(
    grill, item_id, version_id, null, 'boost-5', arrival, first_expires,
    'member-key', stranger, null, 0, null, 0, 0, 0, true, '["below_minimum"]'::jsonb
  );
  if wrong ->> 'status' is distinct from 'forbidden' then
    raise exception 'FAIL: stranger member open was %', wrong;
  end if;

  opened := public.open_member_boost_arrival_session(
    grill, item_id, version_id, null, 'boost-5', arrival, first_expires,
    'member-key', member, null, 0, null, 0, 0, 0, true, '["below_minimum"]'::jsonb
  );
  if opened ->> 'status' is distinct from 'created' then
    raise exception 'FAIL: member open was %', opened;
  end if;
  opened_id := (opened ->> 'session_id')::uuid;
  select expires_at, check_in_method, created_by_user_id, created_by_token_hash
    into stored_expires, stored_method, stored_user, stored_hash
  from public.boost_arrival_sessions
  where id = opened_id;
  if stored_method is distinct from 'member_geo'
     or stored_user is distinct from member
     or stored_hash is not null
     or stored_expires is distinct from first_expires then
    raise exception 'FAIL: member row shape';
  end if;

  again := public.open_member_boost_arrival_session(
    grill, item_id, version_id, null, 'other-boost', arrival, later_expires,
    'member-key', member, null, 0, null, 0, 0, 0, true, '["below_minimum"]'::jsonb
  );
  if again ->> 'status' is distinct from 'existing'
     or (again ->> 'session_id')::uuid is distinct from opened_id then
    raise exception 'FAIL: member retry was %', again;
  end if;
  if (select expires_at from public.boost_arrival_sessions where id = opened_id) is distinct from first_expires then
    raise exception 'FAIL: member retry moved expires_at';
  end if;

  reset role;

  begin
    insert into public.boost_arrival_sessions (
      restaurant_id, challenge_item_id, offer_version_id,
      arrival_at, expires_at, idempotency_key,
      created_by_token_hash, created_by_user_id, check_in_method
    ) values (
      grill, item_id, version_id, arrival, first_expires, 'both',
      token_hash, member, 'member_geo'
    );
    raise exception 'FAIL: both creators were stored';
  exception when check_violation then null; end;

  begin
    insert into public.boost_arrival_sessions (
      restaurant_id, challenge_item_id, offer_version_id,
      arrival_at, expires_at, idempotency_key,
      created_by_token_hash, created_by_user_id, check_in_method
    ) values (
      grill, item_id, version_id, arrival, first_expires, 'neither',
      null, null, 'partner'
    );
    raise exception 'FAIL: empty creator was stored';
  exception when check_violation then null; end;

  begin
    insert into public.boost_arrival_sessions (
      restaurant_id, challenge_item_id, offer_version_id,
      arrival_at, expires_at, idempotency_key,
      created_by_token_hash, created_by_user_id, check_in_method
    ) values (
      grill, item_id, version_id, arrival, first_expires, 'hash-on-member',
      token_hash, null, 'member_geo'
    );
    raise exception 'FAIL: member method with a partner hash was stored';
  exception when check_violation then null; end;

  begin
    insert into public.boost_arrival_sessions (
      restaurant_id, challenge_item_id, offer_version_id,
      arrival_at, expires_at, idempotency_key,
      created_by_token_hash, created_by_user_id, check_in_method
    ) values (
      grill, item_id, version_id, arrival, first_expires, 'stranger-direct',
      null, stranger, 'member_geo'
    );
    raise exception 'FAIL: stranger direct insert was stored';
  exception when check_violation then null; end;
end $$;

rollback;
