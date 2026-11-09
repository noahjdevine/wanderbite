-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E07-D1: owner-only visit problems, one open case, admin audit, no visit correction.
begin;
set local statement_timeout = '15s';

do $$
declare
  member uuid := 'e07d1000-0000-4000-8000-000000000001';
  stranger uuid := 'e07d1000-0000-4000-8000-000000000002';
  admin_id uuid := 'e07d1000-0000-4000-8000-000000000003';
  partner_id uuid := 'e07d1000-0000-4000-8000-000000000004';
  grill uuid := 'e07d1000-0000-4000-8000-000000000011';
  member_cycle uuid := 'e07d1000-0000-4000-8000-000000000031';
  stranger_cycle uuid := 'e07d1000-0000-4000-8000-000000000032';
  item_open uuid := 'e07d1000-0000-4000-8000-000000000041';
  item_swapped uuid := 'e07d1000-0000-4000-8000-000000000042';
  item_stranger uuid := 'e07d1000-0000-4000-8000-000000000043';
  redemption_member uuid := 'e07d1000-0000-4000-8000-000000000051';
  redemption_stranger uuid := 'e07d1000-0000-4000-8000-000000000052';
  case_id uuid := 'e07d1000-0000-4000-8000-000000000061';
  later_case uuid := 'e07d1000-0000-4000-8000-000000000062';
  fn text := 'public.review_visit_problem_case(uuid, uuid, text, text, text)';
  guard_src text;
  review_src text;
  reviewed jsonb;
  item_status text;
  redemption_status text;
  stored_explanation text;
  audit_count int;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.visit_problem_cases'::regclass) then
    raise exception 'FAIL: visit problem RLS disabled';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'visit_problem_cases'
  ) then
    raise exception 'FAIL: visit problem policy exists';
  end if;
  if exists (
    select 1 from pg_views
    where schemaname = 'public' and definition ilike '%visit_problem_cases%'
  ) then
    raise exception 'FAIL: a view exposes visit problems';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'visit_problem_cases'
      and column_name in ('reason', 'actor_user_id', 'internal_note')
  ) then
    raise exception 'FAIL: visit problem stored an internal column';
  end if;

  if has_table_privilege('anon', 'public.visit_problem_cases', 'SELECT')
     or has_table_privilege('anon', 'public.visit_problem_cases', 'INSERT')
     or has_table_privilege('authenticated', 'public.visit_problem_cases', 'SELECT')
     or has_table_privilege('authenticated', 'public.visit_problem_cases', 'INSERT')
     or has_table_privilege('authenticated', 'public.visit_problem_cases', 'UPDATE')
     or has_table_privilege('authenticated', 'public.visit_problem_cases', 'DELETE')
     or has_table_privilege('service_role', 'public.visit_problem_cases', 'UPDATE')
     or has_table_privilege('service_role', 'public.visit_problem_cases', 'DELETE')
     or not has_table_privilege('service_role', 'public.visit_problem_cases', 'SELECT')
     or not has_table_privilege('service_role', 'public.visit_problem_cases', 'INSERT')
     or has_function_privilege('anon', fn, 'EXECUTE')
     or has_function_privilege('authenticated', fn, 'EXECUTE')
     or not has_function_privilege('service_role', fn, 'EXECUTE')
     or has_function_privilege('service_role', 'public.visit_problem_cases_guard()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.visit_problem_cases_guard()', 'EXECUTE') then
    raise exception 'FAIL: visit problem grants';
  end if;

  select p.prosrc into guard_src
  from pg_proc p
  where p.oid = 'public.visit_problem_cases_guard()'::regprocedure;
  select p.prosrc into review_src
  from pg_proc p
  where p.oid = fn::regprocedure;
  if position('for update' in lower(review_src)) = 0
     or position('entitlement_credits' in review_src) > 0
     or position('user_badges' in review_src) > 0
     or position('challenge_items' in review_src) > 0
     or position('redemptions' in review_src) > 0
     or position('owner mismatch' in guard_src) = 0 then
    raise exception 'FAIL: visit problem function shape';
  end if;
  if (select indexdef from pg_indexes where indexname = 'visit_problem_cases_one_open_idx')
       not ilike '%unique%'
     or (select indexdef from pg_indexes where indexname = 'visit_problem_cases_one_open_idx')
       not ilike '%submitted%'
     or (select indexdef from pg_indexes where indexname = 'visit_problem_cases_one_open_idx')
       not ilike '%under_review%' then
    raise exception 'FAIL: one open case index';
  end if;

  insert into auth.users (id) values (member), (stranger), (admin_id), (partner_id);
  insert into public.user_profiles (id, subscription_status, is_admin, role) values
    (member, 'active', false, 'subscriber'),
    (stranger, 'active', false, 'subscriber'),
    (admin_id, 'active', true, 'admin'),
    (partner_id, 'active', false, 'partner');
  insert into public.restaurants (id, name, status) values (grill, 'E07 D1 Grill', 'active');
  insert into public.challenge_cycles (id, user_id, cycle_month, status) values
    (member_cycle, member, '2026-11-01', 'active'),
    (stranger_cycle, stranger, '2026-11-01', 'active');
  insert into public.challenge_items (id, cycle_id, restaurant_id, slot_number, status) values
    (item_open, member_cycle, grill, 1, 'assigned'),
    (item_swapped, member_cycle, grill, 2, 'swapped_out'),
    (item_stranger, stranger_cycle, grill, 1, 'assigned');
  insert into public.redemptions (
    id, user_id, restaurant_id, challenge_item_id, token_hash, status
  ) values
    (redemption_member, member, grill, item_open, 'e07d1-member', 'issued'),
    (redemption_stranger, stranger, grill, item_stranger, 'e07d1-stranger', 'issued');

  set local role service_role;

  insert into public.visit_problem_cases (
    id, user_id, challenge_item_id, redemption_id, category, explanation
  ) values (
    case_id, member, item_open, null, 'check_in_code', 'The code would not scan.'
  );
  if (select status from public.visit_problem_cases where id = case_id) is distinct from 'submitted'
     or (select redemption_id from public.visit_problem_cases where id = case_id) is not null
     or (select member_response from public.visit_problem_cases where id = case_id) is not null then
    raise exception 'FAIL: a code was required or a response was invented';
  end if;

  begin
    insert into public.visit_problem_cases (
      user_id, challenge_item_id, category, explanation
    ) values (
      member, item_open, 'wrong_discount', 'A different story.'
    );
    raise exception 'FAIL: a second open case was stored';
  exception when unique_violation then null;
  end;
  if (select c.explanation from public.visit_problem_cases c where c.id = case_id) is distinct from 'The code would not scan.'
     or (select count(*) from public.visit_problem_cases where challenge_item_id = item_open) <> 1 then
    raise exception 'FAIL: the duplicate changed the original report';
  end if;

  begin
    insert into public.visit_problem_cases (
      user_id, challenge_item_id, category, explanation
    ) values (
      stranger, item_open, 'other', 'Not my visit.'
    );
    raise exception 'FAIL: another member filed this visit';
  exception when check_violation then null;
  end;

  begin
    insert into public.visit_problem_cases (
      user_id, challenge_item_id, category, explanation
    ) values (
      member, item_swapped, 'other', 'Swapped visit.'
    );
    raise exception 'FAIL: a swapped visit was stored';
  exception when check_violation then null;
  end;

  begin
    insert into public.visit_problem_cases (
      user_id, challenge_item_id, redemption_id, category, explanation
    ) values (
      member, item_open, redemption_stranger, 'other', 'Wrong code.'
    );
    raise exception 'FAIL: another redemption was linked';
  exception when check_violation then null;
  end;
  if (select count(*) from public.visit_problem_cases) <> 1 then
    raise exception 'FAIL: a rejected insert left a row';
  end if;

  begin
    insert into public.visit_problem_cases (
      user_id, challenge_item_id, category, explanation
    ) values (
      member, item_open, 'refund', 'Nope.'
    );
    raise exception 'FAIL: a bad category was stored';
  exception when check_violation then null;
  end;

  begin
    insert into public.visit_problem_cases (
      user_id, challenge_item_id, category, explanation
    ) values (
      member, item_open, 'other', ''
    );
    raise exception 'FAIL: an empty explanation was stored';
  exception when check_violation then null;
  end;

  begin
    insert into public.visit_problem_cases (
      user_id, challenge_item_id, category, explanation
    ) values (
      member, item_open, 'other', repeat('x', 501)
    );
    raise exception 'FAIL: an oversized explanation was stored';
  exception when check_violation then null;
  end;

  begin
    update public.visit_problem_cases set explanation = 'rewritten' where id = case_id;
    raise exception 'FAIL: service role updated the submission directly';
  exception when insufficient_privilege then null;
  end;

  reviewed := public.review_visit_problem_case(
    case_id, partner_id, 'under_review', null, 'Partner should not review.'
  );
  if reviewed ->> 'error' is distinct from 'not_admin'
     or exists (select 1 from public.admin_audit_log where target_id = case_id::text) then
    raise exception 'FAIL: partner review was %', reviewed;
  end if;

  reviewed := public.review_visit_problem_case(
    case_id, admin_id, 'under_review', null, 'internal-staff-note'
  );
  if reviewed ->> 'ok' is distinct from 'true'
     or reviewed ->> 'status' is distinct from 'under_review'
     or reviewed::text ilike '%internal-staff-note%' then
    raise exception 'FAIL: under review leaked or failed %', reviewed;
  end if;

  reviewed := public.review_visit_problem_case(case_id, admin_id, 'resolved', '   ', 'No explanation.');
  if reviewed ->> 'error' is distinct from 'explanation_required'
     or (select status from public.visit_problem_cases where id = case_id) is distinct from 'under_review' then
    raise exception 'FAIL: resolution without an explanation was %', reviewed;
  end if;

  select status into item_status from public.challenge_items where id = item_open;
  select status into redemption_status from public.redemptions where id = redemption_member;
  reviewed := public.review_visit_problem_case(
    case_id, admin_id, 'resolved', 'The offer stood as shown.', 'No correction in this slice.'
  );
  if reviewed ->> 'ok' is distinct from 'true'
     or reviewed ->> 'member_response' is distinct from 'The offer stood as shown.'
     or reviewed::text ilike '%No correction in this slice.%' then
    raise exception 'FAIL: resolution result was %', reviewed;
  end if;

  select c.explanation, c.status into stored_explanation, item_status
  from public.visit_problem_cases c
  where c.id = case_id;
  if stored_explanation is distinct from 'The code would not scan.'
     or item_status is distinct from 'resolved'
     or (select status from public.challenge_items where id = item_open) is distinct from 'assigned'
     or (select status from public.redemptions where id = redemption_member) is distinct from redemption_status
     or (select member_response from public.visit_problem_cases where id = case_id) is distinct from 'The offer stood as shown.'
     or (select resolved_at from public.visit_problem_cases where id = case_id) is null then
    raise exception 'FAIL: resolution changed the visit or the original report';
  end if;
  if (select count(*) from public.user_badges where user_id = member) <> 0
     or (select count(*) from public.entitlement_credits where user_id = member) <> 0
     or (select count(*) from public.boost_quotes) <> 0 then
    raise exception 'FAIL: filing or review created a reward or quote';
  end if;

  select count(*) into audit_count
  from public.admin_audit_log
  where actor_user_id = admin_id
    and target_type = 'visit_problem_case'
    and target_id = case_id::text
    and action = 'visit_problem.resolve'
    and metadata ->> 'reason' = 'No correction in this slice.'
    and metadata ->> 'from_status' = 'under_review'
    and metadata ->> 'to_status' = 'resolved'
    and created_at is not null;
  if audit_count <> 1 then
    raise exception 'FAIL: resolve audit was %', audit_count;
  end if;
  if (select count(*) from public.admin_audit_log
      where target_id = case_id::text and action = 'visit_problem.review') <> 1 then
    raise exception 'FAIL: review audit missing';
  end if;

  reviewed := public.review_visit_problem_case(
    case_id, admin_id, 'under_review', 'Changed.', 'Second admin.'
  );
  if reviewed ->> 'error' is distinct from 'terminal'
     or (select count(*) from public.admin_audit_log where target_id = case_id::text and action = 'visit_problem.resolve') <> 1
     or (select member_response from public.visit_problem_cases where id = case_id) is distinct from 'The offer stood as shown.' then
    raise exception 'FAIL: a second admin rewrote the resolution %', reviewed;
  end if;

  insert into public.visit_problem_cases (
    id, user_id, challenge_item_id, redemption_id, category, explanation
  ) values (
    later_case, member, item_open, redemption_member, 'wrong_discount', 'The later bill was wrong.'
  );
  if (select count(*) from public.visit_problem_cases where challenge_item_id = item_open and status = 'submitted') <> 1
     or (select c.explanation from public.visit_problem_cases c where c.id = case_id) is distinct from 'The code would not scan.' then
    raise exception 'FAIL: a later case replaced the original';
  end if;

  reset role;
  begin
    set local role authenticated;
    perform 1 from public.visit_problem_cases;
    raise exception 'FAIL: authenticated read succeeded';
  exception when insufficient_privilege then null;
  end;
  reset role;
  begin
    set local role authenticated;
    perform public.review_visit_problem_case(case_id, admin_id, 'resolved', 'Nope.', 'Nope.');
    raise exception 'FAIL: authenticated review succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
