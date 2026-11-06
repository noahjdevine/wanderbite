-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E07-A2: grants, restaurant scope, idempotency, one open session, append-only quotes.
begin;
set local statement_timeout = '15s';

do $$
declare
  member uuid := 'e0700000-0000-4000-8000-000000000001';
  grill uuid := 'e0700000-0000-4000-8000-000000000011';
  other uuid := 'e0700000-0000-4000-8000-000000000012';
  version_id uuid := 'e0700000-0000-4000-8000-000000000021';
  other_version uuid := 'e0700000-0000-4000-8000-000000000022';
  cycle_id uuid := 'e0700000-0000-4000-8000-000000000031';
  other_cycle uuid := 'e0700000-0000-4000-8000-000000000032';
  item_id uuid := 'e0700000-0000-4000-8000-000000000041';
  second_item uuid := 'e0700000-0000-4000-8000-000000000042';
  other_item uuid := 'e0700000-0000-4000-8000-000000000043';
  redemption uuid := 'e0700000-0000-4000-8000-000000000051';
  token_hash text := repeat('ab', 32);
  opened jsonb;
  again jsonb;
  wrong jsonb;
  second jsonb;
  bad_parts jsonb;
  corrected jsonb;
  opened_id uuid;
  stored_expires timestamptz;
  stored_arrival timestamptz;
  stored_lock text;
  open_count integer;
  active_count integer;
  quote_count integer;
  first_expires timestamptz := '2026-09-19 07:30:00+00';
  later_expires timestamptz := '2026-09-19 09:30:00+00';
  arrival timestamptz := '2026-09-19 03:30:00+00';
begin
  if not (select relrowsecurity from pg_class where oid = 'public.boost_arrival_sessions'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.boost_quotes'::regclass) then
    raise exception 'FAIL: arrival RLS disabled';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('boost_arrival_sessions', 'boost_quotes')
  ) then
    raise exception 'FAIL: arrival client policy exists';
  end if;
  if exists (
    select 1
    from pg_class
    cross join lateral aclexplode(coalesce(relacl, '{}'::aclitem[])) acl
    where oid in ('public.boost_arrival_sessions'::regclass, 'public.boost_quotes'::regclass)
      and (acl.grantee = 0 or acl.grantee in ('anon'::regrole, 'authenticated'::regrole))
  ) then
    raise exception 'FAIL: public, anon, or authenticated privileges remain';
  end if;
  if has_table_privilege('anon', 'public.boost_arrival_sessions', 'SELECT')
     or has_table_privilege('authenticated', 'public.boost_quotes', 'SELECT')
     or has_table_privilege('anon', 'public.boost_quotes', 'INSERT')
     or has_table_privilege('authenticated', 'public.boost_arrival_sessions', 'INSERT')
     or not has_table_privilege('service_role', 'public.boost_arrival_sessions', 'SELECT')
     or not has_table_privilege('service_role', 'public.boost_arrival_sessions', 'INSERT')
     or has_table_privilege('service_role', 'public.boost_arrival_sessions', 'UPDATE')
     or has_table_privilege('service_role', 'public.boost_arrival_sessions', 'DELETE')
     or not has_table_privilege('service_role', 'public.boost_quotes', 'SELECT')
     or not has_table_privilege('service_role', 'public.boost_quotes', 'INSERT')
     or not has_table_privilege('service_role', 'public.boost_quotes', 'UPDATE')
     or has_table_privilege('service_role', 'public.boost_quotes', 'DELETE')
     or has_function_privilege('anon', 'public.open_boost_arrival_session(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, text, text, text, integer, text, integer, integer, integer, boolean, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.supersede_boost_arrival_quote(uuid, uuid, timestamptz, integer, text, integer, text, integer, integer, integer, boolean, jsonb, timestamptz)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.open_boost_arrival_session(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, text, text, text, integer, text, integer, integer, integer, boolean, jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.supersede_boost_arrival_quote(uuid, uuid, timestamptz, integer, text, integer, text, integer, integer, integer, boolean, jsonb, timestamptz)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.boost_arrival_sessions_scope()', 'EXECUTE')
     or has_function_privilege('anon', 'public.boost_quotes_match_session()', 'EXECUTE') then
    raise exception 'FAIL: arrival grants';
  end if;

  insert into auth.users (id) values (member);
  insert into public.user_profiles (id, subscription_status, is_admin)
    values (member, 'active', false);
  insert into public.restaurants (id, name, status) values
    (grill, 'E07 Grill', 'active'),
    (other, 'E07 Other', 'active');
  insert into public.offer_versions (
    id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
    capacity_timezone, capacity_window_kind, capacity_max_redemptions, boost_session_minutes
  ) values
    (
      version_id, grill, 'America/Chicago',
      '2026-09-01 05:00:00+00', '2026-12-01 06:00:00+00',
      '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      'America/Chicago', 'calendar_month', 20, null
    ),
    (
      other_version, other, 'America/Chicago',
      '2026-09-01 05:00:00+00', '2026-12-01 06:00:00+00',
      '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      'America/Chicago', 'calendar_month', 20, null
    );
  insert into public.challenge_cycles (id, user_id, cycle_month, status) values
    (cycle_id, member, '2026-09-01', 'active'),
    (other_cycle, member, '2026-10-01', 'active');
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, offer_version_id, redemption_deadline
  ) values
    (item_id, cycle_id, grill, 1, 'assigned', version_id, '2026-10-01 00:00:00+00'),
    (second_item, other_cycle, grill, 1, 'assigned', version_id, '2026-10-01 00:00:00+00'),
    (other_item, cycle_id, other, 2, 'assigned', other_version, '2026-10-01 00:00:00+00');
  insert into public.redemptions (id, user_id, restaurant_id, challenge_item_id, token_hash, status)
    values (redemption, member, other, other_item, repeat('cd', 32), 'issued');

  set local role service_role;

  begin
    update public.boost_arrival_sessions set expires_at = later_expires where false;
    raise exception 'FAIL: service_role updated a session';
  exception when insufficient_privilege then null; end;

  wrong := public.open_boost_arrival_session(
    other, item_id, version_id, null, 'boost-5', arrival, first_expires,
    'key-1', token_hash, 'threshold:4000', 1000, null, 0, 1000, 8200, false, '["quoted"]'::jsonb
  );
  if wrong ->> 'status' is distinct from 'restaurant_mismatch'
     or exists (select 1 from public.boost_arrival_sessions) then
    raise exception 'FAIL: cross-restaurant session was stored: %', wrong;
  end if;

  wrong := public.open_boost_arrival_session(
    grill, item_id, version_id, redemption, 'boost-5', arrival, first_expires,
    'key-link', token_hash, 'threshold:4000', 1000, null, 0, 1000, 8200, false, '["quoted"]'::jsonb
  );
  if wrong ->> 'status' is distinct from 'redemption_mismatch'
     or exists (select 1 from public.boost_arrival_sessions) then
    raise exception 'FAIL: foreign redemption link was stored: %', wrong;
  end if;

  bad_parts := public.open_boost_arrival_session(
    grill, item_id, version_id, null, null, arrival, first_expires,
    'key-bad', token_hash, 'threshold:4000', 1000, 'boost-5', 800, 1500, 1500, false, '["capped"]'::jsonb
  );
  if bad_parts ->> 'status' is distinct from 'invalid_quote'
     or exists (select 1 from public.boost_arrival_sessions) then
    raise exception 'FAIL: parts above the total were stored: %', bad_parts;
  end if;

  opened := public.open_boost_arrival_session(
    grill, item_id, version_id, null, 'boost-5', arrival, first_expires,
    'key-1', token_hash, 'threshold:8000', 2000, 'boost-5', 500, 2500, 8200, false,
    '["quoted","boost_applied"]'::jsonb
  );
  if opened ->> 'status' is distinct from 'created' then
    raise exception 'FAIL: open was %', opened;
  end if;
  opened_id := (opened ->> 'session_id')::uuid;

  again := public.open_boost_arrival_session(
    grill, item_id, version_id, null, 'boost-large', arrival, later_expires,
    'key-1', token_hash, 'threshold:4000', 1000, null, 0, 1000, 4000, false, '["quoted"]'::jsonb
  );
  if again ->> 'status' is distinct from 'existing'
     or (again ->> 'session_id')::uuid is distinct from opened_id then
    raise exception 'FAIL: retry did not return the same session: %', again;
  end if;
  select expires_at, arrival_at, locked_boost_id
    into stored_expires, stored_arrival, stored_lock
  from public.boost_arrival_sessions
  where id = opened_id;
  if stored_expires is distinct from first_expires
     or stored_arrival is distinct from arrival
     or stored_lock is distinct from 'boost-5'
     or (select count(*) from public.boost_arrival_sessions) <> 1
     or (select count(*) from public.boost_quotes) <> 1 then
    raise exception 'FAIL: retry moved expiry or opened another session';
  end if;

  second := public.open_boost_arrival_session(
    grill, item_id, version_id, null, 'boost-5', arrival, first_expires,
    'key-2', token_hash, 'threshold:8000', 2000, 'boost-5', 500, 2500, 8200, false, '["quoted"]'::jsonb
  );
  if second ->> 'status' is distinct from 'session_open'
     or (select count(*) from public.boost_arrival_sessions) <> 1 then
    raise exception 'FAIL: second open session was stored: %', second;
  end if;

  opened := public.open_boost_arrival_session(
    other, other_item, other_version, null, null, arrival, first_expires,
    'key-1', token_hash, 'threshold:4000', 1000, null, 0, 1000, 8200, false, '["quoted"]'::jsonb
  );
  if opened ->> 'status' is distinct from 'created' then
    raise exception 'FAIL: same key at another restaurant was refused: %', opened;
  end if;

  corrected := public.supersede_boost_arrival_quote(
    opened_id, grill, '2026-09-19 07:10:00+00', 2,
    'threshold:8000', 2000, 'boost-5', 500, 2500, 9000, false,
    '["quoted","boost_applied","boost_locked"]'::jsonb,
    later_expires
  );
  if corrected ->> 'status' is distinct from 'expiry_mismatch' then
    raise exception 'FAIL: a later expiry was accepted: %', corrected;
  end if;

  corrected := public.supersede_boost_arrival_quote(
    opened_id, grill, '2026-09-19 07:10:00+00', 2,
    'threshold:4000', 1000, 'boost-5', 500, 1500, 7999, false,
    '["quoted","boost_applied","boost_locked"]'::jsonb,
    first_expires
  );
  if corrected ->> 'status' is distinct from 'created' then
    raise exception 'FAIL: supersede was %', corrected;
  end if;
  select expires_at, arrival_at, locked_boost_id
    into stored_expires, stored_arrival, stored_lock
  from public.boost_arrival_sessions
  where id = opened_id;
  select count(*) into active_count
  from public.boost_quotes
  where session_id = opened_id and superseded_at is null;
  select count(*) into quote_count from public.boost_quotes where session_id = opened_id;
  if stored_expires is distinct from first_expires
     or stored_arrival is distinct from arrival
     or stored_lock is distinct from 'boost-5'
     or active_count <> 1
     or quote_count <> 2
     or (select quote_version from public.boost_quotes
         where session_id = opened_id and superseded_at is null) <> 2
     or (select superseded_at from public.boost_quotes
         where session_id = opened_id and quote_version = 1) is null
     or (select expires_at from public.boost_quotes
         where session_id = opened_id and quote_version = 2) is distinct from first_expires then
    raise exception 'FAIL: supersede moved the session or left two active quotes';
  end if;

  begin
    update public.boost_quotes
    set base_discount_cents = 0
    where session_id = opened_id and quote_version = 1;
    raise exception 'FAIL: quote money was rewritten';
  exception when check_violation then null; end;

  begin
    insert into public.boost_quotes (
      session_id, quote_version, offer_version_id,
      base_discount_cents, boost_discount_cents, total_discount_cents,
      eligible_subtotal_cents, below_minimum, reasons, expires_at
    ) values (
      opened_id, 3, version_id, 1000, 0, 1000, 8200, false, '["quoted"]'::jsonb, first_expires
    );
    raise exception 'FAIL: second active quote was inserted';
  exception when unique_violation then null; end;

  reset role;

  update public.boost_arrival_sessions set status = 'closed' where id = opened_id;
  set local role service_role;
  opened := public.open_boost_arrival_session(
    grill, item_id, version_id, null, null, arrival, first_expires,
    'key-3', token_hash, 'threshold:4000', 1000, null, 0, 1000, 8200, false, '["quoted"]'::jsonb
  );
  if opened ->> 'status' is distinct from 'created' then
    raise exception 'FAIL: a closed session still blocked a new key: %', opened;
  end if;
  select count(*) into open_count
  from public.boost_arrival_sessions
  where challenge_item_id = item_id and status = 'open';
  if open_count <> 1 then
    raise exception 'FAIL: open-session count is %', open_count;
  end if;

  reset role;
  begin
    insert into public.boost_arrival_sessions (
      restaurant_id, challenge_item_id, offer_version_id,
      arrival_at, expires_at, idempotency_key, created_by_token_hash
    ) values (
      other, item_id, other_version, arrival, first_expires, 'direct', token_hash
    );
    raise exception 'FAIL: direct cross-restaurant insert was accepted';
  exception when check_violation then null; end;
end $$;

rollback;
