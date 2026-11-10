-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E09-A4: backfill past verified visits from their real verified_at, grant a
-- drawing entry only at or after the supplied instant, and recover a missed
-- visit without moving a milestone that was already stored.
begin;
set local statement_timeout = '45s';

do $$
declare
  fn text := 'public.backfill_verified_visit_progress(timestamptz,uuid,boolean)';
  helper text := 'public.progression_insert_missing_v1_milestones(uuid)';
  recorder text := 'public.record_verified_visit_progress(uuid)';
  fn_src text;
  helper_src text;
  recorder_src text;
  fn_config text[];
  fn_definer boolean;
  args text;
  defaults smallint;
  tbl text;
begin
  select p.prosecdef, p.proconfig, p.prosrc, p.pronargdefaults, pg_get_function_arguments(p.oid)
    into fn_definer, fn_config, fn_src, defaults, args
  from pg_proc p
  where p.oid = fn::regprocedure;
  if fn_definer is not true
     or fn_config is distinct from array['search_path=pg_catalog, public']
     or pg_get_function_result(fn::regprocedure) is distinct from 'jsonb'
     or defaults is distinct from 2
     or split_part(args, ',', 1) ilike '%default%'
     or args not ilike '%p_dry_run boolean default true%'
     or has_function_privilege('anon', fn, 'EXECUTE')
     or has_function_privilege('authenticated', fn, 'EXECUTE')
     or not has_function_privilege('service_role', fn, 'EXECUTE')
     or position('progression_insert_missing_v1_milestones' in fn_src) = 0
     or position('p_entries_from is required' in fn_src) = 0
     or position('wanderbite.progression.v1' in fn_src) = 0
     or position('on conflict' in lower(fn_src)) = 0
     or position('update public.progression' in lower(fn_src)) > 0
     or position('update public.redemptions' in lower(fn_src)) > 0
     or position('now()' in lower(fn_src)) > 0 then
    raise exception 'FAIL: backfill shape % defaults %', args, defaults;
  end if;

  select p.prosecdef, p.proconfig, p.prosrc
    into fn_definer, fn_config, helper_src
  from pg_proc p
  where p.oid = helper::regprocedure;
  if fn_definer is true
     or fn_config is distinct from array['search_path=pg_catalog, public']
     or has_function_privilege('anon', helper, 'EXECUTE')
     or has_function_privilege('authenticated', helper, 'EXECUTE')
     or has_function_privilege('service_role', helper, 'EXECUTE')
     or position('(1, 300)' in helper_src) = 0
     or position('2500 + step.n * 1000' in helper_src) = 0
     or position('wanderbite.progression.v1' in helper_src) = 0 then
    raise exception 'FAIL: milestone helper shape';
  end if;

  select p.prosrc into recorder_src from pg_proc p where p.oid = recorder::regprocedure;
  if position('progression_insert_missing_v1_milestones' in recorder_src) = 0
     or position('(1, 300)' in recorder_src) > 0
     or position('2500 + step.n * 1000' in recorder_src) > 0
     or position('wanderbite.progression.v1' in recorder_src) = 0
     or position('on conflict' in lower(recorder_src)) = 0
     or position('now()' in lower(recorder_src)) > 0 then
    raise exception 'FAIL: recorder no longer calls the single schedule';
  end if;

  if (select count(*) from pg_policies
      where schemaname = 'public'
        and tablename in (
          'progression_events',
          'progression_milestones',
          'progression_drawing_entries'
        )
        and cmd = 'SELECT'
        and roles = array['authenticated']::name[]) <> 3 then
    raise exception 'FAIL: progression policies changed';
  end if;

  for tbl in
    select unnest(array[
      'progression_events',
      'progression_milestones',
      'progression_drawing_entries'
    ])
  loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', tbl)::regclass)
       or (select relforcerowsecurity from pg_class where oid = format('public.%I', tbl)::regclass)
       or has_table_privilege('anon', format('public.%I', tbl), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', tbl), 'INSERT')
       or has_table_privilege('service_role', format('public.%I', tbl), 'INSERT') then
      raise exception 'FAIL: progression RLS or grants changed on %', tbl;
    end if;
  end loop;
end;
$$;

set local role service_role;
do $$
declare
  result jsonb;
  zeros jsonb := jsonb_build_object(
    'members', 0,
    'events', 0,
    'milestones', 0,
    'entries', 0,
    'milestones_without_entry', 0
  );
begin
  result := public.backfill_verified_visit_progress('2026-01-01 06:00:00+00');
  if result is distinct from zeros
     or (select count(*) from public.progression_events) <> 0 then
    raise exception 'FAIL: empty service_role dry run %', result;
  end if;
  begin
    perform public.progression_insert_missing_v1_milestones('e09a4000-0000-4000-8000-0000000000ff');
    raise exception 'FAIL: service_role executed the helper';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

reset role;
set local role anon;
do $$
begin
  begin
    perform public.backfill_verified_visit_progress('2026-01-01 06:00:00+00');
    raise exception 'FAIL: anon executed backfill';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    perform public.progression_insert_missing_v1_milestones('e09a4000-0000-4000-8000-0000000000ff');
    raise exception 'FAIL: anon executed the helper';
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
    perform public.backfill_verified_visit_progress('2026-01-01 06:00:00+00', null, false);
    raise exception 'FAIL: authenticated executed backfill';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    perform public.progression_insert_missing_v1_milestones('e09a4000-0000-4000-8000-0000000000ff');
    raise exception 'FAIL: authenticated executed the helper';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

reset role;
do $$
declare
  events_before integer;
begin
  select count(*) into events_before from public.progression_events;
  begin
    perform public.backfill_verified_visit_progress(null, null, false);
    raise exception 'FAIL: null entries_from returned';
  exception
    when invalid_parameter_value then
      if sqlerrm is distinct from 'p_entries_from is required' then
        raise exception 'FAIL: null entries_from message %', sqlerrm;
      end if;
  end;
  if (select count(*) from public.progression_events) <> events_before then
    raise exception 'FAIL: null entries_from wrote a row';
  end if;
end;
$$;

create function pg_temp.seed_verified_visits(
  p_user uuid,
  p_restaurant uuid,
  p_n integer,
  p_base timestamptz
) returns void
language plpgsql
set search_path to pg_catalog, public
as $seed$
declare
  i integer;
  visit_id uuid;
  visit_at timestamptz;
begin
  for i in 1..p_n loop
    visit_id := gen_random_uuid();
    visit_at := p_base + ((i - 1) * interval '10 days');
    insert into public.redemptions (
      id, user_id, restaurant_id, token_hash, status, verified_at, expires_at
    ) values (
      visit_id,
      p_user,
      p_restaurant,
      md5(visit_id::text) || md5('e09a4' || visit_id::text),
      'verified',
      visit_at,
      visit_at + interval '35 days'
    );
  end loop;
end;
$seed$;

create function pg_temp.nth_verified(p_user uuid, p_n integer)
returns table (id uuid, verified_at timestamptz)
language sql
stable
set search_path to pg_catalog, public
as $nth$
  select s.id, s.verified_at
  from (
    select r.id, r.verified_at, row_number() over (order by r.verified_at, r.id) as n
    from public.redemptions r
    where r.user_id = p_user
      and r.status = 'verified'
      and r.verified_at is not null
  ) s
  where s.n = p_n
$nth$;

do $$
declare
  member_a uuid := 'e09a4000-0000-4000-8000-000000000001';
  member_b uuid := 'e09a4000-0000-4000-8000-000000000002';
  member_p uuid := 'e09a4000-0000-4000-8000-000000000003';
  member_q uuid := 'e09a4000-0000-4000-8000-000000000004';
  member_e uuid := 'e09a4000-0000-4000-8000-000000000005';
  member_f uuid := 'e09a4000-0000-4000-8000-000000000006';
  member_r uuid := 'e09a4000-0000-4000-8000-000000000007';
  member_s uuid := 'e09a4000-0000-4000-8000-000000000008';
  grill uuid := 'e09a4000-0000-4000-8000-000000000011';
  issued_id uuid := 'e09a4000-0000-4000-8000-000000000091';
  issued_stamped uuid := 'e09a4000-0000-4000-8000-000000000092';
  expired_id uuid := 'e09a4000-0000-4000-8000-000000000093';
  null_time_id uuid := 'e09a4000-0000-4000-8000-000000000094';
  null_user_id uuid := 'e09a4000-0000-4000-8000-000000000095';
  e1 uuid := 'e09a4000-0000-4000-8000-0000000000e1';
  e2 uuid := 'e09a4000-0000-4000-8000-0000000000e2';
  e3 uuid := 'e09a4000-0000-4000-8000-0000000000e3';
  f1 uuid := 'e09a4000-0000-4000-8000-0000000000f1';
  f2 uuid := 'e09a4000-0000-4000-8000-0000000000f2';
  f3 uuid := 'e09a4000-0000-4000-8000-0000000000f3';
  f4 uuid := 'e09a4000-0000-4000-8000-0000000000f4';
  base timestamptz := '2025-06-01 18:00:00+00';
  a_from timestamptz := '2026-01-01 06:00:00+00';
  e3_at timestamptz := '2026-03-03 18:00:00+00';
  f4_at timestamptz := '2026-05-04 18:00:00+00';
  zeros jsonb := jsonb_build_object(
    'members', 0,
    'events', 0,
    'milestones', 0,
    'entries', 0,
    'milestones_without_entry', 0
  );
  expected_visits integer[] := array[3, 10, 15, 25, 35];
  expected_quarters text[] := array['2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2'];
  expected_times timestamptz[] := array[
    '2025-06-21 18:00:00+00',
    '2025-08-30 18:00:00+00',
    '2025-10-19 18:00:00+00',
    '2026-01-27 18:00:00+00',
    '2026-05-07 18:00:00+00'
  ];
  result jsonb;
  dry jsonb;
  b_from timestamptz;
  visit_id uuid;
  visit_at timestamptz;
  got_at timestamptz;
  got_quarter text;
  got_source uuid;
  got_occurred timestamptz;
  entry_n integer;
  expected_entries integer;
  events_before integer;
  a_entries integer;
  f_milestone uuid;
  f_reached timestamptz;
  f_quarter text;
  f_source uuid;
  f_entry uuid;
  f_entry_quarter text;
  f_entry_created timestamptz;
  i integer;
  skipped uuid;
begin
  insert into auth.users (id) values
    (member_a), (member_b), (member_p), (member_q),
    (member_e), (member_f), (member_r), (member_s);
  insert into public.user_profiles (id, is_admin, role) values
    (member_a, false, 'subscriber'),
    (member_b, false, 'subscriber'),
    (member_p, false, 'subscriber'),
    (member_q, false, 'subscriber'),
    (member_e, false, 'subscriber'),
    (member_f, false, 'subscriber'),
    (member_r, false, 'subscriber'),
    (member_s, false, 'subscriber');
  insert into public.restaurants (id, name, status) values
    (grill, 'E09 A4 Grill', 'active');

  perform pg_temp.seed_verified_visits(member_a, grill, 36, base);
  perform pg_temp.seed_verified_visits(member_b, grill, 15, base);
  perform pg_temp.seed_verified_visits(member_p, grill, 3, '2026-06-01 18:00:00+00');
  perform pg_temp.seed_verified_visits(member_q, grill, 3, '2026-06-01 18:00:00+00');
  perform pg_temp.seed_verified_visits(member_r, grill, 36, base);
  perform pg_temp.seed_verified_visits(member_s, grill, 36, base);

  insert into public.redemptions (
    id, user_id, restaurant_id, token_hash, status, verified_at, expires_at
  ) values
    (issued_id, member_a, grill, md5(issued_id::text) || md5('e09a4' || issued_id::text),
      'issued', null, now() + interval '35 days'),
    (issued_stamped, member_a, grill, md5(issued_stamped::text) || md5('e09a4' || issued_stamped::text),
      'issued', base, base + interval '35 days'),
    (expired_id, member_a, grill, md5(expired_id::text) || md5('e09a4' || expired_id::text),
      'expired', base, base + interval '35 days'),
    (null_time_id, member_a, grill, md5(null_time_id::text) || md5('e09a4' || null_time_id::text),
      'verified', null, now() + interval '35 days'),
    (null_user_id, null, grill, md5(null_user_id::text) || md5('e09a4' || null_user_id::text),
      'verified', base, base + interval '35 days'),
    (e1, member_e, grill, md5(e1::text) || md5('e09a4' || e1::text),
      'verified', '2026-03-01 18:00:00+00', '2026-03-01 18:00:00+00'::timestamptz + interval '35 days'),
    (e2, member_e, grill, md5(e2::text) || md5('e09a4' || e2::text),
      'verified', '2026-03-02 18:00:00+00', '2026-03-02 18:00:00+00'::timestamptz + interval '35 days'),
    (e3, member_e, grill, md5(e3::text) || md5('e09a4' || e3::text),
      'verified', e3_at, e3_at + interval '35 days'),
    (f1, member_f, grill, md5(f1::text) || md5('e09a4' || f1::text),
      'verified', '2026-05-01 18:00:00+00', '2026-05-01 18:00:00+00'::timestamptz + interval '35 days'),
    (f2, member_f, grill, md5(f2::text) || md5('e09a4' || f2::text),
      'verified', '2026-05-02 18:00:00+00', '2026-05-02 18:00:00+00'::timestamptz + interval '35 days'),
    (f3, member_f, grill, md5(f3::text) || md5('e09a4' || f3::text),
      'verified', '2026-05-03 18:00:00+00', '2026-05-03 18:00:00+00'::timestamptz + interval '35 days'),
    (f4, member_f, grill, md5(f4::text) || md5('e09a4' || f4::text),
      'verified', f4_at, f4_at + interval '35 days');

  for i in 1..5 loop
    select v.id, v.verified_at into visit_id, visit_at
    from pg_temp.nth_verified(member_a, expected_visits[i]) v;
    if visit_at is distinct from expected_times[i] then
      raise exception 'FAIL: visit % instant %', expected_visits[i], visit_at;
    end if;
  end loop;

  dry := public.backfill_verified_visit_progress(a_from, member_a, true);
  if dry <> jsonb_build_object(
       'members', 1,
       'events', 36,
       'milestones', 5,
       'entries', 2,
       'milestones_without_entry', 3
     )
     or (select count(*) from public.progression_events) <> 0
     or (select count(*) from public.progression_milestones) <> 0
     or (select count(*) from public.progression_drawing_entries) <> 0 then
    raise exception 'FAIL: member A dry run %', dry;
  end if;

  result := public.backfill_verified_visit_progress(a_from, member_a, false);
  if result is distinct from dry then
    raise exception 'FAIL: member A apply % dry %', result, dry;
  end if;
  if (select count(*) from public.progression_events where user_id = member_a) <> 36
     or (select count(*) from public.progression_milestones where user_id = member_a) <> 5
     or (select count(*) from public.progression_drawing_entries where user_id = member_a) <> 2
     or exists (
       select 1 from public.progression_milestones
       where user_id = member_a and milestone_key = 'v1:level:6'
     ) then
    raise exception 'FAIL: member A ledger counts';
  end if;

  for i in 1..5 loop
    select v.id, v.verified_at into visit_id, visit_at
    from pg_temp.nth_verified(member_a, expected_visits[i]) v;
    select m.reached_at, m.quarter_key, e.source_id, e.occurred_at
      into got_at, got_quarter, got_source, got_occurred
    from public.progression_milestones m
    join public.progression_events e on e.id = m.source_event_id
    where m.user_id = member_a and m.level = i;
    select count(*) into entry_n
    from public.progression_drawing_entries d
    join public.progression_milestones m on m.id = d.milestone_id
    where m.user_id = member_a and m.level = i;
    expected_entries := case when i >= 4 then 1 else 0 end;
    if got_at is distinct from expected_times[i]
       or got_occurred is distinct from expected_times[i]
       or got_source is distinct from visit_id
       or got_quarter is distinct from expected_quarters[i]
       or got_quarter is distinct from (
         pg_catalog.to_char(got_at at time zone 'America/Chicago', 'YYYY')
         || '-Q'
         || (((pg_catalog.date_part('month', got_at at time zone 'America/Chicago'))::integer - 1) / 3 + 1)::text
       )
       or entry_n is distinct from expected_entries then
      raise exception 'FAIL: level % reached % quarter % entries %', i, got_at, got_quarter, entry_n;
    end if;
  end loop;

  foreach skipped in array array[issued_id, issued_stamped, expired_id, null_time_id, null_user_id] loop
    if exists (select 1 from public.progression_events where source_id = skipped) then
      raise exception 'FAIL: skipped redemption % was recorded', skipped;
    end if;
  end loop;

  if public.backfill_verified_visit_progress(a_from, member_a, false) is distinct from zeros
     or public.backfill_verified_visit_progress(a_from, member_a, true) is distinct from zeros
     or (select count(*) from public.progression_events where user_id = member_a) <> 36 then
    raise exception 'FAIL: member A second run wrote a row';
  end if;

  select v.verified_at into b_from from pg_temp.nth_verified(member_b, 15) v;
  if b_from is distinct from '2025-10-19 18:00:00+00'::timestamptz then
    raise exception 'FAIL: member B level 3 instant %', b_from;
  end if;
  dry := public.backfill_verified_visit_progress(b_from, member_b);
  if dry is distinct from public.backfill_verified_visit_progress(b_from, member_b, true)
     or dry is distinct from public.backfill_verified_visit_progress(b_from, member_b, null)
     or dry <> jsonb_build_object(
       'members', 1,
       'events', 15,
       'milestones', 3,
       'entries', 1,
       'milestones_without_entry', 2
     )
     or (select count(*) from public.progression_events where user_id = member_b) <> 0 then
    raise exception 'FAIL: member B default dry run %', dry;
  end if;
  result := public.backfill_verified_visit_progress(b_from, member_b, false);
  if result is distinct from dry
     or (select count(*) from public.progression_drawing_entries d
         join public.progression_milestones m on m.id = d.milestone_id
         where m.user_id = member_b and m.level < 3) <> 0
     or (select count(*) from public.progression_drawing_entries d
         join public.progression_milestones m on m.id = d.milestone_id
         where m.user_id = member_b and m.level = 3 and m.reached_at = b_from) <> 1 then
    raise exception 'FAIL: milestone exactly at entries_from %', result;
  end if;

  if (select count(*) from public.progression_events where user_id = member_q) <> 0 then
    raise exception 'FAIL: member Q had rows before its backfill';
  end if;
  result := public.backfill_verified_visit_progress('2020-01-01 00:00:00+00', member_p, false);
  if result <> jsonb_build_object(
       'members', 1, 'events', 3, 'milestones', 1, 'entries', 1, 'milestones_without_entry', 0
     )
     or (select count(*) from public.progression_events where user_id = member_q) <> 0
     or (select count(*) from public.progression_events where user_id = member_p) <> 3 then
    raise exception 'FAIL: p_user_id touched another member %', result;
  end if;
  perform public.backfill_verified_visit_progress('2020-01-01 00:00:00+00', member_q, false);
  if public.backfill_verified_visit_progress('2020-01-01 00:00:00+00', member_p, false) is distinct from zeros
     or (select count(*) from public.progression_events where user_id = member_p) <> 3
     or (select count(*) from public.progression_events where user_id = member_q) <> 3
     or (select count(*) from public.progression_milestones where user_id = member_q) <> 1 then
    raise exception 'FAIL: second member backfill changed the first';
  end if;

  result := public.record_verified_visit_progress(e1);
  dry := public.record_verified_visit_progress(e2);
  if result->'milestones' <> '[]'::jsonb
     or dry->'milestones' <> '[]'::jsonb
     or (select count(*) from public.progression_events where user_id = member_e) <> 2 then
    raise exception 'FAIL: recovery setup e1 % e2 % events %',
      result, dry, (select count(*) from public.progression_events where user_id = member_e);
  end if;
  result := public.backfill_verified_visit_progress(e3_at, member_e, false);
  if result <> jsonb_build_object(
       'members', 1, 'events', 1, 'milestones', 1, 'entries', 1, 'milestones_without_entry', 0
     )
     or (select count(*) from public.progression_events where user_id = member_e) <> 3
     or (select reached_at from public.progression_milestones where user_id = member_e) is distinct from e3_at
     or (select quarter_key from public.progression_milestones where user_id = member_e) is distinct from '2026-Q1'
     or (select count(*) from public.progression_drawing_entries where user_id = member_e) <> 1 then
    raise exception 'FAIL: missed milestone %', result;
  end if;
  if public.backfill_verified_visit_progress(e3_at, member_e, false) is distinct from zeros
     or (select count(*) from public.progression_drawing_entries where user_id = member_e) <> 1 then
    raise exception 'FAIL: missed milestone was awarded twice';
  end if;

  perform public.record_verified_visit_progress(f2);
  perform public.record_verified_visit_progress(f3);
  perform public.record_verified_visit_progress(f4);
  select m.id, m.reached_at, m.quarter_key, m.source_event_id, d.id, d.quarter_key, d.created_at
    into f_milestone, f_reached, f_quarter, f_source, f_entry, f_entry_quarter, f_entry_created
  from public.progression_milestones m
  join public.progression_drawing_entries d on d.milestone_id = m.id
  where m.user_id = member_f;
  if f_reached is distinct from f4_at or f_quarter is distinct from '2026-Q2' then
    raise exception 'FAIL: frozen setup reached % quarter %', f_reached, f_quarter;
  end if;
  result := public.backfill_verified_visit_progress('2026-01-01 06:00:00+00', member_f, false);
  if result <> jsonb_build_object(
       'members', 1, 'events', 1, 'milestones', 0, 'entries', 0, 'milestones_without_entry', 0
     ) then
    raise exception 'FAIL: earlier event backfill %', result;
  end if;
  if (select id from public.progression_milestones where user_id = member_f) is distinct from f_milestone
     or (select reached_at from public.progression_milestones where user_id = member_f) is distinct from f_reached
     or (select quarter_key from public.progression_milestones where user_id = member_f) is distinct from f_quarter
     or (select source_event_id from public.progression_milestones where user_id = member_f) is distinct from f_source
     or (select id from public.progression_drawing_entries where user_id = member_f) is distinct from f_entry
     or (select quarter_key from public.progression_drawing_entries where user_id = member_f) is distinct from f_entry_quarter
     or (select created_at from public.progression_drawing_entries where user_id = member_f) is distinct from f_entry_created
     or (select count(*) from public.progression_events where user_id = member_f) <> 4
     or (select count(*) from public.progression_milestones where user_id = member_f) <> 1 then
    raise exception 'FAIL: earlier event moved a frozen milestone';
  end if;

  for visit_id in
    select r.id
    from public.redemptions r
    where r.user_id = member_r
      and r.status = 'verified'
      and r.verified_at is not null
    order by r.verified_at, r.id
  loop
    perform public.record_verified_visit_progress(visit_id);
  end loop;
  if (select count(*) from public.progression_events where user_id = member_r) <> 36
     or (select count(*) from public.progression_milestones where user_id = member_r) <> 5
     or (select count(*) from public.progression_drawing_entries where user_id = member_r) <> 5
     or (select count(*) from public.progression_events where user_id = member_s) <> 0 then
    raise exception 'FAIL: record path did not match the 36-visit schedule';
  end if;

  select count(*) into a_entries
  from public.progression_drawing_entries
  where user_id = member_a;
  select count(*) into events_before from public.progression_events;

  dry := public.backfill_verified_visit_progress(base, null, true);
  if dry <> jsonb_build_object(
       'members', 1,
       'events', 36,
       'milestones', 5,
       'entries', 5,
       'milestones_without_entry', 0
     )
     or (select count(*) from public.progression_events) <> events_before
     or (select count(*) from public.progression_events where user_id = member_s) <> 0 then
    raise exception 'FAIL: all-member dry run %', dry;
  end if;
  result := public.backfill_verified_visit_progress(base, null, false);
  if result is distinct from dry
     or (select count(*) from public.progression_drawing_entries where user_id = member_a) <> a_entries
     or (select reached_at from public.progression_milestones where user_id = member_f) is distinct from f_reached
     or (select id from public.progression_drawing_entries where user_id = member_f) is distinct from f_entry
     or (select array_agg(m.reached_at order by m.level)
         from public.progression_milestones m where m.user_id = member_r)
        is distinct from
        (select array_agg(m.reached_at order by m.level)
         from public.progression_milestones m where m.user_id = member_s)
     or (select array_agg(m.quarter_key order by m.level)
         from public.progression_milestones m where m.user_id = member_r)
        is distinct from
        (select array_agg(m.quarter_key order by m.level)
         from public.progression_milestones m where m.user_id = member_s)
     or (select array_agg(e.occurred_at order by m.level)
         from public.progression_milestones m
         join public.progression_events e on e.id = m.source_event_id
         where m.user_id = member_r)
        is distinct from
        (select array_agg(e.occurred_at order by m.level)
         from public.progression_milestones m
         join public.progression_events e on e.id = m.source_event_id
         where m.user_id = member_s)
     or (select count(*) from public.progression_drawing_entries where user_id = member_s) <> 5
     or (select count(*) from public.progression_milestones where user_id = member_s and level = 6) <> 0 then
    raise exception 'FAIL: backfill milestones diverged from record %', result;
  end if;
  if public.backfill_verified_visit_progress(base, null, false) is distinct from zeros then
    raise exception 'FAIL: all-member second run wrote a row';
  end if;

  select count(*) into events_before from public.progression_events;
  begin
    perform public.backfill_verified_visit_progress(null);
    raise exception 'FAIL: null entries_from returned after rows existed';
  exception
    when invalid_parameter_value then
      null;
  end;
  if (select count(*) from public.progression_events) <> events_before
     or (select count(*) from public.progression_milestones where user_id = member_a) <> 5
     or (select count(*) from public.progression_drawing_entries where user_id = member_a) <> a_entries then
    raise exception 'FAIL: null entries_from changed stored rows';
  end if;
end;
$$;

rollback;
