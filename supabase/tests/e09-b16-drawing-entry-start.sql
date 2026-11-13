-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E09-B16: live recording stores the milestone and withholds the drawing
-- entry when reached_at is before progression_drawing_entries_from().
-- A milestone at that instant, or after it, gets exactly one entry.
-- A second call adds nothing.
begin;
set local statement_timeout = '15s';

do $$
declare
  helper text := 'public.progression_drawing_entries_from()';
  recorder text := 'public.record_verified_visit_progress(uuid)';
  helper_src text;
  recorder_src text;
  helper_config text[];
  helper_definer boolean;
  helper_volatile "char";
  recorder_config text[];
  recorder_definer boolean;
  start_at timestamptz;
begin
  select p.prosecdef, p.proconfig, p.prosrc, p.provolatile
    into helper_definer, helper_config, helper_src, helper_volatile
  from pg_proc p
  where p.oid = helper::regprocedure;
  start_at := public.progression_drawing_entries_from();
  if helper_definer is true
     or helper_volatile is distinct from 'i'
     or helper_config is distinct from array['search_path=pg_catalog, public']
     or pg_get_function_result(helper::regprocedure) is distinct from 'timestamp with time zone'
     or position('2027-01-01 00:00:00-06' in helper_src) = 0
     or start_at is distinct from '2027-01-01 00:00:00-06'::timestamptz
     or start_at is distinct from '2027-01-01 06:00:00+00'::timestamptz
     or has_function_privilege('anon', helper, 'EXECUTE')
     or has_function_privilege('authenticated', helper, 'EXECUTE')
     or has_function_privilege('service_role', helper, 'EXECUTE') then
    raise exception 'FAIL: drawing entry start helper %', start_at;
  end if;

  select p.prosecdef, p.proconfig, p.prosrc
    into recorder_definer, recorder_config, recorder_src
  from pg_proc p
  where p.oid = recorder::regprocedure;
  if recorder_definer is not true
     or recorder_config is distinct from array['search_path=pg_catalog, public']
     or has_function_privilege('anon', recorder, 'EXECUTE')
     or has_function_privilege('authenticated', recorder, 'EXECUTE')
     or not has_function_privilege('service_role', recorder, 'EXECUTE')
     or position('progression_insert_missing_v1_milestones' in recorder_src) = 0
     or position('reached_at >= public.progression_drawing_entries_from()' in recorder_src) = 0
     or position('2027-01-01' in recorder_src) > 0
     or position('on conflict' in lower(recorder_src)) = 0
     or position('now()' in lower(recorder_src)) > 0 then
    raise exception 'FAIL: recorder does not gate entries on the shared start';
  end if;
end;
$$;

set local role anon;
do $$
begin
  begin
    perform public.progression_drawing_entries_from();
    raise exception 'FAIL: anon executed the start helper';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

reset role;
set local role authenticated;
do $$
begin
  begin
    perform public.progression_drawing_entries_from();
    raise exception 'FAIL: authenticated executed the start helper';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

reset role;
set local role service_role;
do $$
begin
  begin
    perform public.progression_drawing_entries_from();
    raise exception 'FAIL: service_role executed the start helper';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

reset role;

do $$
declare
  member_before uuid := 'e09b1600-0000-4000-8000-000000000001';
  member_exact uuid := 'e09b1600-0000-4000-8000-000000000002';
  member_after uuid := 'e09b1600-0000-4000-8000-000000000003';
  grill uuid := 'e09b1600-0000-4000-8000-000000000011';
  before_1 uuid := 'e09b1600-0000-4000-8000-000000000101';
  before_2 uuid := 'e09b1600-0000-4000-8000-000000000102';
  before_3 uuid := 'e09b1600-0000-4000-8000-000000000103';
  exact_1 uuid := 'e09b1600-0000-4000-8000-000000000201';
  exact_2 uuid := 'e09b1600-0000-4000-8000-000000000202';
  exact_3 uuid := 'e09b1600-0000-4000-8000-000000000203';
  after_1 uuid := 'e09b1600-0000-4000-8000-000000000301';
  after_2 uuid := 'e09b1600-0000-4000-8000-000000000302';
  after_3 uuid := 'e09b1600-0000-4000-8000-000000000303';
  start_at timestamptz := public.progression_drawing_entries_from();
  before_at timestamptz := start_at - interval '1 millisecond';
  after_at timestamptz := start_at + interval '1 hour';
  result jsonb;
  replay jsonb;
begin
  insert into auth.users (id) values (member_before), (member_exact), (member_after);
  insert into public.user_profiles (id, is_admin, role) values
    (member_before, false, 'subscriber'),
    (member_exact, false, 'subscriber'),
    (member_after, false, 'subscriber');
  insert into public.restaurants (id, name, status) values
    (grill, 'E09 B16 Grill', 'active');

  insert into public.redemptions (
    id, user_id, restaurant_id, token_hash, status, verified_at, expires_at
  ) values
    (before_1, member_before, grill, md5(before_1::text) || md5('e09b16' || before_1::text),
      'verified', before_at - interval '2 days', before_at - interval '2 days' + interval '35 days'),
    (before_2, member_before, grill, md5(before_2::text) || md5('e09b16' || before_2::text),
      'verified', before_at - interval '1 day', before_at - interval '1 day' + interval '35 days'),
    (before_3, member_before, grill, md5(before_3::text) || md5('e09b16' || before_3::text),
      'verified', before_at, before_at + interval '35 days'),
    (exact_1, member_exact, grill, md5(exact_1::text) || md5('e09b16' || exact_1::text),
      'verified', start_at - interval '2 days', start_at - interval '2 days' + interval '35 days'),
    (exact_2, member_exact, grill, md5(exact_2::text) || md5('e09b16' || exact_2::text),
      'verified', start_at - interval '1 day', start_at - interval '1 day' + interval '35 days'),
    (exact_3, member_exact, grill, md5(exact_3::text) || md5('e09b16' || exact_3::text),
      'verified', start_at, start_at + interval '35 days'),
    (after_1, member_after, grill, md5(after_1::text) || md5('e09b16' || after_1::text),
      'verified', after_at - interval '2 days', after_at - interval '2 days' + interval '35 days'),
    (after_2, member_after, grill, md5(after_2::text) || md5('e09b16' || after_2::text),
      'verified', after_at - interval '1 day', after_at - interval '1 day' + interval '35 days'),
    (after_3, member_after, grill, md5(after_3::text) || md5('e09b16' || after_3::text),
      'verified', after_at, after_at + interval '35 days');

  if public.record_verified_visit_progress(before_1)->'milestones' <> '[]'::jsonb
     or public.record_verified_visit_progress(before_2)->'milestones' <> '[]'::jsonb then
    raise exception 'FAIL: milestone before the third visit';
  end if;
  result := public.record_verified_visit_progress(before_3);
  if jsonb_array_length(result->'events') <> 1
     or jsonb_array_length(result->'milestones') <> 1
     or result->'entries' <> '[]'::jsonb
     or result->'milestones'->0->>'milestone_key' is distinct from 'v1:level:1'
     or (result->'milestones'->0->>'level')::integer <> 1
     or (result->'milestones'->0->>'reached_at')::timestamptz is distinct from before_at
     or result->'milestones'->0->>'quarter_key' is distinct from '2026-Q4'
     or (select count(*) from public.progression_events where user_id = member_before) <> 3
     or (select count(*) from public.progression_milestones where user_id = member_before) <> 1
     or (select count(*) from public.progression_drawing_entries where user_id = member_before) <> 0 then
    raise exception 'FAIL: milestone before the start got an entry %', result;
  end if;
  replay := public.record_verified_visit_progress(before_3);
  if replay->'events' <> '[]'::jsonb
     or replay->'milestones' <> '[]'::jsonb
     or replay->'entries' <> '[]'::jsonb
     or (select count(*) from public.progression_events where user_id = member_before) <> 3
     or (select count(*) from public.progression_milestones where user_id = member_before) <> 1
     or (select reached_at from public.progression_milestones where user_id = member_before)
        is distinct from before_at
     or (select quarter_key from public.progression_milestones where user_id = member_before)
        is distinct from '2026-Q4'
     or (select count(*) from public.progression_drawing_entries where user_id = member_before) <> 0 then
    raise exception 'FAIL: replay of a pre-start milestone wrote an entry %', replay;
  end if;

  if public.record_verified_visit_progress(exact_1)->'milestones' <> '[]'::jsonb
     or public.record_verified_visit_progress(exact_2)->'milestones' <> '[]'::jsonb then
    raise exception 'FAIL: exact member milestone before the third visit';
  end if;
  result := public.record_verified_visit_progress(exact_3);
  if jsonb_array_length(result->'events') <> 1
     or jsonb_array_length(result->'milestones') <> 1
     or jsonb_array_length(result->'entries') <> 1
     or (result->'milestones'->0->>'reached_at')::timestamptz is distinct from start_at
     or result->'milestones'->0->>'quarter_key' is distinct from '2027-Q1'
     or result->'entries'->0->>'quarter_key' is distinct from '2027-Q1'
     or result->'entries'->0->>'entry_source' is distinct from 'level_milestone'
     or (select count(*) from public.progression_events where user_id = member_exact) <> 3
     or (select count(*) from public.progression_milestones where user_id = member_exact) <> 1
     or (select count(*) from public.progression_drawing_entries where user_id = member_exact) <> 1 then
    raise exception 'FAIL: milestone exactly at the start %', result;
  end if;
  replay := public.record_verified_visit_progress(exact_3);
  if replay->'events' <> '[]'::jsonb
     or replay->'milestones' <> '[]'::jsonb
     or replay->'entries' <> '[]'::jsonb
     or (select count(*) from public.progression_events where user_id = member_exact) <> 3
     or (select count(*) from public.progression_milestones where user_id = member_exact) <> 1
     or (select count(*) from public.progression_drawing_entries where user_id = member_exact) <> 1
     or (select reached_at from public.progression_milestones where user_id = member_exact)
        is distinct from start_at then
    raise exception 'FAIL: replay of the start instant added an entry %', replay;
  end if;
end;
$$;

-- The production caller is service_role. The definer still reaches the helper.
set local role service_role;
do $$
declare
  after_1 uuid := 'e09b1600-0000-4000-8000-000000000301';
  after_2 uuid := 'e09b1600-0000-4000-8000-000000000302';
  after_3 uuid := 'e09b1600-0000-4000-8000-000000000303';
  result jsonb;
  replay jsonb;
begin
  if public.record_verified_visit_progress(after_1)->'milestones' <> '[]'::jsonb
     or public.record_verified_visit_progress(after_2)->'milestones' <> '[]'::jsonb then
    raise exception 'FAIL: service_role milestone before the third visit';
  end if;
  result := public.record_verified_visit_progress(after_3);
  if jsonb_array_length(result->'events') <> 1
     or jsonb_array_length(result->'milestones') <> 1
     or jsonb_array_length(result->'entries') <> 1
     or result->'entries'->0->>'entry_source' is distinct from 'level_milestone'
     or result->'entries'->0->>'quarter_key' is distinct from '2027-Q1' then
    raise exception 'FAIL: service_role milestone after the start %', result;
  end if;
  replay := public.record_verified_visit_progress(after_3);
  if replay->'events' <> '[]'::jsonb
     or replay->'milestones' <> '[]'::jsonb
     or replay->'entries' <> '[]'::jsonb then
    raise exception 'FAIL: service_role replay added a row %', replay;
  end if;
end;
$$;

reset role;
do $$
declare
  member_after uuid := 'e09b1600-0000-4000-8000-000000000003';
  start_at timestamptz := public.progression_drawing_entries_from();
begin
  if (select count(*) from public.progression_events where user_id = member_after) <> 3
     or (select count(*) from public.progression_milestones where user_id = member_after) <> 1
     or (select count(*) from public.progression_drawing_entries where user_id = member_after) <> 1
     or (select reached_at from public.progression_milestones where user_id = member_after)
        is distinct from start_at + interval '1 hour'
     or (select quarter_key from public.progression_milestones where user_id = member_after)
        is distinct from '2027-Q1' then
    raise exception 'FAIL: service_role path did not store exactly one later entry';
  end if;
end;
$$;

rollback;
