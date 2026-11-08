-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E07-C2: one snapshot on a verified redemption, replay, quote uniqueness,
-- verified-only, math checks, sealed miss, and verify RPCs still leave
-- settlement columns null.
begin;
set local statement_timeout = '15s';

do $$
declare
  member uuid := 'e07c2000-0000-4000-8000-000000000001';
  grill uuid := 'e07c2000-0000-4000-8000-000000000011';
  version_id uuid := 'e07c2000-0000-4000-8000-000000000021';
  cycle_id uuid := 'e07c2000-0000-4000-8000-000000000031';
  item_id uuid := 'e07c2000-0000-4000-8000-000000000041';
  session_id uuid := 'e07c2000-0000-4000-8000-000000000051';
  closed_session_id uuid := 'e07c2000-0000-4000-8000-000000000052';
  active_quote uuid := 'e07c2000-0000-4000-8000-000000000061';
  unused_quote uuid := 'e07c2000-0000-4000-8000-000000000063';
  missing_quote uuid := 'e07c2000-0000-4000-8000-000000000062';
  consume_id uuid := 'e07c2000-0000-4000-8000-000000000071';
  other_id uuid := 'e07c2000-0000-4000-8000-000000000072';
  sealed_id uuid := 'e07c2000-0000-4000-8000-000000000073';
  miss_id uuid := 'e07c2000-0000-4000-8000-000000000074';
  bad_id uuid := 'e07c2000-0000-4000-8000-000000000075';
  issued_id uuid := 'e07c2000-0000-4000-8000-000000000076';
  null_time_id uuid := 'e07c2000-0000-4000-8000-000000000077';
  verify_id uuid := 'e07c2000-0000-4000-8000-000000000078';
  settle_id uuid := 'e07c2000-0000-4000-8000-000000000079';
  missing_id uuid := 'e07c2000-0000-4000-8000-00000000007a';
  fn text := 'public.record_boost_settlement(uuid, text, timestamptz, uuid, integer, integer, integer, integer, integer, boolean, text, text, text, timestamptz, integer, integer)';
  token_hash text := repeat('ab', 32);
  arrival timestamptz := '2026-11-08 18:00:00+00';
  quote_expires timestamptz := '2026-11-08 22:00:00+00';
  settled timestamptz := '2026-11-08 18:05:00+00';
  later timestamptz := '2026-11-09 18:05:00+00';
  created jsonb;
  replay jsonb;
  conflict jsonb;
  sealed jsonb;
  miss jsonb;
  miss_replay jsonb;
  refused jsonb;
  claimed integer;
  kind text;
  stored_settled timestamptz;
  stored_total integer;
  stored_locked text;
  stored_quote uuid;
  stored_base integer;
  stored_boost integer;
  stored_eligible integer;
  stored_below boolean;
  stored_tier text;
  stored_boost_id text;
  stored_version integer;
  stored_quote_expires timestamptz;
  sealed_discount integer;
  sealed_min integer;
  policy_count integer;
begin
  if has_function_privilege('anon', fn, 'EXECUTE')
     or has_function_privilege('authenticated', fn, 'EXECUTE')
     or not has_function_privilege('service_role', fn, 'EXECUTE') then
    raise exception 'FAIL: settlement grants';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('verify_redemption', 'verify_redemption_and_settle')
      and position('settlement_kind' in p.prosrc) > 0
  ) then
    raise exception 'FAIL: verify RPC mentions settlement_kind';
  end if;

  select count(*) into policy_count
  from pg_policies
  where schemaname = 'public' and tablename = 'redemptions';
  if policy_count <> 1 then
    raise exception 'FAIL: redemptions policies changed (%)', policy_count;
  end if;

  if not has_table_privilege('authenticated', 'public.redemptions', 'SELECT') then
    raise exception 'FAIL: redemption select grant changed';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'redemptions_quote_id_consumed_key'
      and indexdef ilike '%unique%'
      and indexdef ilike '%quote_id is not null%'
  ) then
    raise exception 'FAIL: quote consumption index';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'redemptions'
      and column_name in (
        'settlement_kind', 'settled_at', 'quote_id', 'quote_version',
        'base_discount_cents', 'boost_discount_cents', 'total_discount_cents',
        'eligible_subtotal_cents', 'below_minimum', 'tier_id', 'boost_id',
        'locked_boost_id', 'quote_expires_at',
        'sealed_discount_amount_cents', 'sealed_min_spend_cents'
      )
      and is_nullable = 'NO'
  ) then
    raise exception 'FAIL: settlement columns must stay nullable';
  end if;

  insert into auth.users (id) values (member);
  insert into public.user_profiles (id, is_admin) values (member, false);
  insert into public.restaurants (id, name, status) values (grill, 'E07 C2 Grill', 'active');
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
    item_id, cycle_id, grill, 1, 'assigned', version_id, '2026-12-01 00:00:00+00'
  );
  insert into public.boost_arrival_sessions (
    id, restaurant_id, challenge_item_id, offer_version_id,
    locked_boost_id, arrival_at, expires_at, idempotency_key, created_by_token_hash
  ) values (
    session_id, grill, item_id, version_id,
    'boost-5', arrival, quote_expires, 'c2-key', token_hash
  );
  insert into public.boost_quotes (
    id, session_id, quote_version, offer_version_id, tier_id,
    base_discount_cents, boost_id, boost_discount_cents, total_discount_cents,
    eligible_subtotal_cents, below_minimum, reasons, expires_at
  ) values (
    active_quote, session_id, 2, version_id, 'threshold:8000',
    2000, 'boost-5', 500, 2500,
    8200, false, '["boost_applied"]'::jsonb, quote_expires
  );
  insert into public.boost_arrival_sessions (
    id, restaurant_id, challenge_item_id, offer_version_id,
    locked_boost_id, arrival_at, expires_at, idempotency_key, created_by_token_hash, status
  ) values (
    closed_session_id, grill, item_id, version_id,
    null, arrival, quote_expires, 'c2-key-closed', token_hash, 'closed'
  );
  insert into public.boost_quotes (
    id, session_id, quote_version, offer_version_id, tier_id,
    base_discount_cents, boost_id, boost_discount_cents, total_discount_cents,
    eligible_subtotal_cents, below_minimum, reasons, expires_at
  ) values (
    unused_quote, closed_session_id, 1, version_id, 'threshold:4000',
    1000, null, 0, 1000,
    4000, false, '["quoted"]'::jsonb, quote_expires
  );

  insert into public.redemptions (
    id, user_id, restaurant_id, token_hash, status, verified_at, expires_at
  ) values
    (consume_id, member, grill, repeat('c1', 32), 'verified', settled, now() + interval '35 days'),
    (other_id, member, grill, repeat('c2', 32), 'verified', settled, now() + interval '35 days'),
    (sealed_id, member, grill, repeat('c3', 32), 'verified', settled, now() + interval '35 days'),
    (miss_id, member, grill, repeat('c4', 32), 'verified', settled, now() + interval '35 days'),
    (bad_id, member, grill, repeat('c5', 32), 'verified', settled, now() + interval '35 days'),
    (issued_id, member, grill, repeat('c6', 32), 'issued', null, now() + interval '35 days'),
    (null_time_id, member, grill, repeat('c7', 32), 'verified', null, now() + interval '35 days'),
    (verify_id, member, grill, repeat('c8', 32), 'issued', null, now() + interval '35 days'),
    (settle_id, member, grill, repeat('c9', 32), 'issued', null, now() + interval '35 days');

  set local role service_role;

  created := public.record_boost_settlement(
    consume_id, 'consume_quote', settled, active_quote, 2,
    2000, 500, 2500, 8200, false,
    'threshold:8000', 'boost-5', 'boost-5', quote_expires,
    null, null
  );
  if created ->> 'status' is distinct from 'created' then
    raise exception 'FAIL: consume create was %', created;
  end if;
  if created #>> '{snapshot,settlement_kind}' is distinct from 'consume_quote'
     or (created #>> '{snapshot,quote_id}')::uuid is distinct from active_quote
     or (created #>> '{snapshot,quote_version}')::integer is distinct from 2
     or (created #>> '{snapshot,base_discount_cents}')::integer is distinct from 2000
     or (created #>> '{snapshot,boost_discount_cents}')::integer is distinct from 500
     or (created #>> '{snapshot,total_discount_cents}')::integer is distinct from 2500
     or (created #>> '{snapshot,eligible_subtotal_cents}')::integer is distinct from 8200
     or (created #>> '{snapshot,below_minimum}')::boolean is distinct from false
     or created #>> '{snapshot,tier_id}' is distinct from 'threshold:8000'
     or created #>> '{snapshot,boost_id}' is distinct from 'boost-5'
     or created #>> '{snapshot,locked_boost_id}' is distinct from 'boost-5'
     or (created #>> '{snapshot,sealed_discount_amount_cents}') is not null
     or (created #>> '{snapshot,sealed_min_spend_cents}') is not null then
    raise exception 'FAIL: consume snapshot was %', created;
  end if;

  replay := public.record_boost_settlement(
    consume_id, 'use_sealed_base', later, null, null,
    null, null, null, null, null,
    null, null, null, null,
    1000, 4000
  );
  if replay ->> 'status' is distinct from 'already_settled'
     or replay #>> '{snapshot,settlement_kind}' is distinct from 'consume_quote'
     or replay #>> '{snapshot,locked_boost_id}' is distinct from 'boost-5'
     or (replay #>> '{snapshot,total_discount_cents}')::integer is distinct from 2500 then
    raise exception 'FAIL: replay overwrote the snapshot %', replay;
  end if;

  select
    r.settlement_kind, r.settled_at, r.quote_id, r.quote_version,
    r.base_discount_cents, r.boost_discount_cents, r.total_discount_cents,
    r.eligible_subtotal_cents, r.below_minimum, r.tier_id, r.boost_id, r.locked_boost_id,
    r.quote_expires_at, r.sealed_discount_amount_cents, r.sealed_min_spend_cents
  into
    kind, stored_settled, stored_quote, stored_version,
    stored_base, stored_boost, stored_total,
    stored_eligible, stored_below, stored_tier, stored_boost_id, stored_locked,
    stored_quote_expires, sealed_discount, sealed_min
  from public.redemptions r
  where r.id = consume_id;
  if kind is distinct from 'consume_quote'
     or stored_settled is distinct from settled
     or stored_quote is distinct from active_quote
     or stored_version is distinct from 2
     or stored_base is distinct from 2000
     or stored_boost is distinct from 500
     or stored_total is distinct from 2500
     or stored_eligible is distinct from 8200
     or stored_below is distinct from false
     or stored_tier is distinct from 'threshold:8000'
     or stored_boost_id is distinct from 'boost-5'
     or stored_locked is distinct from 'boost-5'
     or stored_quote_expires is distinct from quote_expires
     or sealed_discount is not null
     or sealed_min is not null then
    raise exception 'FAIL: stored consume row changed on replay';
  end if;

  conflict := public.record_boost_settlement(
    other_id, 'consume_quote', settled, active_quote, 2,
    2000, 500, 2500, 8200, false,
    'threshold:8000', 'boost-5', 'boost-5', quote_expires,
    null, null
  );
  if conflict ->> 'status' is distinct from 'quote_already_consumed' then
    raise exception 'FAIL: reused quote was %', conflict;
  end if;
  if (select settlement_kind from public.redemptions where id = other_id) is not null then
    raise exception 'FAIL: second redemption was settled';
  end if;

  sealed := public.record_boost_settlement(
    sealed_id, 'use_sealed_base', settled, null, null,
    null, null, null, null, null,
    null, null, null, null,
    1000, 4000
  );
  if sealed ->> 'status' is distinct from 'created'
     or sealed #>> '{snapshot,settlement_kind}' is distinct from 'use_sealed_base'
     or (sealed #>> '{snapshot,sealed_discount_amount_cents}')::integer is distinct from 1000
     or (sealed #>> '{snapshot,sealed_min_spend_cents}')::integer is distinct from 4000
     or sealed #>> '{snapshot,quote_id}' is not null
     or sealed #>> '{snapshot,locked_boost_id}' is not null
     or sealed #>> '{snapshot,total_discount_cents}' is not null then
    raise exception 'FAIL: sealed snapshot was %', sealed;
  end if;

  miss := public.record_boost_settlement(
    miss_id, 'use_sealed_base', settled, null, null,
    null, null, null, null, null,
    null, null, null, null,
    null, null
  );
  if miss ->> 'status' is distinct from 'created'
     or miss #>> '{snapshot,settlement_kind}' is distinct from 'use_sealed_base'
     or miss #>> '{snapshot,sealed_discount_amount_cents}' is not null
     or miss #>> '{snapshot,sealed_min_spend_cents}' is not null
     or miss #>> '{snapshot,quote_id}' is not null then
    raise exception 'FAIL: sealed miss was %', miss;
  end if;
  miss_replay := public.record_boost_settlement(
    miss_id, 'consume_quote', later, active_quote, 2,
    2000, 500, 2500, 8200, false,
    'threshold:8000', 'boost-5', 'boost-5', quote_expires,
    null, null
  );
  if miss_replay ->> 'status' is distinct from 'already_settled'
     or miss_replay #>> '{snapshot,settlement_kind}' is distinct from 'use_sealed_base'
     or miss_replay #>> '{snapshot,sealed_discount_amount_cents}' is not null then
    raise exception 'FAIL: sealed miss was overwritten %', miss_replay;
  end if;

  refused := public.record_boost_settlement(
    bad_id, 'consume_quote', settled, active_quote, 2,
    2000, 500, 3000, 8200, false,
    'threshold:8000', 'boost-5', 'boost-5', quote_expires,
    null, null
  );
  if refused ->> 'status' is distinct from 'invalid_snapshot' then
    raise exception 'FAIL: bad sum was %', refused;
  end if;
  refused := public.record_boost_settlement(
    bad_id, 'consume_quote', settled, active_quote, 2,
    2000, 500, 2500, 2000, false,
    null, null, null, quote_expires,
    null, null
  );
  if refused ->> 'status' is distinct from 'invalid_snapshot' then
    raise exception 'FAIL: total over eligible was %', refused;
  end if;
  refused := public.record_boost_settlement(
    bad_id, 'consume_quote', settled, active_quote, 0,
    0, 0, 0, 0, true,
    null, null, null, quote_expires,
    null, null
  );
  if refused ->> 'status' is distinct from 'invalid_snapshot' then
    raise exception 'FAIL: quote version 0 was %', refused;
  end if;
  refused := public.record_boost_settlement(
    bad_id, 'consume_quote', settled, missing_quote, 1,
    0, 0, 0, 0, true,
    null, null, null, quote_expires,
    null, null
  );
  if refused ->> 'status' is distinct from 'invalid_snapshot' then
    raise exception 'FAIL: missing quote was %', refused;
  end if;
  refused := public.record_boost_settlement(
    bad_id, 'use_sealed_base', settled, active_quote, null,
    null, null, null, null, null,
    null, null, null, null,
    null, null
  );
  if refused ->> 'status' is distinct from 'invalid_snapshot' then
    raise exception 'FAIL: sealed row with a quote was %', refused;
  end if;
  refused := public.record_boost_settlement(
    bad_id, 'use_sealed_base', settled, null, null,
    null, null, null, null, null,
    null, null, null, null,
    1000, null
  );
  if refused ->> 'status' is distinct from 'invalid_snapshot' then
    raise exception 'FAIL: half sealed snapshot was %', refused;
  end if;
  refused := public.record_boost_settlement(
    bad_id, 'consume_quote', settled, active_quote, 1,
    100, 0, 100, 100, false,
    null, null, null, quote_expires,
    1000, 4000
  );
  if refused ->> 'status' is distinct from 'invalid_snapshot' then
    raise exception 'FAIL: consume with sealed cents was %', refused;
  end if;
  if (select settlement_kind from public.redemptions where id = bad_id) is not null then
    raise exception 'FAIL: invalid snapshot wrote a row';
  end if;

  refused := public.record_boost_settlement(
    issued_id, 'use_sealed_base', settled, null, null,
    null, null, null, null, null,
    null, null, null, null,
    1000, 4000
  );
  if refused ->> 'status' is distinct from 'not_verified' then
    raise exception 'FAIL: issued redemption was %', refused;
  end if;
  refused := public.record_boost_settlement(
    null_time_id, 'use_sealed_base', settled, null, null,
    null, null, null, null, null,
    null, null, null, null,
    null, null
  );
  if refused ->> 'status' is distinct from 'not_verified' then
    raise exception 'FAIL: missing verified_at was %', refused;
  end if;
  if exists (
    select 1 from public.redemptions
    where id in (issued_id, null_time_id)
      and settlement_kind is not null
  ) then
    raise exception 'FAIL: unverified redemption was settled';
  end if;

  refused := public.record_boost_settlement(
    missing_id, 'use_sealed_base', settled, null, null,
    null, null, null, null, null,
    null, null, null, null,
    null, null
  );
  if refused ->> 'status' is distinct from 'not_found' then
    raise exception 'FAIL: missing redemption was %', refused;
  end if;

  reset role;

  begin
    update public.redemptions
    set settlement_kind = 'consume_quote',
        settled_at = settled,
        quote_id = unused_quote,
        quote_version = 2,
        base_discount_cents = 2000,
        boost_discount_cents = 500,
        total_discount_cents = 3000,
        eligible_subtotal_cents = 8200,
        below_minimum = false,
        quote_expires_at = quote_expires
    where id = bad_id;
    raise exception 'FAIL: check allowed a bad sum';
  exception when check_violation then null;
  end;

  begin
    update public.redemptions
    set settlement_kind = 'use_sealed_base',
        settled_at = settled,
        sealed_discount_amount_cents = 1000
    where id = bad_id;
    raise exception 'FAIL: check allowed one sealed cent';
  exception when check_violation then null;
  end;

  begin
    update public.redemptions
    set settled_at = settled
    where id = bad_id;
    raise exception 'FAIL: check allowed settled_at without kind';
  exception when check_violation then null;
  end;

  select count(*) into claimed
  from public.verify_redemption(repeat('c8', 32), grill);
  if claimed <> 1 then
    raise exception 'FAIL: verify_redemption did not claim the issued row';
  end if;
  select settlement_kind, status into kind, stored_locked
  from public.redemptions
  where id = verify_id;
  if kind is not null or stored_locked is distinct from 'verified' then
    raise exception 'FAIL: verify_redemption wrote a settlement';
  end if;
  if exists (
    select 1 from public.redemptions
    where id = verify_id
      and (
        settled_at is not null
        or quote_id is not null
        or quote_version is not null
        or base_discount_cents is not null
        or boost_discount_cents is not null
        or total_discount_cents is not null
        or eligible_subtotal_cents is not null
        or below_minimum is not null
        or tier_id is not null
        or boost_id is not null
        or locked_boost_id is not null
        or quote_expires_at is not null
        or sealed_discount_amount_cents is not null
        or sealed_min_spend_cents is not null
      )
  ) then
    raise exception 'FAIL: verify_redemption filled a settlement column';
  end if;

  select count(*) into claimed
  from public.verify_redemption_and_settle(repeat('c9', 32), grill);
  if claimed <> 1 then
    raise exception 'FAIL: verify_redemption_and_settle did not claim the issued row';
  end if;
  if exists (
    select 1 from public.redemptions
    where id = settle_id
      and (
        status is distinct from 'verified'
        or verified_at is null
        or settlement_kind is not null
        or settled_at is not null
        or quote_id is not null
        or sealed_discount_amount_cents is not null
        or sealed_min_spend_cents is not null
      )
  ) then
    raise exception 'FAIL: verify_redemption_and_settle wrote a settlement';
  end if;

  set local role anon;
  begin
    perform public.record_boost_settlement(
      consume_id, 'use_sealed_base', settled, null, null,
      null, null, null, null, null,
      null, null, null, null,
      null, null
    );
    raise exception 'FAIL: anon executed record_boost_settlement';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

rollback;
