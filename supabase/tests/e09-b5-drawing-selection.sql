-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E09-B5: one simulated draw for a closed sample campaign, reproducible
-- from the stored seed, and rejected otherwise.
begin;
set local statement_timeout = '15s';

create temp table b5_service (id uuid);

create function pg_temp.drawing_payload(
  p_quarter text,
  p_mode text,
  p_total bigint,
  p_prizes jsonb
) returns jsonb
language plpgsql
as $$
declare
  year integer;
  quarter integer;
  start_month integer;
  end_year integer;
  end_month integer;
begin
  year := substring(p_quarter, 1, 4)::integer;
  quarter := substring(p_quarter, 7, 1)::integer;
  start_month := (quarter - 1) * 3 + 1;
  if quarter = 4 then
    end_year := year + 1;
    end_month := 1;
  else
    end_year := year;
    end_month := start_month + 3;
  end if;
  return jsonb_build_object(
    'quarter_key', p_quarter,
    'mode', p_mode,
    'rules_version', 'v0',
    'total_budget_cents', p_total,
    'fulfillment_allowance_cents', 0,
    'eligible_entry_sources', to_jsonb(array['level_milestone']::text[]),
    'starts_at', make_timestamptz(year, start_month, 1, 0, 0, 0, 'America/Chicago'),
    'ends_at', make_timestamptz(end_year, end_month, 1, 0, 0, 0, 'America/Chicago'),
    'prizes', p_prizes
  );
end;
$$;

create function pg_temp.prize(p_label text, p_quantity bigint, p_unit bigint)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'label', p_label,
    'quantity', p_quantity,
    'unit_value_cents', p_unit,
    'is_sample', true
  );
$$;

create function pg_temp.close_sample(
  p_quarter text,
  p_total bigint,
  p_prizes jsonb,
  p_closed timestamptz
) returns uuid
language plpgsql
as $$
declare
  saved jsonb;
  campaign_id uuid;
begin
  saved := public.save_drawing_campaign(pg_temp.drawing_payload(p_quarter, 'sample', p_total, p_prizes));
  campaign_id := (saved->>'id')::uuid;
  perform public.transition_drawing_campaign(campaign_id, 'active');
  perform public.transition_drawing_campaign(campaign_id, 'closed');
  if p_closed is not null then
    -- The RPC stamps closed_at with now(). Seeded 2027 entries need a close
    -- inside that quarter. The lifecycle lock allows this column to move
    -- only while wanderbite.drawing_campaign_transition names the campaign,
    -- which is the same session flag the transition function sets. This
    -- test adjustment is not a product path.
    perform set_config('wanderbite.drawing_campaign_transition', campaign_id::text, true);
    update public.drawing_campaigns set closed_at = p_closed where id = campaign_id;
  end if;
  return campaign_id;
end;
$$;

create function pg_temp.seed_entry(
  p_user uuid,
  p_level integer,
  p_quarter text,
  p_reached timestamptz,
  p_entry uuid
) returns void
language plpgsql
as $$
declare
  event_id uuid := gen_random_uuid();
  milestone_id uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (p_user) on conflict do nothing;
  insert into public.user_profiles (id, is_admin, role)
  values (p_user, false, 'subscriber')
  on conflict do nothing;
  insert into public.progression_events (
    id, user_id, source_kind, source_id, occurred_at, xp, schedule_version
  ) values (
    event_id, p_user, 'verified_visit', gen_random_uuid(), p_reached, 100, 'v1'
  );
  insert into public.progression_milestones (
    id, user_id, schedule_version, level, milestone_key, reached_at, quarter_key, source_event_id
  ) values (
    milestone_id, p_user, 'v1', p_level, 'v1:level:' || p_level::text,
    p_reached, p_quarter, event_id
  );
  insert into public.progression_drawing_entries (
    id, user_id, milestone_id, quarter_key, entry_source
  ) values (
    p_entry, p_user, milestone_id, p_quarter, 'level_milestone'
  );
end;
$$;

create function pg_temp.selection_error(p_campaign uuid, p_run_by text, p_seed text)
returns text
language plpgsql
as $$
begin
  perform public.select_drawing_winners(p_campaign, p_run_by, p_seed);
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;

do $$
declare
  seed text := '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  closed_at timestamptz := '2027-03-20 18:00:00+00';
  main_id uuid;
  boundary_id uuid;
  unfilled_id uuid;
  extra_id uuid;
  empty_id uuid;
  draft_id uuid;
  active_id uuid;
  direct_id uuid;
  live_id uuid;
  live_closed_id uuid;
  direct_rpc_id uuid;
  source_id uuid;
  service_id uuid;
  result jsonb;
  prize_a uuid;
  prize_b uuid;
  badges_before bigint;
  events_before bigint;
  fn_definer boolean;
  fn_config text[];
  winner_users uuid[];
  winner_entries uuid[];
begin
  if now() >= '2027-04-01 05:00:00+00'::timestamptz then
    raise exception 'FAIL: clock is at or after the 2027-Q1 end';
  end if;

  select p.prosecdef, p.proconfig
    into fn_definer, fn_config
  from pg_proc p
  where p.oid = 'public.select_drawing_winners(uuid, text, text)'::regprocedure;
  if fn_definer is not true
     or fn_config is distinct from array['search_path=pg_catalog, public'] then
    raise exception 'FAIL: select_drawing_winners must be security definer with a pinned search_path';
  end if;

  if has_function_privilege('anon', 'public.select_drawing_winners(uuid, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.select_drawing_winners(uuid, text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.select_drawing_winners(uuid, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.drawing_selections_guard()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.drawing_selections_guard()', 'EXECUTE') then
    raise exception 'FAIL: selection function grants';
  end if;

  if has_table_privilege('anon', 'public.drawing_selections', 'SELECT')
     or has_table_privilege('anon', 'public.drawing_selections', 'INSERT')
     or has_table_privilege('anon', 'public.drawing_selections', 'UPDATE')
     or has_table_privilege('anon', 'public.drawing_selections', 'DELETE')
     or has_table_privilege('authenticated', 'public.drawing_selections', 'SELECT')
     or has_table_privilege('authenticated', 'public.drawing_selection_winners', 'INSERT')
     or has_table_privilege('authenticated', 'public.drawing_selection_winners', 'UPDATE')
     or has_table_privilege('authenticated', 'public.drawing_selection_winners', 'DELETE')
     or not has_table_privilege('service_role', 'public.drawing_selections', 'SELECT')
     or not has_table_privilege('service_role', 'public.drawing_selection_winners', 'SELECT')
     or has_table_privilege('service_role', 'public.drawing_selections', 'INSERT')
     or has_table_privilege('service_role', 'public.drawing_selections', 'UPDATE')
     or has_table_privilege('service_role', 'public.drawing_selections', 'DELETE')
     or has_table_privilege('service_role', 'public.drawing_selection_winners', 'INSERT')
     or has_table_privilege('service_role', 'public.drawing_selection_winners', 'UPDATE')
     or has_table_privilege('service_role', 'public.drawing_selection_winners', 'DELETE') then
    raise exception 'FAIL: selection table grants';
  end if;

  if (select count(*) from pg_policies
      where schemaname = 'public'
        and tablename in ('drawing_selections', 'drawing_selection_winners')) <> 0 then
    raise exception 'FAIL: selection tables must not have policies';
  end if;

  if (select relrowsecurity from pg_class where oid = 'public.drawing_selections'::regclass) is not true
     or (select relrowsecurity from pg_class where oid = 'public.drawing_selection_winners'::regclass) is not true then
    raise exception 'FAIL: selection RLS';
  end if;

  if encode(
       extensions.digest(seed || 'a1000000-0000-4000-8000-000000000001', 'sha256'),
       'hex'
     ) is distinct from '92b859efd3efd3fd18788e57e3105d18cc64c7bda83f8d22aee070558d67be4a' then
    raise exception 'FAIL: sha256(seed || entry id) does not match the TypeScript vector';
  end if;

  main_id := pg_temp.close_sample(
    '2027-Q1',
    3000,
    jsonb_build_array(
      pg_temp.prize('Sample prize: First', 2, 1000),
      pg_temp.prize('Sample prize: Second', 1, 1000)
    ),
    closed_at
  );
  select id into prize_a
  from public.drawing_campaign_prizes
  where campaign_id = main_id
  order by position, id
  limit 1;
  select id into prize_b
  from public.drawing_campaign_prizes
  where campaign_id = main_id
  order by position desc, id desc
  limit 1;

  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000001', 1, '2027-Q1', '2027-02-01 00:00:00+00', 'a1000000-0000-4000-8000-000000000001');
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000002', 1, '2027-Q1', '2027-02-02 00:00:00+00', 'a1000000-0000-4000-8000-000000000002');
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000003', 1, '2027-Q1', '2027-02-03 00:00:00+00', 'a1000000-0000-4000-8000-000000000003');
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000004', 1, '2027-Q1', '2027-02-04 00:00:00+00', 'a1000000-0000-4000-8000-000000000004');
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000005', 1, '2027-Q1', '2027-03-20 17:59:59.999+00', 'a1000000-0000-4000-8000-000000000005');
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000011', 1, '2026-Q4', '2027-01-01 05:30:00+00', 'a1000000-0000-4000-8000-000000000011');
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000012', 1, '2027-Q1', closed_at, 'a1000000-0000-4000-8000-000000000012');
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000013', 1, '2027-Q1', closed_at + interval '1 millisecond', 'a1000000-0000-4000-8000-000000000013');
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000014', 1, '2027-Q2', '2027-02-01 00:00:00+00', 'a1000000-0000-4000-8000-000000000014');

  if pg_temp.selection_error(main_id, '   ', null) is distinct from 'P0001 invalid_run_by'
     or pg_temp.selection_error(main_id, 'ops', 'abcd') is distinct from 'P0001 invalid_seed'
     or (select count(*) from public.drawing_selections where campaign_id = main_id) <> 0 then
    raise exception 'FAIL: blank run_by or bad seed wrote a row';
  end if;

  select count(*) into badges_before from public.user_badges;
  select count(*) into events_before from public.progression_events;

  result := public.select_drawing_winners(main_id, '  ops  ', seed);
  if result->'selection'->>'campaign_id' is distinct from main_id::text
     or result->'selection'->>'algorithm_version' is distinct from 'v1-sha256-rank'
     or result->'selection'->>'seed' is distinct from seed
     or (result->'selection'->>'eligible_entry_count')::integer <> 5
     or (result->'selection'->>'eligible_member_count')::integer <> 5
     or (result->'selection'->>'prize_unit_count')::integer <> 3
     or (result->'selection'->>'unfilled_unit_count')::integer <> 0
     or (result->'selection'->>'simulated')::boolean is not true
     or result->'selection'->>'run_by' is distinct from 'ops'
     or jsonb_array_length(result->'winners') <> 3 then
    raise exception 'FAIL: selection shape %', result;
  end if;

  select array_agg(entry_id order by rank), array_agg(user_id order by rank)
    into winner_entries, winner_users
  from public.drawing_selection_winners
  where campaign_id = main_id;

  if winner_entries is distinct from array[
       'a1000000-0000-4000-8000-000000000002',
       'a1000000-0000-4000-8000-000000000003',
       'a1000000-0000-4000-8000-000000000004'
     ]::uuid[]
     or winner_users is distinct from array[
       'b1000000-0000-4000-8000-000000000002',
       'b1000000-0000-4000-8000-000000000003',
       'b1000000-0000-4000-8000-000000000004'
     ]::uuid[]
     or (select count(distinct user_id) from public.drawing_selection_winners where campaign_id = main_id) <> 3
     or (select prize_id from public.drawing_selection_winners where campaign_id = main_id and rank = 1) is distinct from prize_a
     or (select unit_index from public.drawing_selection_winners where campaign_id = main_id and rank = 1) <> 1
     or (select prize_id from public.drawing_selection_winners where campaign_id = main_id and rank = 2) is distinct from prize_a
     or (select unit_index from public.drawing_selection_winners where campaign_id = main_id and rank = 2) <> 2
     or (select prize_id from public.drawing_selection_winners where campaign_id = main_id and rank = 3) is distinct from prize_b
     or (select unit_index from public.drawing_selection_winners where campaign_id = main_id and rank = 3) <> 1 then
    raise exception 'FAIL: winner assignment %', winner_entries;
  end if;

  if exists (
    select 1 from public.drawing_selection_winners
    where entry_id in (
      'a1000000-0000-4000-8000-000000000011',
      'a1000000-0000-4000-8000-000000000012',
      'a1000000-0000-4000-8000-000000000013',
      'a1000000-0000-4000-8000-000000000014'
    )
  ) then
    raise exception 'FAIL: an ineligible entry was selected';
  end if;

  if pg_temp.selection_error(main_id, 'ops', null) is distinct from 'P0001 already_selected'
     or pg_temp.selection_error(main_id, 'other', 'ffff') is distinct from 'P0001 already_selected'
     or (select count(*) from public.drawing_selections) <> 1
     or (select count(*) from public.drawing_selection_winners) <> 3
     or (select run_by from public.drawing_selections where campaign_id = main_id) is distinct from 'ops' then
    raise exception 'FAIL: a second draw changed the audit';
  end if;

  if (select count(*) from public.user_badges) <> badges_before
     or (select count(*) from public.progression_events) <> events_before then
    raise exception 'FAIL: selection wrote progression or badge rows';
  end if;

  begin
    insert into public.drawing_selections (
      campaign_id, algorithm_version, seed, eligible_entry_count, eligible_member_count,
      prize_unit_count, unfilled_unit_count, simulated, run_by
    ) values (
      main_id, 'v1-sha256-rank', seed, 1, 1, 1, 0, true, 'direct'
    );
    raise exception 'FAIL: direct selection insert';
  exception when others then
    if sqlerrm is distinct from 'selection_immutable' or sqlstate is distinct from 'P0001' then
      raise exception 'FAIL: direct selection insert got % %', sqlstate, sqlerrm;
    end if;
  end;
  begin
    update public.drawing_selections set run_by = 'changed' where campaign_id = main_id;
    raise exception 'FAIL: selection update';
  exception when others then
    if sqlerrm is distinct from 'selection_immutable' then
      raise exception 'FAIL: selection update got % %', sqlstate, sqlerrm;
    end if;
  end;
  begin
    delete from public.drawing_selection_winners where campaign_id = main_id;
    raise exception 'FAIL: winner delete';
  exception when others then
    if sqlerrm is distinct from 'selection_immutable' then
      raise exception 'FAIL: winner delete got % %', sqlstate, sqlerrm;
    end if;
  end;
  begin
    insert into public.drawing_selection_winners (
      selection_id, campaign_id, prize_id, unit_index, entry_id, user_id, rank
    ) values (
      (result->'selection'->>'id')::uuid, main_id, prize_b, 2,
      'a1000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000001',
      9
    );
    raise exception 'FAIL: direct winner insert';
  exception when others then
    if sqlerrm is distinct from 'selection_immutable' then
      raise exception 'FAIL: direct winner insert got % %', sqlstate, sqlerrm;
    end if;
  end;

  if (select run_by from public.drawing_selections where campaign_id = main_id) is distinct from 'ops'
     or (select count(*) from public.drawing_selection_winners where campaign_id = main_id) <> 3 then
    raise exception 'FAIL: a rejected write changed the audit';
  end if;

  -- Deleting the member cascades the entry and leaves the winner row.
  delete from public.user_profiles where id = 'b1000000-0000-4000-8000-000000000002';
  if (select count(*) from public.progression_drawing_entries where id = 'a1000000-0000-4000-8000-000000000002') <> 0
     or (select count(*) from public.drawing_selection_winners
         where entry_id = 'a1000000-0000-4000-8000-000000000002'
           and user_id = 'b1000000-0000-4000-8000-000000000002') <> 1 then
    raise exception 'FAIL: deleted member did not keep the winner snapshot';
  end if;

  boundary_id := pg_temp.close_sample(
    '2030-Q1', 1000, jsonb_build_array(pg_temp.prize('Sample prize: One', 1, 1000)),
    '2027-03-15 18:00:00+00'
  );
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000021', 1, '2030-Q1', '2027-03-15 17:59:59.999+00', 'a1000000-0000-4000-8000-000000000021');
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000022', 1, '2030-Q1', '2027-03-15 18:00:00+00', 'a1000000-0000-4000-8000-000000000022');
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000023', 1, '2030-Q1', '2027-03-15 18:00:00.001+00', 'a1000000-0000-4000-8000-000000000023');
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000024', 1, '2026-Q4', '2027-01-01 05:30:00+00', 'a1000000-0000-4000-8000-000000000024');
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000025', 1, '2030-Q1', '2027-01-01 06:00:00+00', 'a1000000-0000-4000-8000-000000000025');
  result := public.select_drawing_winners(boundary_id, 'ops', seed);
  if (result->'selection'->>'eligible_entry_count')::integer <> 2
     or (result->'selection'->>'eligible_member_count')::integer <> 2
     or exists (
       select 1 from public.drawing_selection_winners
       where campaign_id = boundary_id
         and entry_id in (
           'a1000000-0000-4000-8000-000000000022',
           'a1000000-0000-4000-8000-000000000023',
           'a1000000-0000-4000-8000-000000000024'
         )
     ) then
    raise exception 'FAIL: boundary eligibility %', result;
  end if;

  unfilled_id := pg_temp.close_sample(
    '2032-Q1', 4000, jsonb_build_array(pg_temp.prize('Sample prize: Wide', 4, 1000)),
    null
  );
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000031', 1, '2032-Q1', '2026-01-01 00:00:00+00', 'a1000000-0000-4000-8000-000000000031');
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000032', 1, '2032-Q1', '2026-01-02 00:00:00+00', 'a1000000-0000-4000-8000-000000000032');
  result := public.select_drawing_winners(unfilled_id, 'ops', seed);
  if (result->'selection'->>'eligible_member_count')::integer <> 2
     or (result->'selection'->>'prize_unit_count')::integer <> 4
     or (result->'selection'->>'unfilled_unit_count')::integer <> 2
     or jsonb_array_length(result->'winners') <> 2
     or (select count(distinct user_id) from public.drawing_selection_winners where campaign_id = unfilled_id) <> 2 then
    raise exception 'FAIL: unfilled units %', result;
  end if;

  extra_id := pg_temp.close_sample(
    '2033-Q1', 2000, jsonb_build_array(pg_temp.prize('Sample prize: Pair', 2, 1000)),
    null
  );
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000041', 1, '2033-Q1', '2026-01-01 00:00:00+00', 'd1000000-0000-4000-8000-000000000001');
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000041', 2, '2033-Q1', '2026-01-03 00:00:00+00', 'e1000000-0000-4000-8000-000000000001');
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000042', 1, '2033-Q1', '2026-01-02 00:00:00+00', 'd1000000-0000-4000-8000-000000000002');
  result := public.select_drawing_winners(extra_id, 'ops', seed);
  if (select entry_id from public.drawing_selection_winners where campaign_id = extra_id and rank = 1)
       is distinct from 'e1000000-0000-4000-8000-000000000001'::uuid
     or (select user_id from public.drawing_selection_winners where campaign_id = extra_id and rank = 1)
       is distinct from 'b1000000-0000-4000-8000-000000000041'::uuid
     or (select entry_id from public.drawing_selection_winners where campaign_id = extra_id and rank = 2)
       is distinct from 'd1000000-0000-4000-8000-000000000002'::uuid
     or exists (
       select 1 from public.drawing_selection_winners
       where campaign_id = extra_id
         and entry_id = 'd1000000-0000-4000-8000-000000000001'
     )
     or (select count(*) from public.drawing_selection_winners
         where campaign_id = extra_id
           and user_id = 'b1000000-0000-4000-8000-000000000041') <> 1 then
    raise exception 'FAIL: extra entry still awarded a second prize %', result;
  end if;

  empty_id := pg_temp.close_sample(
    '2034-Q1', 1000, jsonb_build_array(pg_temp.prize('Sample prize: Empty', 1, 1000)),
    null
  );
  if pg_temp.selection_error(empty_id, 'ops', seed) is distinct from 'P0001 no_eligible_entries'
     or exists (select 1 from public.drawing_selections where campaign_id = empty_id) then
    raise exception 'FAIL: empty draw wrote a row';
  end if;

  draft_id := (public.save_drawing_campaign(pg_temp.drawing_payload(
    '2028-Q1', 'sample', 1000, jsonb_build_array(pg_temp.prize('Sample prize: Draft', 1, 1000))
  ))->>'id')::uuid;
  active_id := (public.save_drawing_campaign(pg_temp.drawing_payload(
    '2028-Q2', 'sample', 1000, jsonb_build_array(pg_temp.prize('Sample prize: Active', 1, 1000))
  ))->>'id')::uuid;
  perform public.transition_drawing_campaign(active_id, 'active');

  direct_id := (public.save_drawing_campaign(pg_temp.drawing_payload(
    '2028-Q3', 'sample', 1000, jsonb_build_array(pg_temp.prize('Sample prize: Direct', 1, 1000))
  ))->>'id')::uuid;
  update public.drawing_campaigns set status = 'closed' where id = direct_id;

  live_id := (public.save_drawing_campaign(pg_temp.drawing_payload(
    '2028-Q4', 'live', 1000,
    jsonb_build_array(jsonb_build_object(
      'label', 'Gift card', 'quantity', 1, 'unit_value_cents', 1000, 'is_sample', false
    ))
  ))->>'id')::uuid;
  -- drawing_payload forces sample sources and sample mode through its
  -- arguments. Build the live row with mode live below if that payload
  -- saved a sample. The helper always passes p_mode.
  if (select mode from public.drawing_campaigns where id = live_id) is distinct from 'live' then
    raise exception 'FAIL: live draft was not stored';
  end if;

  live_closed_id := (public.save_drawing_campaign(pg_temp.drawing_payload(
    '2029-Q1', 'live', 1000,
    jsonb_build_array(jsonb_build_object(
      'label', 'Gift card', 'quantity', 1, 'unit_value_cents', 1000, 'is_sample', false
    ))
  ))->>'id')::uuid;
  perform public.transition_drawing_campaign(live_closed_id, 'closed');

  direct_rpc_id := (public.save_drawing_campaign(pg_temp.drawing_payload(
    '2029-Q2', 'sample', 1000, jsonb_build_array(pg_temp.prize('Sample prize: Skipped', 1, 1000))
  ))->>'id')::uuid;
  perform public.transition_drawing_campaign(direct_rpc_id, 'closed');

  if pg_temp.selection_error(draft_id, 'ops', null) is distinct from 'P0001 campaign_not_closed'
     or pg_temp.selection_error(active_id, 'ops', null) is distinct from 'P0001 campaign_not_closed'
     or pg_temp.selection_error(direct_id, 'ops', null) is distinct from 'P0001 campaign_not_closed'
     or pg_temp.selection_error(direct_rpc_id, 'ops', null) is distinct from 'P0001 campaign_not_closed'
     or pg_temp.selection_error(live_id, 'ops', null) is distinct from 'P0001 live_selection_blocked'
     or pg_temp.selection_error(live_closed_id, 'ops', null) is distinct from 'P0001 live_selection_blocked'
     or pg_temp.selection_error('00000000-0000-4000-8000-000000000099', 'ops', null) is distinct from 'P0002 not_found'
     or exists (
       select 1 from public.drawing_selections
       where campaign_id in (draft_id, active_id, direct_id, direct_rpc_id, live_id, live_closed_id)
     ) then
    raise exception 'FAIL: a rejected campaign wrote a selection';
  end if;

  source_id := pg_temp.close_sample(
    '2031-Q1', 1000, jsonb_build_array(pg_temp.prize('Sample prize: Source', 1, 1000)),
    null
  );
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000051', 1, '2031-Q1', '2026-01-01 00:00:00+00', 'a1000000-0000-4000-8000-000000000051');
  service_id := pg_temp.close_sample(
    '2035-Q1', 1000, jsonb_build_array(pg_temp.prize('Sample prize: Role', 1, 1000)),
    null
  );
  perform pg_temp.seed_entry('b1000000-0000-4000-8000-000000000061', 1, '2035-Q1', '2026-01-01 00:00:00+00', 'a1000000-0000-4000-8000-000000000061');
  insert into pg_temp.b5_service (id) values (service_id);
  -- level_milestone is the only source the entry table allows, so the list
  -- is moved off it for this one draw. Nothing after this update may set
  -- drawing_campaigns_enforce immediate: that would reject other_source.
  -- The file rolls the change back.
  set constraints all immediate;
  alter table public.drawing_campaigns disable trigger drawing_campaigns_lock;
  set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce deferred;
  update public.drawing_campaigns
    set eligible_entry_sources = array['other_source']
  where id = source_id;
  if pg_temp.selection_error(source_id, 'ops', seed) is distinct from 'P0001 no_eligible_entries'
     or exists (select 1 from public.drawing_selections where campaign_id = source_id) then
    raise exception 'FAIL: an entry source outside the campaign list was eligible';
  end if;
end;
$$;

create temp table b5_service_setting as
select set_config('wanderbite.b5_service_campaign', id::text, true) from b5_service;

set local role service_role;
do $$
declare
  campaign_id uuid := current_setting('wanderbite.b5_service_campaign')::uuid;
  saved jsonb;
  seen integer;
begin
  saved := public.select_drawing_winners(campaign_id, 'service');
  select count(*) into seen
  from public.drawing_selections
  where id = (saved->'selection'->>'id')::uuid
    and simulated
    and run_by = 'service';
  if seen <> 1 or jsonb_array_length(saved->'winners') <> 1 then
    raise exception 'FAIL: service_role could not read the draw it ran';
  end if;
  begin
    insert into public.drawing_selections (
      campaign_id, algorithm_version, seed, eligible_entry_count, eligible_member_count,
      prize_unit_count, unfilled_unit_count, simulated, run_by
    ) values (
      campaign_id, 'v1-sha256-rank', repeat('ab', 32), 1, 1, 1, 0, true, 'service-direct'
    );
    raise exception 'FAIL: service_role direct insert';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

set local role anon;
do $$
begin
  begin
    perform public.select_drawing_winners('00000000-0000-4000-8000-000000000099', 'anon');
    raise exception 'anon execute';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform count(*) from public.drawing_selections;
    raise exception 'anon read';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform count(*) from public.drawing_selection_winners;
    raise exception 'anon read winners';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

set local role authenticated;
do $$
begin
  begin
    perform public.select_drawing_winners('00000000-0000-4000-8000-000000000099', 'member');
    raise exception 'authenticated execute';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.drawing_selection_winners (
      selection_id, campaign_id, prize_id, unit_index, entry_id, user_id, rank
    ) values (
      '00000000-0000-4000-8000-000000000099',
      '00000000-0000-4000-8000-000000000098',
      '00000000-0000-4000-8000-000000000097',
      1,
      '00000000-0000-4000-8000-000000000096',
      '00000000-0000-4000-8000-000000000095',
      1
    );
    raise exception 'authenticated insert';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.drawing_selections set run_by = 'authenticated';
    raise exception 'authenticated update';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.drawing_selection_winners;
    raise exception 'authenticated delete';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

rollback;
