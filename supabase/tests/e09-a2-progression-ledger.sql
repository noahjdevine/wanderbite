-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E09-A2: one event per verified visit, one milestone per level, one drawing
-- entry per milestone. Idempotent replay, out-of-order event time, the
-- Chicago quarter boundary, unverified redemptions, member read, and grants.
begin;
set local statement_timeout = '15s';

do $$
declare
  member_a uuid := 'e09a2000-0000-4000-8000-000000000001';
  member_b uuid := 'e09a2000-0000-4000-8000-000000000002';
  member_c uuid := 'e09a2000-0000-4000-8000-000000000003';
  member_e uuid := 'e09a2000-0000-4000-8000-000000000005';
  grill uuid := 'e09a2000-0000-4000-8000-000000000011';
  late_a uuid := 'e09a2000-0000-4000-8000-000000000101';
  early_a uuid := 'e09a2000-0000-4000-8000-000000000102';
  mid_a uuid := 'e09a2000-0000-4000-8000-000000000103';
  early_b uuid := 'e09a2000-0000-4000-8000-000000000111';
  mid_b uuid := 'e09a2000-0000-4000-8000-000000000112';
  late_b uuid := 'e09a2000-0000-4000-8000-000000000113';
  late_e uuid := 'e09a2000-0000-4000-8000-000000000121';
  early_e uuid := 'e09a2000-0000-4000-8000-000000000122';
  mid_e uuid := 'e09a2000-0000-4000-8000-000000000123';
  issued_id uuid := 'e09a2000-0000-4000-8000-000000000131';
  expired_id uuid := 'e09a2000-0000-4000-8000-000000000132';
  null_time_id uuid := 'e09a2000-0000-4000-8000-000000000133';
  unknown_id uuid := 'e09a2000-0000-4000-8000-000000000199';
  fn text := 'public.record_verified_visit_progress(uuid)';
  -- 2026-12-31 23:30 America/Chicago. The UTC date is already 2027-01-01.
  q4_at timestamptz := '2027-01-01 05:30:00+00';
  -- 2027-01-01 00:30 America/Chicago.
  q1_at timestamptz := '2027-01-01 06:30:00+00';
  june1 timestamptz := '2026-06-01 18:00:00+00';
  june2 timestamptz := '2026-06-02 18:00:00+00';
  visit_base timestamptz := '2026-02-01 18:00:00+00';
  redemption_cols text;
  badge_cols text;
  fn_src text;
  fn_config text[];
  fn_definer boolean;
  missing text;
  tbl text;
  result jsonb;
  replay jsonb;
  visit_id uuid;
  visit_at timestamptz;
  last_id uuid;
  crossing uuid[];
  level_n integer;
  events_before integer;
  milestones_before integer;
  entries_before integer;
  redemptions_before integer;
  badges_before integer;
  i integer;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.progression_events'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.progression_milestones'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.progression_drawing_entries'::regclass) then
    raise exception 'FAIL: progression RLS disabled';
  end if;
  if (select relforcerowsecurity from pg_class where oid = 'public.progression_events'::regclass)
     or (select relforcerowsecurity from pg_class where oid = 'public.progression_milestones'::regclass)
     or (select relforcerowsecurity from pg_class where oid = 'public.progression_drawing_entries'::regclass) then
    raise exception 'FAIL: progression FORCE RLS is on';
  end if;

  if (select count(*) from pg_policies
      where schemaname = 'public'
        and tablename in (
          'progression_events',
          'progression_milestones',
          'progression_drawing_entries'
        )) <> 3
     or (select count(*) from pg_policies
         where schemaname = 'public'
           and tablename in (
             'progression_events',
             'progression_milestones',
             'progression_drawing_entries'
           )
           and cmd = 'SELECT'
           and roles = array['authenticated']::name[]) <> 3 then
    raise exception 'FAIL: progression policies';
  end if;

  for tbl in
    select unnest(array[
      'progression_events',
      'progression_milestones',
      'progression_drawing_entries'
    ])
  loop
    if has_table_privilege('anon', format('public.%I', tbl), 'SELECT')
       or has_table_privilege('anon', format('public.%I', tbl), 'INSERT')
       or has_table_privilege('anon', format('public.%I', tbl), 'UPDATE')
       or has_table_privilege('anon', format('public.%I', tbl), 'DELETE')
       or not has_table_privilege('authenticated', format('public.%I', tbl), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', tbl), 'INSERT')
       or has_table_privilege('authenticated', format('public.%I', tbl), 'UPDATE')
       or has_table_privilege('authenticated', format('public.%I', tbl), 'DELETE')
       or not has_table_privilege('service_role', format('public.%I', tbl), 'SELECT')
       or has_table_privilege('service_role', format('public.%I', tbl), 'INSERT')
       or has_table_privilege('service_role', format('public.%I', tbl), 'UPDATE')
       or has_table_privilege('service_role', format('public.%I', tbl), 'DELETE') then
      raise exception 'FAIL: progression grants on %', tbl;
    end if;
  end loop;

  select p.prosecdef, p.proconfig, p.prosrc
    into fn_definer, fn_config, fn_src
  from pg_proc p
  where p.oid = fn::regprocedure;
  if fn_definer is not true
     or fn_config is distinct from array['search_path=pg_catalog, public']
     or pg_get_function_result(fn::regprocedure) is distinct from 'jsonb'
     or has_function_privilege('anon', fn, 'EXECUTE')
     or has_function_privilege('authenticated', fn, 'EXECUTE')
     or not has_function_privilege('service_role', fn, 'EXECUTE')
     or position('on conflict' in lower(fn_src)) = 0
     or position('update public.redemptions' in lower(fn_src)) > 0
     or position('user_badges' in lower(fn_src)) > 0
     or position('now()' in lower(fn_src)) > 0 then
    raise exception 'FAIL: record_verified_visit_progress shape';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('verify_redemption', 'verify_redemption_and_settle')
      and p.prosrc ilike '%progression%'
  ) then
    raise exception 'FAIL: verify RPC references progression';
  end if;

  if exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.redemptions'::regclass
      and not t.tgisinternal
  ) then
    raise exception 'FAIL: redemptions trigger exists';
  end if;

  select string_agg(column_name, ',' order by column_name)
    into redemption_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'redemptions';
  if redemption_cols is distinct from
     'base_discount_cents,below_minimum,boost_discount_cents,boost_id,challenge_item_id,code_iv,created_at,eligible_subtotal_cents,encrypted_code,expires_at,id,locked_boost_id,quote_expires_at,quote_id,quote_version,restaurant_id,sealed_discount_amount_cents,sealed_min_spend_cents,settled_at,settlement_kind,status,tier_id,token_hash,total_discount_cents,user_id,verified_at' then
    raise exception 'FAIL: redemptions columns changed: %', redemption_cols;
  end if;

  select string_agg(column_name, ',' order by column_name)
    into badge_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'user_badges';
  if badge_cols is distinct from 'awarded_at,badge_id,user_id' then
    raise exception 'FAIL: user_badges columns changed: %', badge_cols;
  end if;

  if (select count(*) from pg_constraint
      where contype = 'f'
        and conrelid in (
          'public.progression_events'::regclass,
          'public.progression_milestones'::regclass,
          'public.progression_drawing_entries'::regclass
        )) <> 5 then
    raise exception 'FAIL: progression foreign key count';
  end if;

  select string_agg(c.conrelid::regclass::text || '.' || a.attname, ', ' order by c.conrelid::regclass::text, a.attname)
    into missing
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid
   and a.attnum = c.conkey[1]
  where c.contype = 'f'
    and c.conrelid in (
      'public.progression_events'::regclass,
      'public.progression_milestones'::regclass,
      'public.progression_drawing_entries'::regclass
    )
    and not exists (
      select 1
      from pg_index i
      where i.indrelid = c.conrelid
        and i.indisvalid
        and i.indisready
        and (string_to_array(i.indkey::text, ' '))[1]::integer = c.conkey[1]
    );
  if missing is not null then
    raise exception 'FAIL: progression foreign key covering index missing for %', missing;
  end if;

  if (select count(*) from public.progression_events)
     + (select count(*) from public.progression_milestones)
     + (select count(*) from public.progression_drawing_entries) <> 0 then
    raise exception 'FAIL: progression tables were not empty';
  end if;

  insert into auth.users (id) values (member_a), (member_b), (member_c), (member_e);
  insert into public.user_profiles (id, is_admin, role) values
    (member_a, false, 'subscriber'),
    (member_b, false, 'subscriber'),
    (member_c, false, 'subscriber'),
    (member_e, false, 'subscriber');
  insert into public.restaurants (id, name, status) values
    (grill, 'E09 A2 Grill', 'active');

  insert into public.redemptions (
    id, user_id, restaurant_id, token_hash, status, verified_at, expires_at
  ) values
    (late_a, member_a, grill, md5(late_a::text) || md5('e09a2' || late_a::text), 'verified', q4_at, q4_at + interval '35 days'),
    (early_a, member_a, grill, md5(early_a::text) || md5('e09a2' || early_a::text), 'verified', june1, june1 + interval '35 days'),
    (mid_a, member_a, grill, md5(mid_a::text) || md5('e09a2' || mid_a::text), 'verified', june2, june2 + interval '35 days'),
    (early_b, member_b, grill, md5(early_b::text) || md5('e09a2' || early_b::text), 'verified', june1, june1 + interval '35 days'),
    (mid_b, member_b, grill, md5(mid_b::text) || md5('e09a2' || mid_b::text), 'verified', june2, june2 + interval '35 days'),
    (late_b, member_b, grill, md5(late_b::text) || md5('e09a2' || late_b::text), 'verified', q1_at, q1_at + interval '35 days'),
    (late_e, member_e, grill, md5(late_e::text) || md5('e09a2' || late_e::text), 'verified', q4_at, q4_at + interval '35 days'),
    (early_e, member_e, grill, md5(early_e::text) || md5('e09a2' || early_e::text), 'verified', june1, june1 + interval '35 days'),
    (mid_e, member_e, grill, md5(mid_e::text) || md5('e09a2' || mid_e::text), 'verified', june2, june2 + interval '35 days'),
    (issued_id, member_a, grill, md5(issued_id::text) || md5('e09a2' || issued_id::text), 'issued', null, now() + interval '35 days'),
    (expired_id, member_a, grill, md5(expired_id::text) || md5('e09a2' || expired_id::text), 'expired', null, now() + interval '35 days'),
    (null_time_id, member_a, grill, md5(null_time_id::text) || md5('e09a2' || null_time_id::text), 'verified', null, now() + interval '35 days');

  select count(*) into redemptions_before from public.redemptions;
  select count(*) into badges_before from public.user_badges;

  -- Missed middle visit recorded last. The crossing visit is the December
  -- event already stored, not the visit this call just recorded, and not now().
  if public.record_verified_visit_progress(early_a)->'milestones' <> '[]'::jsonb
     or public.record_verified_visit_progress(late_a)->'milestones' <> '[]'::jsonb then
    raise exception 'FAIL: milestone before the third visit';
  end if;
  result := public.record_verified_visit_progress(mid_a);
  if jsonb_array_length(result->'events') <> 1
     or jsonb_array_length(result->'milestones') <> 1
     or jsonb_array_length(result->'entries') <> 1
     or result->'milestones'->0->>'milestone_key' is distinct from 'v1:level:1'
     or (result->'milestones'->0->>'reached_at')::timestamptz is distinct from q4_at
     or result->'milestones'->0->>'quarter_key' is distinct from '2026-Q4'
     or (result->'milestones'->0->>'level')::integer <> 1
     or (result->'events'->0->>'xp')::integer <> 100
     or result->'events'->0->>'source_kind' is distinct from 'verified_visit'
     or result->'events'->0->>'schedule_version' is distinct from 'v1'
     or (result->'events'->0->>'occurred_at')::timestamptz is distinct from june2 then
    raise exception 'FAIL: out-of-order level 1 %', result;
  end if;
  if (select e.source_id
      from public.progression_milestones m
      join public.progression_events e on e.id = m.source_event_id
      where m.user_id = member_a and m.milestone_key = 'v1:level:1') is distinct from late_a
     or (select reached_at from public.progression_milestones
         where user_id = member_a and milestone_key = 'v1:level:1') is distinct from q4_at
     or (select d.quarter_key from public.progression_drawing_entries d
         join public.progression_milestones m on m.id = d.milestone_id
         where m.user_id = member_a) is distinct from '2026-Q4' then
    raise exception 'FAIL: crossing visit was not the December event';
  end if;

  select count(*) into events_before from public.progression_events where user_id = member_a;
  select count(*) into milestones_before from public.progression_milestones where user_id = member_a;
  select count(*) into entries_before from public.progression_drawing_entries where user_id = member_a;
  replay := public.record_verified_visit_progress(mid_a);
  if replay->'events' <> '[]'::jsonb
     or replay->'milestones' <> '[]'::jsonb
     or replay->'entries' <> '[]'::jsonb
     or (select count(*) from public.progression_events where user_id = member_a) <> events_before
     or (select count(*) from public.progression_milestones where user_id = member_a) <> milestones_before
     or (select count(*) from public.progression_drawing_entries where user_id = member_a) <> entries_before then
    raise exception 'FAIL: second call changed member A';
  end if;

  -- Same three instants, recorded late first. The milestone still uses the
  -- December event time.
  if public.record_verified_visit_progress(late_e)->'milestones' <> '[]'::jsonb
     or public.record_verified_visit_progress(early_e)->'milestones' <> '[]'::jsonb then
    raise exception 'FAIL: member E milestone before the third visit';
  end if;
  result := public.record_verified_visit_progress(mid_e);
  if (result->'milestones'->0->>'reached_at')::timestamptz is distinct from q4_at
     or result->'milestones'->0->>'quarter_key' is distinct from '2026-Q4'
     or (select e.source_id
         from public.progression_milestones m
         join public.progression_events e on e.id = m.source_event_id
         where m.user_id = member_e) is distinct from late_e then
    raise exception 'FAIL: call order changed the crossing visit %', result;
  end if;
  replay := public.record_verified_visit_progress(late_e);
  if replay->'events' <> '[]'::jsonb
     or (select count(*) from public.progression_events where user_id = member_e) <> 3
     or (select count(*) from public.progression_milestones where user_id = member_e) <> 1
     or (select count(*) from public.progression_drawing_entries where user_id = member_e) <> 1 then
    raise exception 'FAIL: member E replay';
  end if;

  -- The visit that crosses 300 XP is recorded later. Quarter follows that
  -- visit's Chicago time: 2027-01-01 00:30 is 2027-Q1.
  if public.record_verified_visit_progress(early_b)->'milestones' <> '[]'::jsonb
     or public.record_verified_visit_progress(mid_b)->'milestones' <> '[]'::jsonb
     or (select count(*) from public.progression_milestones where user_id = member_b) <> 0 then
    raise exception 'FAIL: member B milestone before the crossing visit';
  end if;
  result := public.record_verified_visit_progress(late_b);
  if jsonb_array_length(result->'milestones') <> 1
     or (result->'milestones'->0->>'reached_at')::timestamptz is distinct from q1_at
     or result->'milestones'->0->>'quarter_key' is distinct from '2027-Q1'
     or result->'entries'->0->>'quarter_key' is distinct from '2027-Q1'
     or result->'entries'->0->>'entry_source' is distinct from 'level_milestone' then
    raise exception 'FAIL: 2027-Q1 crossing %', result;
  end if;
  replay := public.record_verified_visit_progress(late_b);
  if replay is null
     or replay->'events' <> '[]'::jsonb
     or replay->'milestones' <> '[]'::jsonb
     or replay->'entries' <> '[]'::jsonb
     or (select count(*) from public.progression_events where user_id = member_b) <> 3
     or (select count(*) from public.progression_milestones where user_id = member_b) <> 1 then
    raise exception 'FAIL: member B replay %', replay;
  end if;

  crossing := array[]::uuid[];
  for i in 1..35 loop
    visit_id := gen_random_uuid();
    visit_at := visit_base + ((i - 1) * interval '1 day');
    last_id := visit_id;
    if i in (3, 10, 15, 25, 35) then
      crossing := crossing || visit_id;
    end if;
    insert into public.redemptions (
      id, user_id, restaurant_id, token_hash, status, verified_at, expires_at
    ) values (
      visit_id,
      member_c,
      grill,
      md5(visit_id::text) || md5('e09a2' || visit_id::text),
      'verified',
      visit_at,
      visit_at + interval '35 days'
    );
    result := public.record_verified_visit_progress(visit_id);
    level_n := case i
      when 3 then 1
      when 10 then 2
      when 15 then 3
      when 25 then 4
      when 35 then 5
      else 0
    end;
    if jsonb_array_length(result->'events') <> 1
       or (result->'events'->0->>'xp')::integer <> 100
       or (result->'events'->0->>'occurred_at')::timestamptz is distinct from visit_at then
      raise exception 'FAIL: visit % event %', i, result;
    end if;
    if level_n = 0 then
      if result->'milestones' <> '[]'::jsonb or result->'entries' <> '[]'::jsonb then
        raise exception 'FAIL: visit % created a milestone %', i, result;
      end if;
    elsif jsonb_array_length(result->'milestones') <> 1
          or jsonb_array_length(result->'entries') <> 1
          or (result->'milestones'->0->>'level')::integer <> level_n
          or result->'milestones'->0->>'milestone_key' is distinct from 'v1:level:' || level_n::text
          or (result->'milestones'->0->>'reached_at')::timestamptz is distinct from visit_at
          or result->'milestones'->0->>'quarter_key' is distinct from '2026-Q1' then
      raise exception 'FAIL: visit % milestone %', i, result;
    end if;
  end loop;

  if (select count(*) from public.progression_events where user_id = member_c) <> 35
     or (select count(*) from public.progression_milestones where user_id = member_c) <> 5
     or (select count(*) from public.progression_drawing_entries where user_id = member_c) <> 5
     or (select max(level) from public.progression_milestones where user_id = member_c) <> 5
     or exists (
       select 1 from public.progression_milestones
       where user_id = member_c and level = 6
     )
     or (select array_agg(e.source_id order by m.level)
         from public.progression_milestones m
         join public.progression_events e on e.id = m.source_event_id
         where m.user_id = member_c) is distinct from crossing
     or (select reached_at from public.progression_milestones
         where user_id = member_c and milestone_key = 'v1:level:5')
        is distinct from visit_base + interval '34 days' then
    raise exception 'FAIL: 35 visits did not stop at level 5';
  end if;

  select count(*) into events_before from public.progression_events where user_id = member_c;
  select count(*) into milestones_before from public.progression_milestones where user_id = member_c;
  select count(*) into entries_before from public.progression_drawing_entries where user_id = member_c;
  replay := public.record_verified_visit_progress(last_id);
  if replay->'events' <> '[]'::jsonb
     or replay->'milestones' <> '[]'::jsonb
     or replay->'entries' <> '[]'::jsonb
     or (select count(*) from public.progression_events where user_id = member_c) <> events_before
     or (select count(*) from public.progression_milestones where user_id = member_c) <> milestones_before
     or (select count(*) from public.progression_drawing_entries where user_id = member_c) <> entries_before then
    raise exception 'FAIL: 35th visit replay changed counts';
  end if;

  if public.record_verified_visit_progress(issued_id) is not null
     or public.record_verified_visit_progress(expired_id) is not null
     or public.record_verified_visit_progress(null_time_id) is not null
     or public.record_verified_visit_progress(unknown_id) is not null
     or public.record_verified_visit_progress(null) is not null then
    raise exception 'FAIL: unverified redemption returned a row';
  end if;
  if exists (
    select 1 from public.progression_events
    where source_id in (issued_id, expired_id, null_time_id, unknown_id)
  ) or (select status from public.redemptions where id = issued_id) is distinct from 'issued'
    or (select verified_at from public.redemptions where id = issued_id) is not null
    or (select status from public.redemptions where id = null_time_id) is distinct from 'verified'
    or (select verified_at from public.redemptions where id = late_a) is distinct from q4_at then
    raise exception 'FAIL: unverified call wrote a ledger row or changed a redemption';
  end if;

  if (select count(*) from public.redemptions) <> redemptions_before + 35
     or (select count(*) from public.user_badges) <> badges_before then
    raise exception 'FAIL: ledger call minted a redemption or a badge';
  end if;

  if exists (
    select 1
    from public.progression_drawing_entries d
    join public.progression_milestones m on m.id = d.milestone_id
    where d.user_id is distinct from m.user_id
       or d.quarter_key is distinct from m.quarter_key
       or d.entry_source is distinct from 'level_milestone'
  ) then
    raise exception 'FAIL: drawing entry drifted from its milestone';
  end if;
end;
$$;

-- service_role may execute. A replay still inserts nothing.
set local role service_role;
do $$
declare
  replay jsonb;
  events_before integer;
begin
  select count(*) into events_before from public.progression_events;
  replay := public.record_verified_visit_progress('e09a2000-0000-4000-8000-000000000113');
  if replay->'events' <> '[]'::jsonb
     or (select count(*) from public.progression_events) <> events_before then
    raise exception 'FAIL: service_role replay wrote a row';
  end if;
  if public.record_verified_visit_progress('e09a2000-0000-4000-8000-000000000131') is not null then
    raise exception 'FAIL: service_role recorded an issued redemption';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', 'e09a2000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
begin
  if auth.uid() is distinct from 'e09a2000-0000-4000-8000-000000000001'::uuid then
    raise exception 'FAIL: auth.uid() was %', auth.uid();
  end if;
  if (select count(*) from public.progression_events) <> 3
     or (select count(*) from public.progression_milestones) <> 1
     or (select count(*) from public.progression_drawing_entries) <> 1
     or exists (
       select 1 from public.progression_events
       where user_id is distinct from auth.uid()
     )
     or exists (
       select 1 from public.progression_milestones
       where user_id is distinct from auth.uid()
     )
     or exists (
       select 1 from public.progression_drawing_entries
       where user_id is distinct from auth.uid()
     ) then
    raise exception 'FAIL: member A read another member';
  end if;

  begin
    insert into public.progression_events (
      user_id, source_kind, source_id, occurred_at, xp, schedule_version
    ) values (
      auth.uid(), 'verified_visit', gen_random_uuid(), now(), 100, 'v1'
    );
    raise exception 'FAIL: member insert succeeded';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    update public.progression_events set xp = 100;
    raise exception 'FAIL: member update succeeded';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    delete from public.progression_milestones;
    raise exception 'FAIL: member delete succeeded';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    perform public.record_verified_visit_progress('e09a2000-0000-4000-8000-000000000101');
    raise exception 'FAIL: authenticated executed the function';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', 'e09a2000-0000-4000-8000-000000000002', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.progression_events) <> 3
     or (select count(*) from public.progression_milestones) <> 1
     or (select quarter_key from public.progression_milestones) is distinct from '2027-Q1'
     or exists (
       select 1 from public.progression_events
       where user_id is distinct from 'e09a2000-0000-4000-8000-000000000002'::uuid
     ) then
    raise exception 'FAIL: member B read another member';
  end if;
end;
$$;

reset role;
set local role anon;
do $$
begin
  begin
    perform count(*) from public.progression_events;
    raise exception 'FAIL: anon read events';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    perform count(*) from public.progression_milestones;
    raise exception 'FAIL: anon read milestones';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    perform count(*) from public.progression_drawing_entries;
    raise exception 'FAIL: anon read entries';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    perform public.record_verified_visit_progress('e09a2000-0000-4000-8000-000000000101');
    raise exception 'FAIL: anon executed the function';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

reset role;
do $$
begin
  if (select count(*) from public.progression_events) <> 44
     or (select count(*) from public.progression_milestones) <> 8
     or (select count(*) from public.progression_drawing_entries) <> 8 then
    raise exception 'FAIL: role checks changed ledger counts';
  end if;
end;
$$;

rollback;
