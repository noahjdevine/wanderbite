-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E09-B6: one fulfillment per simulated winner, status moves through the
-- fixed edges, and every change is an append-only event.
begin;
set local statement_timeout = '15s';

create temp table b6_service (selection_id uuid);

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
  p_prizes jsonb
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

create function pg_temp.create_error(p_selection uuid, p_run_by text)
returns text
language plpgsql
as $$
begin
  perform public.create_drawing_fulfillments(p_selection, p_run_by);
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;

create function pg_temp.transition_error(
  p_id uuid,
  p_to text,
  p_actor text,
  p_note text,
  p_cost integer
) returns text
language plpgsql
as $$
begin
  perform public.transition_drawing_fulfillment(p_id, p_to, p_actor, p_note, p_cost);
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;

create function pg_temp.expect_transition(
  p_id uuid,
  p_to text,
  p_actor text,
  p_note text,
  p_cost integer,
  p_expected text
) returns void
language plpgsql
as $$
declare
  err text;
begin
  err := pg_temp.transition_error(p_id, p_to, p_actor, p_note, p_cost);
  if err is distinct from p_expected then
    raise exception 'FAIL: transition to % (cost %) expected [%] got [%]',
      p_to, p_cost, p_expected, err;
  end if;
end;
$$;

do $$
declare
  main_id uuid;
  zero_id uuid;
  service_id uuid;
  main_selection uuid;
  zero_selection uuid;
  service_selection uuid;
  drawn jsonb;
  created jsonb;
  again jsonb;
  fulfilled jsonb;
  f1 uuid;
  f2 uuid;
  f3 uuid;
  zero_f uuid;
  err text;
  winners_before bigint;
  selections_before bigint;
  fulfillments_before bigint;
  events_before uuid[];
  events_after uuid[];
  badges_before bigint;
  progress_events_before bigint;
  milestones_before bigint;
  entries_before bigint;
  fn_definer boolean;
  fn_config text[];
  guard_definer boolean;
  note_500 text := repeat('n', 500);
  note_501 text := repeat('n', 501);
  target text;
  targets text[] := array['pending', 'ready', 'fulfilled', 'forfeited', 'shipped'];
begin
  if now() >= '2027-04-01 05:00:00+00'::timestamptz then
    raise exception 'FAIL: clock is at or after the 2027-Q1 end';
  end if;

  select p.prosecdef, p.proconfig
    into fn_definer, fn_config
  from pg_proc p
  where p.oid = 'public.create_drawing_fulfillments(uuid, text)'::regprocedure;
  if fn_definer is not true
     or fn_config is distinct from array['search_path=pg_catalog, public'] then
    raise exception 'FAIL: create_drawing_fulfillments must be security definer with a pinned search_path';
  end if;

  select p.prosecdef, p.proconfig
    into fn_definer, fn_config
  from pg_proc p
  where p.oid = 'public.transition_drawing_fulfillment(uuid, text, text, text, integer)'::regprocedure;
  if fn_definer is not true
     or fn_config is distinct from array['search_path=pg_catalog, public'] then
    raise exception 'FAIL: transition_drawing_fulfillment must be security definer with a pinned search_path';
  end if;

  select p.prosecdef
    into guard_definer
  from pg_proc p
  where p.oid = 'public.drawing_fulfillments_guard()'::regprocedure;
  if guard_definer then
    raise exception 'FAIL: drawing_fulfillments_guard must not be security definer';
  end if;
  select p.prosecdef
    into guard_definer
  from pg_proc p
  where p.oid = 'public.drawing_fulfillment_events_guard()'::regprocedure;
  if guard_definer then
    raise exception 'FAIL: drawing_fulfillment_events_guard must not be security definer';
  end if;

  if has_function_privilege('anon', 'public.create_drawing_fulfillments(uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.create_drawing_fulfillments(uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.create_drawing_fulfillments(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.transition_drawing_fulfillment(uuid, text, text, text, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.transition_drawing_fulfillment(uuid, text, text, text, integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.transition_drawing_fulfillment(uuid, text, text, text, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.drawing_fulfillments_guard()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.drawing_fulfillments_guard()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.drawing_fulfillments_guard()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.drawing_fulfillment_events_guard()', 'EXECUTE') then
    raise exception 'FAIL: fulfillment function grants';
  end if;

  if has_table_privilege('anon', 'public.drawing_fulfillments', 'SELECT')
     or has_table_privilege('anon', 'public.drawing_fulfillments', 'INSERT')
     or has_table_privilege('anon', 'public.drawing_fulfillments', 'UPDATE')
     or has_table_privilege('anon', 'public.drawing_fulfillments', 'DELETE')
     or has_table_privilege('anon', 'public.drawing_fulfillment_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.drawing_fulfillments', 'SELECT')
     or has_table_privilege('authenticated', 'public.drawing_fulfillments', 'INSERT')
     or has_table_privilege('authenticated', 'public.drawing_fulfillments', 'UPDATE')
     or has_table_privilege('authenticated', 'public.drawing_fulfillments', 'DELETE')
     or has_table_privilege('authenticated', 'public.drawing_fulfillment_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.drawing_fulfillment_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.drawing_fulfillment_events', 'DELETE')
     or not has_table_privilege('service_role', 'public.drawing_fulfillments', 'SELECT')
     or not has_table_privilege('service_role', 'public.drawing_fulfillment_events', 'SELECT')
     or has_table_privilege('service_role', 'public.drawing_fulfillments', 'INSERT')
     or has_table_privilege('service_role', 'public.drawing_fulfillments', 'UPDATE')
     or has_table_privilege('service_role', 'public.drawing_fulfillments', 'DELETE')
     or has_table_privilege('service_role', 'public.drawing_fulfillment_events', 'INSERT')
     or has_table_privilege('service_role', 'public.drawing_fulfillment_events', 'UPDATE')
     or has_table_privilege('service_role', 'public.drawing_fulfillment_events', 'DELETE') then
    raise exception 'FAIL: fulfillment table grants';
  end if;

  if (select count(*) from pg_policies
      where schemaname = 'public'
        and tablename in ('drawing_fulfillments', 'drawing_fulfillment_events')) <> 0 then
    raise exception 'FAIL: fulfillment tables must not have policies';
  end if;

  if (select relrowsecurity from pg_class where oid = 'public.drawing_fulfillments'::regclass) is not true
     or (select relrowsecurity from pg_class where oid = 'public.drawing_fulfillment_events'::regclass) is not true then
    raise exception 'FAIL: fulfillment RLS';
  end if;

  main_id := pg_temp.close_sample(
    '2027-Q1',
    3000,
    jsonb_build_array(pg_temp.prize('Sample prize: Sticker', 3, 1000))
  );
  perform pg_temp.seed_entry('b6000000-0000-4000-8000-000000000001', 1, '2027-Q1', '2026-06-01 00:00:00+00', 'a6000000-0000-4000-8000-000000000001');
  perform pg_temp.seed_entry('b6000000-0000-4000-8000-000000000002', 1, '2027-Q1', '2026-06-02 00:00:00+00', 'a6000000-0000-4000-8000-000000000002');
  perform pg_temp.seed_entry('b6000000-0000-4000-8000-000000000003', 1, '2027-Q1', '2026-06-03 00:00:00+00', 'a6000000-0000-4000-8000-000000000003');
  drawn := public.select_drawing_winners(main_id, 'selector');
  main_selection := (drawn->'selection'->>'id')::uuid;
  if jsonb_array_length(drawn->'winners') <> 3
     or (select count(*) from public.drawing_selection_winners where selection_id = main_selection) <> 3 then
    raise exception 'FAIL: expected 3 simulated winners';
  end if;

  if pg_temp.create_error(main_selection, '   ') is distinct from 'P0001 invalid_run_by'
     or pg_temp.create_error(main_selection, null) is distinct from 'P0001 invalid_run_by'
     or pg_temp.create_error(null, 'clerk') is distinct from 'P0002 not_found'
     or pg_temp.create_error('00000000-0000-4000-8000-000000000099', '   ') is distinct from 'P0002 not_found'
     or exists (select 1 from public.drawing_fulfillments where selection_id = main_selection) then
    raise exception 'FAIL: create rejected the wrong way or wrote a row';
  end if;

  created := public.create_drawing_fulfillments(main_selection, '  clerk  ');
  if current_setting('wanderbite.drawing_fulfillment', true) is distinct from '' then
    raise exception 'FAIL: create left the fulfillment latch set';
  end if;
  if jsonb_array_length(created) <> 3 then
    raise exception 'FAIL: create returned % rows', jsonb_array_length(created);
  end if;
  if exists (
    select 1
    from jsonb_array_elements(created) item
    where item->>'status' is distinct from 'pending'
       or item->>'simulated' is distinct from 'true'
       or item->>'actual_cost_cents' is not null
       or item->>'selection_id' is distinct from main_selection::text
       or item->>'campaign_id' is distinct from main_id::text
  ) then
    raise exception 'FAIL: created rows are not pending simulated fulfillments';
  end if;
  if (
    select array_agg(f.winner_id order by w.rank)
    from public.drawing_fulfillments f
    join public.drawing_selection_winners w on w.id = f.winner_id
    where f.selection_id = main_selection
  ) is distinct from (
    select array_agg(w.id order by w.rank)
    from public.drawing_selection_winners w
    where w.selection_id = main_selection
  ) then
    raise exception 'FAIL: fulfillments are not one per winner';
  end if;
  if (select count(*) from public.drawing_fulfillment_events e
      join public.drawing_fulfillments f on f.id = e.fulfillment_id
      where f.selection_id = main_selection) <> 3
     or exists (
       select 1
       from public.drawing_fulfillment_events e
       join public.drawing_fulfillments f on f.id = e.fulfillment_id
       where f.selection_id = main_selection
         and (
           e.from_status is not null
           or e.to_status is distinct from 'pending'
           or e.actor is distinct from 'clerk'
           or e.note is not null
           or e.actual_cost_cents is not null
         )
     ) then
    raise exception 'FAIL: creation events';
  end if;

  select coalesce(array_agg(e.id order by e.id), '{}')
    into events_before
  from public.drawing_fulfillment_events e
  join public.drawing_fulfillments f on f.id = e.fulfillment_id
  where f.selection_id = main_selection;

  again := public.create_drawing_fulfillments(main_selection, 'someone-else');
  select coalesce(array_agg(e.id order by e.id), '{}')
    into events_after
  from public.drawing_fulfillment_events e
  join public.drawing_fulfillments f on f.id = e.fulfillment_id
  where f.selection_id = main_selection;
  if events_before is distinct from events_after
     or (select count(*) from public.drawing_fulfillments where selection_id = main_selection) <> 3
     or (
       select jsonb_agg(value order by value->>'id')
       from jsonb_array_elements(created)
     ) is distinct from (
       select jsonb_agg(value order by value->>'id')
       from jsonb_array_elements(again)
     ) then
    raise exception 'FAIL: second create wrote rows or returned a different set';
  end if;
  if pg_temp.create_error(main_selection, ' ') is distinct from 'P0001 invalid_run_by'
     or (select count(*) from public.drawing_fulfillments where selection_id = main_selection) <> 3 then
    raise exception 'FAIL: blank run_by on a second create still wrote or returned rows';
  end if;

  f1 := (created->0->>'id')::uuid;
  f2 := (created->1->>'id')::uuid;
  f3 := (created->2->>'id')::uuid;

  select count(*) into badges_before from public.user_badges;
  select count(*) into progress_events_before from public.progression_events;
  select count(*) into milestones_before from public.progression_milestones;
  select count(*) into entries_before from public.progression_drawing_entries;
  select count(*) into selections_before from public.drawing_selections;
  select count(*) into winners_before from public.drawing_selection_winners;

  perform public.transition_drawing_fulfillment(f1, 'ready', '  lead  ', '  packed  ', null);
  if current_setting('wanderbite.drawing_fulfillment', true) is distinct from '' then
    raise exception 'FAIL: transition left the fulfillment latch set';
  end if;
  fulfilled := public.transition_drawing_fulfillment(f1, 'fulfilled', 'lead', 'sent', 2500);
  if fulfilled->>'status' is distinct from 'fulfilled'
     or (fulfilled->>'actual_cost_cents')::integer is distinct from 2500
     or (fulfilled->>'simulated')::boolean is not true
     or (select status from public.drawing_fulfillments where id = f1) is distinct from 'fulfilled'
     or (select actual_cost_cents from public.drawing_fulfillments where id = f1) is distinct from 2500
     or (select updated_at > created_at from public.drawing_fulfillments where id = f1) is not true then
    raise exception 'FAIL: fulfilled row did not store the cost';
  end if;
  if (select count(*) from public.drawing_fulfillment_events where fulfillment_id = f1) <> 3
     or not exists (
       select 1 from public.drawing_fulfillment_events
       where fulfillment_id = f1
         and from_status = 'pending'
         and to_status = 'ready'
         and actor = 'lead'
         and note = 'packed'
         and actual_cost_cents is null
     )
     or not exists (
       select 1 from public.drawing_fulfillment_events
       where fulfillment_id = f1
         and from_status = 'ready'
         and to_status = 'fulfilled'
         and actor = 'lead'
         and note = 'sent'
         and actual_cost_cents = 2500
     ) then
    raise exception 'FAIL: ready and fulfilled events';
  end if;

  -- Ordering of those two events is by the instant, including when the
  -- test transaction's now() does not move. clock_timestamp() does.
  if (
    select to_status
    from public.drawing_fulfillment_events
    where fulfillment_id = f1
      and from_status is not null
    order by created_at, id
    limit 1
  ) is distinct from 'ready' then
    raise exception 'FAIL: fulfillment events are not ordered by instant';
  end if;

  perform pg_temp.expect_transition(f1, 'pending', 'lead', null, null, 'P0001 invalid_transition');
  perform pg_temp.expect_transition(f1, 'ready', 'lead', null, null, 'P0001 invalid_transition');
  perform pg_temp.expect_transition(f1, 'fulfilled', 'lead', null, 2500, 'P0001 invalid_transition');
  perform pg_temp.expect_transition(f1, 'forfeited', 'lead', null, null, 'P0001 invalid_transition');
  perform pg_temp.expect_transition(f1, 'forfeited', 'lead', null, 9999, 'P0001 invalid_transition');
  perform pg_temp.expect_transition(f1, 'shipped', 'lead', null, null, 'P0001 invalid_transition');
  if (select status from public.drawing_fulfillments where id = f1) is distinct from 'fulfilled'
     or (select actual_cost_cents from public.drawing_fulfillments where id = f1) is distinct from 2500
     or (select count(*) from public.drawing_fulfillment_events where fulfillment_id = f1) <> 3 then
    raise exception 'FAIL: a rejected move off fulfilled changed the row';
  end if;

  perform public.transition_drawing_fulfillment(f2, 'forfeited', 'clerk', null, null);
  if (select status from public.drawing_fulfillments where id = f2) is distinct from 'forfeited'
     or (select actual_cost_cents from public.drawing_fulfillments where id = f2) is not null
     or (select count(*) from public.drawing_selections) is distinct from selections_before
     or (select count(*) from public.drawing_selection_winners) is distinct from winners_before
     or (select count(*) from public.drawing_fulfillments where selection_id = main_selection) <> 3
     or not exists (
       select 1 from public.drawing_fulfillment_events
       where fulfillment_id = f2
         and from_status = 'pending'
         and to_status = 'forfeited'
         and actor = 'clerk'
         and note is null
         and actual_cost_cents is null
     ) then
    raise exception 'FAIL: forfeit redrew, replaced a winner, or dropped the cost rule';
  end if;

  foreach target in array targets
  loop
    perform pg_temp.expect_transition(f2, target, 'clerk', null, null, 'P0001 invalid_transition');
    perform pg_temp.expect_transition(f2, target, 'clerk', null, 100, 'P0001 invalid_transition');
  end loop;
  if pg_temp.transition_error(f2, 'ready', '   ', null, null) is distinct from 'P0001 invalid_actor'
     or pg_temp.transition_error(null, 'ready', '   ', null, null) is distinct from 'P0002 not_found'
     or pg_temp.transition_error('00000000-0000-4000-8000-000000000099', 'ready', '', null, null) is distinct from 'P0002 not_found' then
    raise exception 'FAIL: invalid_actor and not_found order';
  end if;
  if (select count(*) from public.drawing_fulfillment_events where fulfillment_id = f2) <> 2 then
    raise exception 'FAIL: rejected forfeit follow-ups wrote events';
  end if;

  perform pg_temp.expect_transition(f3, 'fulfilled', 'lead', null, 100, 'P0001 invalid_transition');
  perform pg_temp.expect_transition(f3, 'ready', 'lead', null, 0, 'P0001 cost_not_allowed');
  perform pg_temp.expect_transition(f3, 'ready', 'lead', null, -1, 'P0001 cost_not_allowed');
  perform pg_temp.expect_transition(f3, 'ready', ' ', null, null, 'P0001 invalid_actor');
  err := pg_temp.transition_error(f3, 'ready', 'lead', note_501, null);
  if err not like '23514%'
     or position('drawing_fulfillment_events_note_check' in err) = 0 then
    raise exception 'FAIL: long note should fail the note check, got [%]', err;
  end if;
  if (select status from public.drawing_fulfillments where id = f3) is distinct from 'pending'
     or (select count(*) from public.drawing_fulfillment_events where fulfillment_id = f3) <> 1 then
    raise exception 'FAIL: rejected f3 moves changed the pending row';
  end if;

  perform public.transition_drawing_fulfillment(f3, 'ready', 'lead', note_500, null);
  if (select note from public.drawing_fulfillment_events
      where fulfillment_id = f3 and to_status = 'ready') is distinct from note_500
     or (select char_length(note) from public.drawing_fulfillment_events
         where fulfillment_id = f3 and to_status = 'ready') <> 500 then
    raise exception 'FAIL: a 500 character note was not stored';
  end if;

  perform pg_temp.expect_transition(f3, 'fulfilled', 'lead', null, null, 'P0001 cost_required');
  err := pg_temp.transition_error(f3, 'fulfilled', 'lead', null, -1);
  if err not like '23514%'
     or position('drawing_fulfillments_actual_cost_cents_check' in err) = 0 then
    raise exception 'FAIL: negative cost should fail the cost check, got [%]', err;
  end if;
  perform pg_temp.expect_transition(f3, 'pending', 'lead', null, null, 'P0001 invalid_transition');
  perform pg_temp.expect_transition(f3, 'forfeited', 'lead', 'nope', 10, 'P0001 cost_not_allowed');
  if (select status from public.drawing_fulfillments where id = f3) is distinct from 'ready'
     or (select actual_cost_cents from public.drawing_fulfillments where id = f3) is not null
     or (select count(*) from public.drawing_fulfillment_events where fulfillment_id = f3) <> 2 then
    raise exception 'FAIL: rejected ready moves changed f3';
  end if;

  perform public.transition_drawing_fulfillment(f3, 'forfeited', 'lead', '  ', null);
  if (select status from public.drawing_fulfillments where id = f3) is distinct from 'forfeited'
     or (select actual_cost_cents from public.drawing_fulfillments where id = f3) is not null
     or (select note from public.drawing_fulfillment_events
         where fulfillment_id = f3 and to_status = 'forfeited') is not null
     or (select count(*) from public.drawing_selections) is distinct from selections_before
     or (select count(*) from public.drawing_selection_winners) is distinct from winners_before then
    raise exception 'FAIL: forfeit from ready redrew or stored a blank note';
  end if;

  -- Direct writes, including a delete while the latch is held.
  begin
    insert into public.drawing_fulfillments (
      winner_id, selection_id, campaign_id, prize_id, status, simulated
    )
    select winner_id, selection_id, campaign_id, prize_id, 'pending', true
    from public.drawing_fulfillments
    where id = f1;
    raise exception 'FAIL: direct fulfillment insert';
  exception
    when sqlstate 'P0001' then
      if sqlerrm is distinct from 'fulfillment_immutable' then
        raise exception 'FAIL: direct insert raised [%]', sqlerrm;
      end if;
  end;
  begin
    update public.drawing_fulfillments set status = 'ready' where id = f1;
    raise exception 'FAIL: direct fulfillment update';
  exception
    when sqlstate 'P0001' then
      if sqlerrm is distinct from 'fulfillment_immutable' then
        raise exception 'FAIL: direct update raised [%]', sqlerrm;
      end if;
  end;
  begin
    delete from public.drawing_fulfillments where id = f1;
    raise exception 'FAIL: direct fulfillment delete';
  exception
    when sqlstate 'P0001' then
      if sqlerrm is distinct from 'fulfillment_immutable' then
        raise exception 'FAIL: direct delete raised [%]', sqlerrm;
      end if;
  end;
  perform set_config('wanderbite.drawing_fulfillment', main_selection::text, true);
  begin
    delete from public.drawing_fulfillments where id = f1;
    raise exception 'FAIL: latched fulfillment delete';
  exception
    when sqlstate 'P0001' then
      if sqlerrm is distinct from 'fulfillment_immutable' then
        raise exception 'FAIL: latched delete raised [%]', sqlerrm;
      end if;
  end;
  begin
    update public.drawing_fulfillments
      set prize_id = gen_random_uuid()
    where id = f1;
    raise exception 'FAIL: latched identity update';
  exception
    when sqlstate 'P0001' then
      if sqlerrm is distinct from 'fulfillment_immutable' then
        raise exception 'FAIL: identity update raised [%]', sqlerrm;
      end if;
  end;
  begin
    update public.drawing_fulfillment_events set note = 'changed' where fulfillment_id = f1;
    raise exception 'FAIL: event update';
  exception
    when sqlstate 'P0001' then
      if sqlerrm is distinct from 'fulfillment_event_immutable' then
        raise exception 'FAIL: event update raised [%]', sqlerrm;
      end if;
  end;
  begin
    delete from public.drawing_fulfillment_events where fulfillment_id = f1;
    raise exception 'FAIL: event delete';
  exception
    when sqlstate 'P0001' then
      if sqlerrm is distinct from 'fulfillment_event_immutable' then
        raise exception 'FAIL: event delete raised [%]', sqlerrm;
      end if;
  end;
  perform set_config('wanderbite.drawing_fulfillment', '', true);
  begin
    insert into public.drawing_fulfillment_events (
      fulfillment_id, from_status, to_status, actor
    ) values (
      f1, 'pending', 'ready', 'outsider'
    );
    raise exception 'FAIL: direct event insert';
  exception
    when sqlstate 'P0001' then
      if sqlerrm is distinct from 'fulfillment_event_immutable' then
        raise exception 'FAIL: direct event insert raised [%]', sqlerrm;
      end if;
  end;

  if (select status from public.drawing_fulfillments where id = f1) is distinct from 'fulfilled'
     or (select actual_cost_cents from public.drawing_fulfillments where id = f1) is distinct from 2500
     or (select count(*) from public.drawing_fulfillment_events where fulfillment_id = f1) <> 3
     or (select count(*) from public.user_badges) is distinct from badges_before
     or (select count(*) from public.progression_events) is distinct from progress_events_before
     or (select count(*) from public.progression_milestones) is distinct from milestones_before
     or (select count(*) from public.progression_drawing_entries) is distinct from entries_before
     or (select count(*) from public.drawing_selections) is distinct from selections_before
     or (select count(*) from public.drawing_selection_winners) is distinct from winners_before then
    raise exception 'FAIL: fulfillment writes touched the draw, the ledger, or badges';
  end if;

  zero_id := pg_temp.close_sample(
    '2038-Q1',
    1000,
    jsonb_build_array(pg_temp.prize('Sample prize: Zero', 1, 1000))
  );
  perform pg_temp.seed_entry('b6000000-0000-4000-8000-000000000011', 1, '2038-Q1', '2026-06-01 00:00:00+00', 'a6000000-0000-4000-8000-000000000011');
  drawn := public.select_drawing_winners(zero_id, 'selector');
  zero_selection := (drawn->'selection'->>'id')::uuid;
  created := public.create_drawing_fulfillments(zero_selection, 'clerk');
  zero_f := (created->0->>'id')::uuid;
  perform public.transition_drawing_fulfillment(zero_f, 'ready', 'clerk', null, null);
  perform public.transition_drawing_fulfillment(zero_f, 'fulfilled', 'clerk', null, 0);
  if (select actual_cost_cents from public.drawing_fulfillments where id = zero_f) is distinct from 0
     or not exists (
       select 1 from public.drawing_fulfillment_events
       where fulfillment_id = zero_f
         and to_status = 'fulfilled'
         and actual_cost_cents = 0
     ) then
    raise exception 'FAIL: a zero cost was not stored';
  end if;

  service_id := pg_temp.close_sample(
    '2036-Q1',
    1000,
    jsonb_build_array(pg_temp.prize('Sample prize: Role', 1, 1000))
  );
  perform pg_temp.seed_entry('b6000000-0000-4000-8000-000000000021', 1, '2036-Q1', '2026-06-01 00:00:00+00', 'a6000000-0000-4000-8000-000000000021');
  drawn := public.select_drawing_winners(service_id, 'selector');
  service_selection := (drawn->'selection'->>'id')::uuid;
  insert into pg_temp.b6_service (selection_id) values (service_selection);
end;
$$;

create temp table b6_service_setting as
select set_config('wanderbite.b6_service_selection', selection_id::text, true) from b6_service;

set local role service_role;
do $$
declare
  v_selection uuid := current_setting('wanderbite.b6_service_selection')::uuid;
  created jsonb;
  v_fulfillment uuid;
  moved jsonb;
  seen integer;
begin
  created := public.create_drawing_fulfillments(v_selection, 'service');
  v_fulfillment := (created->0->>'id')::uuid;
  select count(*) into seen
  from public.drawing_fulfillments
  where id = v_fulfillment
    and selection_id = v_selection
    and status = 'pending'
    and simulated;
  if seen <> 1 or jsonb_array_length(created) <> 1 then
    raise exception 'FAIL: service_role could not read the fulfillment it created';
  end if;
  if (select count(*) from public.drawing_fulfillment_events where fulfillment_id = v_fulfillment) <> 1 then
    raise exception 'FAIL: service_role could not read the creation event';
  end if;
  moved := public.transition_drawing_fulfillment(v_fulfillment, 'ready', 'service', null, null);
  if moved->>'status' is distinct from 'ready' then
    raise exception 'FAIL: service_role transition did not stick';
  end if;
  begin
    perform set_config('wanderbite.drawing_fulfillment', v_selection::text, true);
    insert into public.drawing_fulfillments (
      winner_id, selection_id, campaign_id, prize_id, status, simulated
    )
    select f.winner_id, f.selection_id, f.campaign_id, f.prize_id, 'pending', true
    from public.drawing_fulfillments f
    where f.id = v_fulfillment;
    raise exception 'FAIL: service_role direct insert';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.drawing_fulfillments set status = 'forfeited' where id = v_fulfillment;
    raise exception 'FAIL: service_role direct update';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.drawing_fulfillment_events where fulfillment_id = v_fulfillment;
    raise exception 'FAIL: service_role event delete';
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
    perform public.create_drawing_fulfillments('00000000-0000-4000-8000-000000000099', 'anon');
    raise exception 'anon create';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.transition_drawing_fulfillment('00000000-0000-4000-8000-000000000099', 'ready', 'anon', null, null);
    raise exception 'anon transition';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform count(*) from public.drawing_fulfillments;
    raise exception 'anon read fulfillments';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform count(*) from public.drawing_fulfillment_events;
    raise exception 'anon read events';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.drawing_fulfillments;
    raise exception 'anon delete';
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
    perform public.create_drawing_fulfillments('00000000-0000-4000-8000-000000000099', 'member');
    raise exception 'authenticated create';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.transition_drawing_fulfillment('00000000-0000-4000-8000-000000000099', 'ready', 'member', null, null);
    raise exception 'authenticated transition';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform count(*) from public.drawing_fulfillments;
    raise exception 'authenticated read';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.drawing_fulfillment_events (
      fulfillment_id, from_status, to_status, actor
    ) values (
      '00000000-0000-4000-8000-000000000099', null, 'pending', 'member'
    );
    raise exception 'authenticated event insert';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.drawing_fulfillments set status = 'ready';
    raise exception 'authenticated update';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.drawing_fulfillment_events;
    raise exception 'authenticated event delete';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

rollback;
