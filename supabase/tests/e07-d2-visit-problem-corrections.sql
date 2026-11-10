-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E07-D2: category gating, one savings fix, one make-up opportunity,
-- idempotent repeats, no fix after resolved, non-admin refusal,
-- a redemption that is not the case's visit,
-- and the original visit, settlement, quote, and capacity stay put.
begin;
set local statement_timeout = '15s';

do $$
declare
  member uuid := 'e07d2000-0000-4000-8000-000000000001';
  stranger uuid := 'e07d2000-0000-4000-8000-000000000002';
  admin_id uuid := 'e07d2000-0000-4000-8000-000000000003';
  partner_id uuid := 'e07d2000-0000-4000-8000-000000000004';
  grill uuid := 'e07d2000-0000-4000-8000-000000000011';
  grill_b uuid := 'e07d2000-0000-4000-8000-000000000012';
  grill_c uuid := 'e07d2000-0000-4000-8000-000000000013';
  grill_d uuid := 'e07d2000-0000-4000-8000-000000000014';
  grill_e uuid := 'e07d2000-0000-4000-8000-000000000015';
  grill_f uuid := 'e07d2000-0000-4000-8000-000000000016';
  version_id uuid := 'e07d2000-0000-4000-8000-000000000021';
  cycle_nov uuid := 'e07d2000-0000-4000-8000-000000000031';
  cycle_oct uuid := 'e07d2000-0000-4000-8000-000000000032';
  cycle_sep uuid := 'e07d2000-0000-4000-8000-000000000033';
  item_discount uuid := 'e07d2000-0000-4000-8000-000000000041';
  item_refused uuid := 'e07d2000-0000-4000-8000-000000000042';
  item_checkin uuid := 'e07d2000-0000-4000-8000-000000000043';
  item_other uuid := 'e07d2000-0000-4000-8000-000000000044';
  item_resolved uuid := 'e07d2000-0000-4000-8000-000000000045';
  item_issued uuid := 'e07d2000-0000-4000-8000-000000000046';
  session_id uuid := 'e07d2000-0000-4000-8000-000000000051';
  active_quote uuid := 'e07d2000-0000-4000-8000-000000000061';
  redemption_discount uuid := 'e07d2000-0000-4000-8000-000000000071';
  redemption_other uuid := 'e07d2000-0000-4000-8000-000000000072';
  redemption_issued uuid := 'e07d2000-0000-4000-8000-000000000073';
  case_discount uuid := 'e07d2000-0000-4000-8000-000000000081';
  case_refused uuid := 'e07d2000-0000-4000-8000-000000000082';
  case_checkin uuid := 'e07d2000-0000-4000-8000-000000000083';
  case_other uuid := 'e07d2000-0000-4000-8000-000000000084';
  case_resolved uuid := 'e07d2000-0000-4000-8000-000000000085';
  case_issued uuid := 'e07d2000-0000-4000-8000-000000000086';
  savings_fn text := 'public.correct_visit_problem_savings(uuid, uuid, integer, text)';
  restore_fn text := 'public.restore_visit_problem_opportunity(uuid, uuid, text)';
  savings_src text;
  restore_src text;
  quote_expires timestamptz := '2026-11-08 22:00:00+00';
  settled timestamptz := '2026-11-08 18:05:00+00';
  visit_verified timestamptz := '2026-11-08 18:10:00+00';
  result jsonb;
  reviewed jsonb;
  item_status text;
  redemption_status text;
  stored_verified timestamptz;
  stored_kind text;
  stored_total integer;
  stored_sealed integer;
  stored_quote uuid;
  stored_quote_expires timestamptz;
  quote_row_expires timestamptz;
  quote_total integer;
  sessions_before integer;
  quotes_before integer;
  capacity_before integer;
  credits_before integer;
  badges_before integer;
  redemptions_before integer;
  sessions_after integer;
  quotes_after integer;
  capacity_after integer;
  credits_after integer;
  badges_after integer;
  redemptions_after integer;
  savings_count integer;
  opportunity_count integer;
  savings_audits integer;
  restore_audits integer;
  refused_spot uuid;
  checkin_spot uuid;
  makeup_item uuid;
  checkin_item uuid;
  issued record;
  code_expires timestamptz;
  visit_deadline timestamptz;
  makeup_audits integer;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.visit_problem_savings_adjustments'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.visit_problem_opportunities'::regclass) then
    raise exception 'FAIL: correction RLS disabled';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('visit_problem_savings_adjustments', 'visit_problem_opportunities')
  ) then
    raise exception 'FAIL: correction policy exists';
  end if;

  if has_table_privilege('anon', 'public.visit_problem_savings_adjustments', 'SELECT')
     or has_table_privilege('authenticated', 'public.visit_problem_savings_adjustments', 'SELECT')
     or has_table_privilege('service_role', 'public.visit_problem_savings_adjustments', 'INSERT')
     or has_table_privilege('service_role', 'public.visit_problem_savings_adjustments', 'UPDATE')
     or has_table_privilege('service_role', 'public.visit_problem_savings_adjustments', 'DELETE')
     or not has_table_privilege('service_role', 'public.visit_problem_savings_adjustments', 'SELECT')
     or has_table_privilege('anon', 'public.visit_problem_opportunities', 'SELECT')
     or has_table_privilege('authenticated', 'public.visit_problem_opportunities', 'SELECT')
     or has_table_privilege('service_role', 'public.visit_problem_opportunities', 'INSERT')
     or has_table_privilege('service_role', 'public.visit_problem_opportunities', 'UPDATE')
     or has_table_privilege('service_role', 'public.visit_problem_opportunities', 'DELETE')
     or not has_table_privilege('service_role', 'public.visit_problem_opportunities', 'SELECT')
     or has_function_privilege('anon', savings_fn, 'EXECUTE')
     or has_function_privilege('authenticated', savings_fn, 'EXECUTE')
     or not has_function_privilege('service_role', savings_fn, 'EXECUTE')
     or has_function_privilege('anon', restore_fn, 'EXECUTE')
     or has_function_privilege('authenticated', restore_fn, 'EXECUTE')
     or not has_function_privilege('service_role', restore_fn, 'EXECUTE')
     or has_function_privilege('service_role', 'public.visit_problem_savings_adjustments_guard()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.visit_problem_opportunities_guard()', 'EXECUTE') then
    raise exception 'FAIL: correction grants';
  end if;

  select p.prosrc into savings_src
  from pg_proc p
  where p.oid = savings_fn::regprocedure;
  select p.prosrc into restore_src
  from pg_proc p
  where p.oid = restore_fn::regprocedure;
  if position('visit_problem.correct_savings' in savings_src) = 0
     or position('visit_problem.restore_opportunity' in restore_src) = 0
     or position('for update' in lower(savings_src)) = 0
     or position('for update' in lower(restore_src)) = 0
     or position('update public.redemptions' in lower(savings_src)) > 0
     or position('update public.redemptions' in lower(restore_src)) > 0
     or position('update public.boost_quotes' in lower(savings_src)) > 0
     or position('update public.challenge_items' in lower(savings_src || restore_src)) > 0
     or position('update public.capacity_reservations' in lower(savings_src || restore_src)) > 0
     or position('insert into public.boost_arrival_sessions' in lower(savings_src || restore_src)) > 0
     or position('insert into public.boost_quotes' in lower(savings_src || restore_src)) > 0
     or position('insert into public.entitlement_credits' in lower(savings_src || restore_src)) > 0
     or position('insert into public.user_badges' in lower(savings_src || restore_src)) > 0
     or (select p.prosecdef from pg_proc p where p.oid = savings_fn::regprocedure) is not true
     or (select p.prosecdef from pg_proc p where p.oid = restore_fn::regprocedure) is not true then
    raise exception 'FAIL: correction function shape';
  end if;

  insert into auth.users (id) values (member), (stranger), (admin_id), (partner_id);
  insert into public.user_profiles (id, subscription_status, is_admin, role) values
    (member, 'active', false, 'subscriber'),
    (stranger, 'active', false, 'subscriber'),
    (admin_id, 'active', true, 'admin'),
    (partner_id, 'active', false, 'partner');
  insert into public.restaurants (id, name, status) values
    (grill, 'E07 D2 Grill', 'active'),
    (grill_b, 'E07 D2 Refused', 'active'),
    (grill_c, 'E07 D2 Check-in', 'active'),
    (grill_d, 'E07 D2 Other', 'active'),
    (grill_e, 'E07 D2 Resolved', 'active'),
    (grill_f, 'E07 D2 Issued', 'active');
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
    (cycle_nov, member, '2026-11-01', 'active'),
    (cycle_oct, member, '2026-10-01', 'active'),
    (cycle_sep, member, '2026-09-01', 'active');
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status, offer_version_id
  ) values
    (item_discount, cycle_nov, grill, 1, 'redeemed', version_id),
    (item_refused, cycle_nov, grill_b, 2, 'redeemed', null),
    (item_checkin, cycle_oct, grill_c, 1, 'assigned', null),
    (item_other, cycle_oct, grill_d, 2, 'redeemed', null),
    (item_resolved, cycle_sep, grill_e, 1, 'assigned', null),
    (item_issued, cycle_sep, grill_f, 2, 'assigned', null);
  insert into public.boost_arrival_sessions (
    id, restaurant_id, challenge_item_id, offer_version_id,
    locked_boost_id, arrival_at, expires_at, idempotency_key, created_by_token_hash
  ) values (
    session_id, grill, item_discount, version_id,
    'boost-5', '2026-11-08 18:00:00+00', quote_expires, 'e07d2-key', repeat('ab', 32)
  );
  insert into public.boost_quotes (
    id, session_id, quote_version, offer_version_id, tier_id,
    base_discount_cents, boost_id, boost_discount_cents, total_discount_cents,
    eligible_subtotal_cents, below_minimum, reasons, expires_at
  ) values (
    active_quote, session_id, 1, version_id, 'threshold:8000',
    2000, 'boost-5', 500, 2500,
    8200, false, '["boost_applied"]'::jsonb, quote_expires
  );
  insert into public.redemptions (
    id, user_id, restaurant_id, challenge_item_id, token_hash, status, verified_at, expires_at
  ) values
    (redemption_discount, member, grill, item_discount, 'e07d2-discount', 'verified', visit_verified, now() + interval '35 days'),
    (redemption_other, member, grill_d, item_other, 'e07d2-other', 'verified', visit_verified, now() + interval '35 days'),
    (redemption_issued, member, grill_f, item_issued, 'e07d2-issued', 'issued', null, now() + interval '35 days');

  result := public.record_boost_settlement(
    redemption_discount, 'consume_quote', settled, active_quote, 1,
    2000, 500, 2500, 8200, false,
    'threshold:8000', 'boost-5', 'boost-5', quote_expires,
    null, null
  );
  if result ->> 'status' is distinct from 'created' then
    raise exception 'FAIL: discount settlement was %', result;
  end if;
  result := public.record_boost_settlement(
    redemption_other, 'use_sealed_base', settled, null, null,
    null, null, null, null, null,
    null, null, null, null,
    1500, 4000
  );
  if result ->> 'status' is distinct from 'created' then
    raise exception 'FAIL: sealed settlement was %', result;
  end if;

  insert into public.visit_problem_cases (
    id, user_id, challenge_item_id, redemption_id, category, explanation
  ) values
    (case_discount, member, item_discount, redemption_discount, 'wrong_discount', 'The discount was short.'),
    (case_refused, member, item_refused, null, 'offer_refused', 'The restaurant refused the offer.'),
    (case_checkin, member, item_checkin, null, 'check_in_code', 'The code would not scan.'),
    (case_other, member, item_other, redemption_other, 'other', 'Something else went wrong.'),
    (case_resolved, member, item_resolved, null, 'other', 'Please close this one.'),
    (case_issued, member, item_issued, redemption_issued, 'wrong_discount', 'The code was only issued.');

  select count(*) into sessions_before from public.boost_arrival_sessions;
  select count(*) into quotes_before from public.boost_quotes;
  select count(*) into capacity_before from public.capacity_reservations;
  select count(*) into credits_before from public.entitlement_credits;
  select count(*) into badges_before from public.user_badges;
  select count(*) into redemptions_before from public.redemptions;
  select status, verified_at, settlement_kind, total_discount_cents, quote_id, quote_expires_at
    into redemption_status, stored_verified, stored_kind, stored_total, stored_quote, stored_quote_expires
  from public.redemptions where id = redemption_discount;
  select expires_at, total_discount_cents
    into quote_row_expires, quote_total
  from public.boost_quotes where id = active_quote;
  select status into item_status from public.challenge_items where id = item_discount;

  begin
    insert into public.visit_problem_savings_adjustments (
      case_id, user_id, redemption_id, quote_id, settlement_kind, original_cents,
      corrected_cents, actor_user_id, reason
    ) values (
      case_discount, stranger, redemption_discount, active_quote, 'consume_quote', 2500,
      3200, admin_id, 'Wrong member.'
    );
    raise exception 'FAIL: mismatched savings insert';
  exception
    when check_violation then
      null;
  end;

  set local role service_role;

  begin
    insert into public.visit_problem_savings_adjustments (
      case_id, user_id, redemption_id, corrected_cents, actor_user_id, reason
    ) values (
      case_discount, member, redemption_discount, 3200, admin_id, 'Direct insert.'
    );
    raise exception 'FAIL: service role inserted a savings row';
  exception
    when insufficient_privilege then
      null;
  end;

  result := public.correct_visit_problem_savings(case_discount, partner_id, 3200, 'Partner tried.');
  if result ->> 'error' is distinct from 'not_admin' then
    raise exception 'FAIL: partner savings was %', result;
  end if;
  result := public.restore_visit_problem_opportunity(case_refused, stranger, 'Member tried.');
  if result ->> 'error' is distinct from 'not_admin' then
    raise exception 'FAIL: subscriber restore was %', result;
  end if;

  result := public.restore_visit_problem_opportunity(case_discount, admin_id, 'Wrong category.');
  if result ->> 'error' is distinct from 'not_allowed' then
    raise exception 'FAIL: discount restore was %', result;
  end if;
  result := public.correct_visit_problem_savings(case_refused, admin_id, 1000, 'Wrong category.');
  if result ->> 'error' is distinct from 'not_allowed' then
    raise exception 'FAIL: refused savings was %', result;
  end if;
  result := public.correct_visit_problem_savings(case_checkin, admin_id, 1000, 'Wrong category.');
  if result ->> 'error' is distinct from 'not_allowed' then
    raise exception 'FAIL: check-in savings was %', result;
  end if;
  result := public.correct_visit_problem_savings(case_issued, admin_id, 1000, 'Not verified yet.');
  if result ->> 'error' is distinct from 'not_verified' then
    raise exception 'FAIL: issued savings was %', result;
  end if;
  if (select count(*) from public.visit_problem_savings_adjustments) <> 0
     or (select count(*) from public.visit_problem_opportunities) <> 0 then
    raise exception 'FAIL: a refused fix wrote a row';
  end if;

  reviewed := public.review_visit_problem_case(
    case_resolved, admin_id, 'resolved', 'We closed this without a fix.', 'No correction.'
  );
  if reviewed ->> 'ok' is distinct from 'true'
     or (select count(*) from public.visit_problem_savings_adjustments) <> 0
     or (select count(*) from public.visit_problem_opportunities) <> 0 then
    raise exception 'FAIL: resolving granted a correction %', reviewed;
  end if;
  result := public.correct_visit_problem_savings(case_resolved, admin_id, 500, 'Too late.');
  if result ->> 'error' is distinct from 'terminal' then
    raise exception 'FAIL: resolved savings was %', result;
  end if;
  result := public.restore_visit_problem_opportunity(case_resolved, admin_id, 'Too late.');
  if result ->> 'error' is distinct from 'terminal' then
    raise exception 'FAIL: resolved restore was %', result;
  end if;

  result := public.correct_visit_problem_savings(case_discount, admin_id, 3200, 'Use the quoted total.');
  if result ->> 'ok' is distinct from 'true'
     or result ->> 'already_applied' is distinct from 'false'
     or (result ->> 'corrected_cents')::integer is distinct from 3200
     or (result ->> 'redemption_id')::uuid is distinct from redemption_discount
     or result ? 'reason' then
    raise exception 'FAIL: discount savings was %', result;
  end if;
  result := public.correct_visit_problem_savings(case_discount, admin_id, 3200, 'Same cents, new reason.');
  if result ->> 'ok' is distinct from 'true'
     or result ->> 'already_applied' is distinct from 'true'
     or (select count(*) from public.visit_problem_savings_adjustments where case_id = case_discount) <> 1
     or (select count(*) from public.admin_audit_log where action = 'visit_problem.correct_savings' and target_id = case_discount::text) <> 1
     or (select reason from public.visit_problem_savings_adjustments where case_id = case_discount) is distinct from 'Use the quoted total.' then
    raise exception 'FAIL: discount replay was %', result;
  end if;
  result := public.correct_visit_problem_savings(case_discount, admin_id, 100, 'Different amount.');
  if result ->> 'error' is distinct from 'already_applied'
     or (select corrected_cents from public.visit_problem_savings_adjustments where case_id = case_discount) is distinct from 3200
     or (select count(*) from public.admin_audit_log where action = 'visit_problem.correct_savings' and target_id = case_discount::text) <> 1 then
    raise exception 'FAIL: discount rewrite was %', result;
  end if;

  result := public.restore_visit_problem_opportunity(case_refused, admin_id, 'Grant one make-up visit.');
  if result ->> 'ok' is distinct from 'true'
     or result ->> 'already_applied' is distinct from 'false'
     or result ? 'reason' then
    raise exception 'FAIL: refused restore was %', result;
  end if;
  result := public.restore_visit_problem_opportunity(case_refused, admin_id, 'Grant it again.');
  if result ->> 'ok' is distinct from 'true'
     or result ->> 'already_applied' is distinct from 'true'
     or (select count(*) from public.visit_problem_opportunities where case_id = case_refused) <> 1
     or (select count(*) from public.admin_audit_log where action = 'visit_problem.restore_opportunity' and target_id = case_refused::text) <> 1 then
    raise exception 'FAIL: refused replay was %', result;
  end if;

  result := public.restore_visit_problem_opportunity(case_checkin, admin_id, 'Code trouble make-up.');
  if result ->> 'ok' is distinct from 'true' then
    raise exception 'FAIL: check-in restore was %', result;
  end if;

  result := public.correct_visit_problem_savings(case_other, admin_id, 0, 'No savings were due.');
  if result ->> 'ok' is distinct from 'true'
     or (result ->> 'corrected_cents')::integer is distinct from 0 then
    raise exception 'FAIL: other savings was %', result;
  end if;
  result := public.restore_visit_problem_opportunity(case_other, admin_id, 'And one make-up visit.');
  if result ->> 'ok' is distinct from 'true' then
    raise exception 'FAIL: other restore was %', result;
  end if;
  if (select status from public.visit_problem_cases where id = case_other) is distinct from 'submitted'
     or (select status from public.visit_problem_cases where id = case_discount) is distinct from 'submitted' then
    raise exception 'FAIL: a fix changed the case status';
  end if;

  select id into refused_spot
  from public.visit_problem_opportunities
  where case_id = case_refused;
  select id into checkin_spot
  from public.visit_problem_opportunities
  where case_id = case_checkin;
  visit_deadline := pg_catalog.now() + interval '10 days';
  update public.challenge_items
  set redemption_deadline = visit_deadline
  where id = item_refused;
  update public.restaurants set status = 'paused' where id = grill_b;
  result := public.open_visit_problem_makeup_item(refused_spot, member);
  if result ->> 'error' is distinct from 'not_bookable'
     or result ->> 'detail' is distinct from 'restaurant' then
    raise exception 'FAIL: paused restaurant was %', result;
  end if;
  update public.restaurants set status = 'active' where id = grill_b;
  update public.challenge_items
  set redemption_deadline = pg_catalog.now() - interval '1 hour'
  where id = item_refused;
  result := public.open_visit_problem_makeup_item(refused_spot, member);
  if result ->> 'error' is distinct from 'not_bookable'
     or result ->> 'detail' is distinct from 'window' then
    raise exception 'FAIL: closed window was %', result;
  end if;
  update public.challenge_items
  set redemption_deadline = visit_deadline
  where id = item_refused;
  result := public.open_visit_problem_makeup_item(refused_spot, member);
  if result ->> 'ok' is distinct from 'true'
     or result ->> 'already_prepared' is distinct from 'false' then
    raise exception 'FAIL: makeup open was %', result;
  end if;
  makeup_item := (result ->> 'makeup_challenge_item_id')::uuid;
  result := public.open_visit_problem_makeup_item(refused_spot, member);
  if result ->> 'already_prepared' is distinct from 'true'
     or (result ->> 'makeup_challenge_item_id')::uuid is distinct from makeup_item then
    raise exception 'FAIL: makeup prepare replay was %', result;
  end if;
  if (select redemption_deadline from public.challenge_items where id = makeup_item) is distinct from visit_deadline
     or (select restaurant_id from public.challenge_items where id = makeup_item) is distinct from grill_b
     or (select offer_version_id from public.challenge_items where id = makeup_item) is not null
     or (select credit_id from public.challenge_items where id = makeup_item) is not null
     or (select status from public.challenge_items where id = makeup_item) is distinct from 'assigned'
     or (select cycle_month from public.challenge_cycles c
         join public.challenge_items i on i.cycle_id = c.id
         where i.id = makeup_item) >= date '1900-01-01'
     or exists (
       select 1 from public.capacity_reservations where challenge_item_id = makeup_item
     )
     or exists (
       select 1 from public.entitlement_credits where challenge_item_id = makeup_item
     ) then
    raise exception 'FAIL: makeup item was not a copy of the original visit';
  end if;
  result := public.use_visit_problem_opportunity(refused_spot, member, redemption_discount);
  if result ->> 'error' is distinct from 'invalid_redemption'
     or (select status from public.visit_problem_opportunities where id = refused_spot) is distinct from 'available' then
    raise exception 'FAIL: original redemption used the spot %', result;
  end if;
  code_expires := pg_catalog.now() + interval '15 minutes';
  reset role;
  select * into issued from public.issue_challenge_redemption(
    member, makeup_item, repeat('d2', 32), 'cipher', 'iviviviviviv', code_expires
  );
  set local role service_role;
  if issued.outcome is distinct from 'created'
     or (select expires_at from public.redemptions where id = issued.redemption_id) is distinct from code_expires
     or (select status from public.challenge_items where id = makeup_item) is distinct from 'redeemed'
     or (select redemption_deadline from public.challenge_items where id = item_refused) is distinct from visit_deadline then
    raise exception 'FAIL: makeup code was %', issued.outcome;
  end if;
  result := public.use_visit_problem_opportunity(refused_spot, member, issued.redemption_id);
  if result ->> 'ok' is distinct from 'true'
     or result ->> 'already_applied' is distinct from 'false' then
    raise exception 'FAIL: makeup use was %', result;
  end if;
  result := public.use_visit_problem_opportunity(refused_spot, member, issued.redemption_id);
  if result ->> 'ok' is distinct from 'true'
     or result ->> 'already_applied' is distinct from 'true'
     or (select count(*) from public.admin_audit_log where action = 'visit_problem.make_up_used' and target_id = case_refused::text) <> 1 then
    raise exception 'FAIL: makeup replay was %', result;
  end if;
  result := public.use_visit_problem_opportunity(refused_spot, member, redemption_other);
  if result ->> 'error' is distinct from 'already_used'
     or (select used_redemption_id from public.visit_problem_opportunities where id = refused_spot) is distinct from issued.redemption_id then
    raise exception 'FAIL: double use was %', result;
  end if;

  update public.challenge_items
  set redemption_deadline = pg_catalog.now() - interval '1 hour'
  where id = item_checkin;
  result := public.open_visit_problem_makeup_item(checkin_spot, member);
  if result ->> 'error' is distinct from 'not_bookable'
     or result ->> 'detail' is distinct from 'window' then
    raise exception 'FAIL: check-in window was %', result;
  end if;
  update public.challenge_items
  set redemption_deadline = visit_deadline
  where id = item_checkin;
  reviewed := public.review_visit_problem_case(
    case_checkin, admin_id, 'resolved', 'The code path is closed.', 'Resolved before use.'
  );
  if reviewed ->> 'ok' is distinct from 'true' then
    raise exception 'FAIL: check-in resolve was %', reviewed;
  end if;
  result := public.open_visit_problem_makeup_item(checkin_spot, member);
  if result ->> 'ok' is distinct from 'true' then
    raise exception 'FAIL: use after resolve open was %', result;
  end if;
  checkin_item := (result ->> 'makeup_challenge_item_id')::uuid;
  reset role;
  select * into issued from public.issue_challenge_redemption(
    member, checkin_item, repeat('d3', 32), 'cipher', 'iviviviviviv', code_expires
  );
  set local role service_role;
  if issued.outcome is distinct from 'created' then
    raise exception 'FAIL: check-in code was %', issued.outcome;
  end if;
  result := public.use_visit_problem_opportunity(checkin_spot, member, issued.redemption_id);
  if result ->> 'ok' is distinct from 'true'
     or (select status from public.visit_problem_cases where id = case_checkin) is distinct from 'resolved'
     or (select status from public.challenge_items where id = item_checkin) is distinct from 'assigned' then
    raise exception 'FAIL: use after resolve was %', result;
  end if;
  select count(*) into makeup_audits
  from public.admin_audit_log
  where action = 'visit_problem.make_up_used';
  if makeup_audits <> 2 then
    raise exception 'FAIL: makeup audit count %', makeup_audits;
  end if;

  -- The case guard refuses this row. Disable only that guard so the savings
  -- function still has to refuse a redemption that belongs to another visit.
  reset role;
  alter table public.visit_problem_cases disable trigger visit_problem_cases_guard;
  insert into public.challenge_items (
    id, cycle_id, restaurant_id, slot_number, status
  ) values (
    'e07d2000-0000-4000-8000-000000000047', cycle_nov, grill, 1, 'swapped_out'
  );
  insert into public.visit_problem_cases (
    id, user_id, challenge_item_id, redemption_id, category, explanation
  ) values (
    'e07d2000-0000-4000-8000-000000000087',
    member,
    'e07d2000-0000-4000-8000-000000000047',
    redemption_discount,
    'wrong_discount',
    'This redemption belongs to another visit.'
  );
  alter table public.visit_problem_cases enable trigger visit_problem_cases_guard;
  set local role service_role;
  result := public.correct_visit_problem_savings(
    'e07d2000-0000-4000-8000-000000000087', admin_id, 1500, 'Not this visit.'
  );
  if result ->> 'error' is distinct from 'no_redemption'
     or (select count(*) from public.visit_problem_savings_adjustments) <> 2
     or (select count(*) from public.admin_audit_log where action = 'visit_problem.correct_savings') <> 2
     or (select total_discount_cents from public.redemptions where id = redemption_discount) is distinct from stored_total
     or (select challenge_item_id from public.redemptions where id = redemption_discount) is distinct from item_discount then
    raise exception 'FAIL: savings for another visit was %', result;
  end if;

  select count(*) into savings_count from public.visit_problem_savings_adjustments;
  select count(*) into opportunity_count from public.visit_problem_opportunities;
  select count(*) into savings_audits from public.admin_audit_log where action = 'visit_problem.correct_savings';
  select count(*) into restore_audits from public.admin_audit_log where action = 'visit_problem.restore_opportunity';
  if savings_count <> 2 or opportunity_count <> 3 or savings_audits <> 2 or restore_audits <> 3 then
    raise exception 'FAIL: correction counts savings % opportunities % audits %/%',
      savings_count, opportunity_count, savings_audits, restore_audits;
  end if;
  if (select quote_id from public.visit_problem_savings_adjustments where case_id = case_discount) is distinct from active_quote
     or (select original_cents from public.visit_problem_savings_adjustments where case_id = case_discount) is distinct from 2500
     or (select settlement_kind from public.visit_problem_savings_adjustments where case_id = case_discount) is distinct from 'consume_quote'
     or (select original_cents from public.visit_problem_savings_adjustments where case_id = case_other) is distinct from 1500
     or (select settlement_kind from public.visit_problem_savings_adjustments where case_id = case_other) is distinct from 'use_sealed_base'
     or (select challenge_item_id from public.visit_problem_opportunities where case_id = case_refused) is distinct from item_refused
     or (select status from public.visit_problem_opportunities where case_id = case_refused) is distinct from 'used'
     or (select redemption_id from public.visit_problem_opportunities where case_id = case_checkin) is not null then
    raise exception 'FAIL: correction snapshot';
  end if;

  reset role;

  if (select status from public.redemptions where id = redemption_discount) is distinct from redemption_status
     or (select verified_at from public.redemptions where id = redemption_discount) is distinct from stored_verified
     or (select settlement_kind from public.redemptions where id = redemption_discount) is distinct from stored_kind
     or (select total_discount_cents from public.redemptions where id = redemption_discount) is distinct from stored_total
     or (select quote_id from public.redemptions where id = redemption_discount) is distinct from stored_quote
     or (select quote_expires_at from public.redemptions where id = redemption_discount) is distinct from stored_quote_expires
     or (select sealed_discount_amount_cents from public.redemptions where id = redemption_other) is distinct from 1500
     or (select status from public.redemptions where id = redemption_issued) is distinct from 'issued'
     or (select status from public.challenge_items where id = item_discount) is distinct from item_status
     or (select status from public.challenge_items where id = item_refused) is distinct from 'redeemed'
     or (select expires_at from public.boost_quotes where id = active_quote) is distinct from quote_row_expires
     or (select total_discount_cents from public.boost_quotes where id = active_quote) is distinct from quote_total
     or (select expires_at from public.boost_arrival_sessions where id = session_id) is distinct from quote_expires then
    raise exception 'FAIL: original visit or quote changed';
  end if;

  select count(*) into sessions_after from public.boost_arrival_sessions;
  select count(*) into quotes_after from public.boost_quotes;
  select count(*) into capacity_after from public.capacity_reservations;
  select count(*) into credits_after from public.entitlement_credits;
  select count(*) into badges_after from public.user_badges;
  select count(*) into redemptions_after from public.redemptions;
  if sessions_after <> sessions_before
     or quotes_after <> quotes_before
     or capacity_after <> capacity_before
     or credits_after <> credits_before
     or badges_after <> badges_before
     or redemptions_after <> redemptions_before + 2 then
    raise exception 'FAIL: correction minted or removed a visit row';
  end if;

  begin
    update public.visit_problem_savings_adjustments
    set corrected_cents = 1
    where case_id = case_discount;
    raise exception 'FAIL: savings row was updated';
  exception
    when check_violation then
      null;
  end;
end;
$$;

rollback;
