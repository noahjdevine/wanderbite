-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E09-B3: campaign and prize rows, budget, sample and live rules, quarter
-- windows, one open campaign per quarter, and service_role-only grants.
begin;
set local statement_timeout = '15s';

create function pg_temp.drawing_payload(
  p_quarter text,
  p_mode text,
  p_rules text,
  p_total bigint,
  p_fulfillment bigint,
  p_sources text[],
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
    'rules_version', p_rules,
    'total_budget_cents', p_total,
    'fulfillment_allowance_cents', p_fulfillment,
    'eligible_entry_sources', to_jsonb(p_sources),
    'starts_at', make_timestamptz(year, start_month, 1, 0, 0, 0, 'America/Chicago'),
    'ends_at', make_timestamptz(end_year, end_month, 1, 0, 0, 0, 'America/Chicago'),
    'prizes', p_prizes
  );
end;
$$;

create function pg_temp.sample_prizes(p_label text, p_quantity bigint, p_unit bigint, p_sample boolean)
returns jsonb
language sql
as $$
  select jsonb_build_array(jsonb_build_object(
    'label', p_label,
    'quantity', p_quantity,
    'unit_value_cents', p_unit,
    'is_sample', p_sample
  ));
$$;

create function pg_temp.expect_code(p_payload jsonb, p_code text)
returns void
language plpgsql
as $$
declare
  campaigns bigint;
  prizes bigint;
begin
  select count(*) into campaigns from public.drawing_campaigns;
  select count(*) into prizes from public.drawing_campaign_prizes;
  begin
    perform public.save_drawing_campaign(p_payload);
    raise exception 'accepted %', p_code;
  exception
    when others then
      if sqlerrm = 'accepted ' || p_code then
        raise;
      end if;
      if sqlerrm is distinct from p_code then
        raise exception 'expected % got %', p_code, sqlerrm;
      end if;
  end;
  if (select count(*) from public.drawing_campaigns) <> campaigns
     or (select count(*) from public.drawing_campaign_prizes) <> prizes then
    raise exception 'write survived %', p_code;
  end if;
end;
$$;

do $$
declare
  sample jsonb;
  saved jsonb;
  sample_id uuid;
  prize_quantity bigint;
  prize_label text;
  budget bigint;
  rules text;
  got_start timestamptz;
  got_end timestamptz;
  campaigns bigint;
  prizes bigint;
  fn_definer boolean;
  fn_config text[];
  open_id uuid;
  closed_ok jsonb;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.drawing_campaigns'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.drawing_campaign_prizes'::regclass) then
    raise exception 'FAIL: campaign RLS disabled';
  end if;
  if (select relforcerowsecurity from pg_class where oid = 'public.drawing_campaigns'::regclass)
     or (select relforcerowsecurity from pg_class where oid = 'public.drawing_campaign_prizes'::regclass) then
    raise exception 'FAIL: campaign FORCE RLS is on';
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'public'
        and tablename in ('drawing_campaigns', 'drawing_campaign_prizes')) <> 0 then
    raise exception 'FAIL: campaign policies';
  end if;

  if has_table_privilege('anon', 'public.drawing_campaigns', 'SELECT')
     or has_table_privilege('anon', 'public.drawing_campaigns', 'INSERT')
     or has_table_privilege('anon', 'public.drawing_campaigns', 'UPDATE')
     or has_table_privilege('anon', 'public.drawing_campaigns', 'DELETE')
     or has_table_privilege('anon', 'public.drawing_campaign_prizes', 'SELECT')
     or has_table_privilege('anon', 'public.drawing_campaign_prizes', 'INSERT')
     or has_table_privilege('anon', 'public.drawing_campaign_prizes', 'UPDATE')
     or has_table_privilege('anon', 'public.drawing_campaign_prizes', 'DELETE')
     or has_table_privilege('authenticated', 'public.drawing_campaigns', 'SELECT')
     or has_table_privilege('authenticated', 'public.drawing_campaigns', 'INSERT')
     or has_table_privilege('authenticated', 'public.drawing_campaigns', 'UPDATE')
     or has_table_privilege('authenticated', 'public.drawing_campaigns', 'DELETE')
     or has_table_privilege('authenticated', 'public.drawing_campaign_prizes', 'SELECT')
     or has_table_privilege('authenticated', 'public.drawing_campaign_prizes', 'INSERT')
     or has_table_privilege('authenticated', 'public.drawing_campaign_prizes', 'UPDATE')
     or has_table_privilege('authenticated', 'public.drawing_campaign_prizes', 'DELETE')
     or not has_table_privilege('service_role', 'public.drawing_campaigns', 'SELECT')
     or not has_table_privilege('service_role', 'public.drawing_campaigns', 'INSERT')
     or not has_table_privilege('service_role', 'public.drawing_campaigns', 'UPDATE')
     or not has_table_privilege('service_role', 'public.drawing_campaigns', 'DELETE')
     or not has_table_privilege('service_role', 'public.drawing_campaign_prizes', 'SELECT')
     or not has_table_privilege('service_role', 'public.drawing_campaign_prizes', 'INSERT')
     or not has_table_privilege('service_role', 'public.drawing_campaign_prizes', 'UPDATE')
     or not has_table_privilege('service_role', 'public.drawing_campaign_prizes', 'DELETE') then
    raise exception 'FAIL: campaign grants';
  end if;

  if has_function_privilege('anon', 'public.save_drawing_campaign(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.save_drawing_campaign(jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.save_drawing_campaign(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.drawing_campaign_reject(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.drawing_campaign_reject(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.drawing_campaign_reject(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.drawing_campaigns_enforce()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.drawing_campaigns_enforce()', 'EXECUTE') then
    raise exception 'FAIL: campaign function grants';
  end if;

  select p.prosecdef, p.proconfig
    into fn_definer, fn_config
  from pg_proc p
  where p.oid = 'public.drawing_campaigns_enforce()'::regprocedure;
  if fn_definer is not true
     or fn_config is distinct from array['search_path=pg_catalog, public'] then
    raise exception 'FAIL: enforce trigger function shape';
  end if;

  select p.prosecdef, p.proconfig
    into fn_definer, fn_config
  from pg_proc p
  where p.oid = 'public.save_drawing_campaign(jsonb)'::regprocedure;
  if fn_definer is true
     or fn_config is distinct from array['search_path=pg_catalog, public'] then
    raise exception 'FAIL: save_drawing_campaign must be invoker with a pinned search_path';
  end if;

  if (select count(*) from pg_trigger
      where tgname in ('drawing_campaigns_enforce', 'drawing_campaign_prizes_enforce')
        and tgenabled = 'O'
        and tgdeferrable
        and tginitdeferred) <> 2 then
    raise exception 'FAIL: campaign constraint triggers';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'record_verified_visit_progress',
        'backfill_verified_visit_progress',
        'progression_insert_missing_v1_milestones',
        'verify_redemption',
        'verify_redemption_and_settle'
      )
      and p.prosrc ilike '%drawing_campaign%'
  ) then
    raise exception 'FAIL: progression or verify SQL mentions campaigns';
  end if;

  sample := pg_temp.drawing_payload(
    '2027-Q1',
    'sample',
    'v0',
    12000,
    2000,
    array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Gift card', 2, 5000, true)
  );
  saved := public.save_drawing_campaign(sample);
  sample_id := (saved->>'id')::uuid;
  if saved->>'mode' is distinct from 'sample'
     or saved->>'status' is distinct from 'draft'
     or saved->>'quarter_key' is distinct from '2027-Q1'
     or (saved->>'total_budget_cents')::bigint <> 12000
     or jsonb_array_length(saved->'prizes') <> 1
     or (saved->'prizes'->0->>'is_sample')::boolean is not true
     or (saved->'prizes'->0->>'position')::integer <> 0 then
    raise exception 'FAIL: sample campaign shape %', saved;
  end if;

  select c.starts_at, c.ends_at
    into got_start, got_end
  from public.drawing_campaigns c
  where c.id = sample_id;
  if got_start is distinct from '2027-01-01 06:00:00+00'::timestamptz
     or got_end is distinct from '2027-04-01 05:00:00+00'::timestamptz then
    raise exception 'FAIL: 2027-Q1 window % %', got_start, got_end;
  end if;

  saved := public.save_drawing_campaign(pg_temp.drawing_payload(
    '2026-Q4',
    'sample',
    'v0',
    12000,
    2000,
    array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Gift card', 2, 5000, true)
  ));
  select c.starts_at, c.ends_at
    into got_start, got_end
  from public.drawing_campaigns c
  where c.id = (saved->>'id')::uuid;
  if got_start is distinct from '2026-10-01 05:00:00+00'::timestamptz
     or got_end is distinct from '2027-01-01 06:00:00+00'::timestamptz
     or got_end - got_start <> interval '92 days 1 hour' then
    raise exception 'FAIL: 2026-Q4 window % %', got_start, got_end;
  end if;

  saved := public.save_drawing_campaign(pg_temp.drawing_payload(
    '2027-Q2',
    'live',
    'rules-2027-04',
    12000,
    2000,
    array['level_milestone'],
    pg_temp.sample_prizes('Gift card', 2, 5000, false)
  ));
  if saved->>'mode' is distinct from 'live'
     or saved->>'rules_version' is distinct from 'rules-2027-04'
     or (saved->'prizes'->0->>'is_sample')::boolean is not false then
    raise exception 'FAIL: live campaign shape %', saved;
  end if;
  select c.starts_at, c.ends_at
    into got_start, got_end
  from public.drawing_campaigns c
  where c.id = (saved->>'id')::uuid;
  if got_start is distinct from '2027-04-01 05:00:00+00'::timestamptz
     or got_end is distinct from '2027-07-01 05:00:00+00'::timestamptz then
    raise exception 'FAIL: 2027-Q2 window % %', got_start, got_end;
  end if;

  perform pg_temp.expect_code(pg_temp.drawing_payload(
    '2028-Q1', 'sample', 'v0', 11999, 2000, array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Gift card', 2, 5000, true)
  ), 'over_budget');

  select count(*) into campaigns from public.drawing_campaigns;
  select count(*) into prizes from public.drawing_campaign_prizes;
  begin
    set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce deferred;
    insert into public.drawing_campaigns (
      quarter_key, mode, rules_version, total_budget_cents, fulfillment_allowance_cents,
      eligible_entry_sources, starts_at, ends_at
    ) values (
      '2028-Q2',
      'sample',
      'v0',
      11999,
      2000,
      array['level_milestone'],
      make_timestamptz(2028, 4, 1, 0, 0, 0, 'America/Chicago'),
      make_timestamptz(2028, 7, 1, 0, 0, 0, 'America/Chicago')
    );
    insert into public.drawing_campaign_prizes (
      campaign_id, label, quantity, unit_value_cents, is_sample, position
    )
    select id, 'Sample prize: Gift card', 2, 5000, true, 0
    from public.drawing_campaigns
    where quarter_key = '2028-Q2';
    set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce immediate;
    raise exception 'accepted direct over_budget';
  exception
    when others then
      if sqlerrm is distinct from 'over_budget' then
        raise exception 'FAIL: direct over_budget got %', sqlerrm;
      end if;
  end;
  set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce deferred;
  if (select count(*) from public.drawing_campaigns) <> campaigns
     or (select count(*) from public.drawing_campaign_prizes) <> prizes then
    raise exception 'FAIL: direct over_budget wrote a row';
  end if;

  select p.quantity, p.label, c.total_budget_cents, c.rules_version
    into prize_quantity, prize_label, budget, rules
  from public.drawing_campaign_prizes p
  join public.drawing_campaigns c on c.id = p.campaign_id
  where c.id = sample_id;

  begin
    set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce deferred;
    update public.drawing_campaign_prizes
      set quantity = quantity + 1
    where campaign_id = sample_id;
    set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce immediate;
    raise exception 'accepted quantity edit';
  exception
    when others then
      if sqlerrm is distinct from 'over_budget' then
        raise exception 'FAIL: quantity edit got %', sqlerrm;
      end if;
  end;

  begin
    set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce deferred;
    update public.drawing_campaigns
      set total_budget_cents = total_budget_cents - 1
    where id = sample_id;
    set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce immediate;
    raise exception 'accepted budget edit';
  exception
    when others then
      if sqlerrm is distinct from 'over_budget' then
        raise exception 'FAIL: budget edit got %', sqlerrm;
      end if;
  end;
  set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce deferred;

  if (select quantity from public.drawing_campaign_prizes where campaign_id = sample_id) <> prize_quantity
     or (select label from public.drawing_campaign_prizes where campaign_id = sample_id) is distinct from prize_label
     or (select total_budget_cents from public.drawing_campaigns where id = sample_id) <> budget
     or (select rules_version from public.drawing_campaigns where id = sample_id) is distinct from rules then
    raise exception 'FAIL: rejected edit changed the stored campaign';
  end if;

  sample := pg_temp.drawing_payload(
    '2027-Q1', 'sample', 'v0', 11999, 2000, array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Gift card', 2, 5000, true)
  );
  sample := sample || jsonb_build_object('id', sample_id);
  perform pg_temp.expect_code(sample, 'over_budget');
  if (select total_budget_cents from public.drawing_campaigns where id = sample_id) <> budget then
    raise exception 'FAIL: RPC budget edit changed the row';
  end if;

  sample := pg_temp.drawing_payload(
    '2027-Q1', 'sample', 'v0', 12000, 2000, array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Gift card', 3, 5000, true)
  );
  sample := sample || jsonb_build_object('id', sample_id);
  perform pg_temp.expect_code(sample, 'over_budget');
  if (select quantity from public.drawing_campaign_prizes where campaign_id = sample_id) <> prize_quantity then
    raise exception 'FAIL: RPC quantity edit changed the row';
  end if;

  perform pg_temp.expect_code(pg_temp.drawing_payload(
    '2028-Q3', 'sample', 'v0', 12000, 2000, array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Gift card', 2, 5000, false)
  ), 'sample_prize_required');

  perform pg_temp.expect_code(pg_temp.drawing_payload(
    '2028-Q3', 'sample', 'v0', 12000, 2000, array['level_milestone'],
    pg_temp.sample_prizes('Gift card', 2, 5000, true)
  ), 'sample_label_required');

  perform pg_temp.expect_code(pg_temp.drawing_payload(
    '2028-Q3', 'live', '', 12000, 2000, array['level_milestone'],
    pg_temp.sample_prizes('Gift card', 2, 5000, false)
  ), 'invalid_rules_version');

  perform pg_temp.expect_code(pg_temp.drawing_payload(
    '2028-Q3', 'live', '   ', 12000, 2000, array['level_milestone'],
    pg_temp.sample_prizes('Gift card', 2, 5000, false)
  ), 'invalid_rules_version');

  perform pg_temp.expect_code(pg_temp.drawing_payload(
    '2028-Q3', 'live', 'rules-2028', 12000, 2000, array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Gift card', 2, 5000, true)
  ), 'live_sample_prize');

  perform pg_temp.expect_code(pg_temp.drawing_payload(
    '2028-Q3', 'sample', 'v0', 12000, 2000, array['public_review'],
    pg_temp.sample_prizes('Sample prize: Gift card', 2, 5000, true)
  ), 'public_review_entry');

  perform pg_temp.expect_code(pg_temp.drawing_payload(
    '2028-Q3', 'sample', 'v0', 12000, 2000, array['qr_issued'],
    pg_temp.sample_prizes('Sample prize: Gift card', 2, 5000, true)
  ), 'unknown_entry_source');

  perform pg_temp.expect_code(pg_temp.drawing_payload(
    '2028-Q3', 'live', 'rules-2028', 12000, 2000, array['recipe'],
    pg_temp.sample_prizes('Gift card', 2, 5000, false)
  ), 'unknown_entry_source');

  perform pg_temp.expect_code(
    pg_temp.drawing_payload(
      '2028-Q3', 'sample', 'v0', 12000, 2000, array['level_milestone'],
      pg_temp.sample_prizes('Sample prize: Gift card', 2, 5000, true)
    ) || jsonb_build_object('total_budget_cents', 1.5),
    'non_integer_cents'
  );

  perform pg_temp.expect_code(pg_temp.drawing_payload(
    '2028-Q3', 'sample', 'v0', -1, 2000, array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Gift card', 2, 5000, true)
  ), 'negative_cents');

  select count(*) into campaigns from public.drawing_campaigns;
  begin
    set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce deferred;
    insert into public.drawing_campaigns (
      quarter_key, mode, rules_version, total_budget_cents, fulfillment_allowance_cents,
      eligible_entry_sources, starts_at, ends_at
    ) values (
      '2033-Q1', 'sample', 'v0', 1.5, 0,
      array['level_milestone'],
      make_timestamptz(2033, 1, 1, 0, 0, 0, 'America/Chicago'),
      make_timestamptz(2033, 4, 1, 0, 0, 0, 'America/Chicago')
    );
    set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce immediate;
    raise exception 'accepted non-integer';
  exception
    when others then
      if sqlerrm is distinct from 'non_integer_cents' then
        raise exception 'FAIL: direct non-integer got %', sqlerrm;
      end if;
  end;
  set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce deferred;
  if (select count(*) from public.drawing_campaigns) <> campaigns then
    raise exception 'FAIL: non-integer insert wrote a row';
  end if;

  select count(*) into campaigns from public.drawing_campaigns;
  begin
    set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce deferred;
    insert into public.drawing_campaigns (
      quarter_key, mode, rules_version, total_budget_cents, fulfillment_allowance_cents,
      eligible_entry_sources, starts_at, ends_at
    ) values (
      '2033-Q2', 'sample', 'v0', 0, 0, array['level_milestone'],
      make_timestamptz(2033, 4, 1, 0, 0, 0, 'America/Chicago'),
      make_timestamptz(2033, 7, 1, 0, 0, 0, 'America/Chicago')
    );
    set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce immediate;
    raise exception 'accepted empty prizes';
  exception
    when others then
      if sqlerrm is distinct from 'empty_prizes' then
        raise exception 'FAIL: empty prizes got %', sqlerrm;
      end if;
  end;
  set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce deferred;
  if (select count(*) from public.drawing_campaigns) <> campaigns then
    raise exception 'FAIL: empty campaign was stored';
  end if;

  begin
    set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce deferred;
    update public.drawing_campaigns
      set starts_at = starts_at + interval '1 second'
    where id = sample_id;
    set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce immediate;
    raise exception 'accepted window';
  exception
    when others then
      if sqlerrm is distinct from 'invalid_quarter_key' then
        raise exception 'FAIL: window mismatch got %', sqlerrm;
      end if;
  end;
  set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce deferred;
  if (select starts_at from public.drawing_campaigns where id = sample_id)
       is distinct from '2027-01-01 06:00:00+00'::timestamptz then
    raise exception 'FAIL: window edit changed starts_at';
  end if;

  open_id := (public.save_drawing_campaign(pg_temp.drawing_payload(
    '2031-Q1', 'sample', 'v0', 12000, 2000, array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Gift card', 2, 5000, true)
  ))->>'id')::uuid;

  begin
    perform public.save_drawing_campaign(pg_temp.drawing_payload(
      '2031-Q1', 'live', 'rules-2031', 12000, 2000, array['level_milestone'],
      pg_temp.sample_prizes('Gift card', 2, 5000, false)
    ));
    raise exception 'accepted second open';
  exception
    when unique_violation then
      if position('drawing_campaigns_one_open_quarter_idx' in sqlerrm) = 0 then
        raise exception 'FAIL: duplicate quarter got %', sqlerrm;
      end if;
  end;

  update public.drawing_campaigns set status = 'active' where id = open_id;
  set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce immediate;
  set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce deferred;
  begin
    perform public.save_drawing_campaign(pg_temp.drawing_payload(
      '2031-Q1', 'sample', 'v0', 12000, 2000, array['level_milestone'],
      pg_temp.sample_prizes('Sample prize: Gift card', 2, 5000, true)
    ));
    raise exception 'accepted second active';
  exception
    when unique_violation then
      null;
  end;

  update public.drawing_campaigns set status = 'closed' where id = open_id;
  set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce immediate;
  set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce deferred;
  closed_ok := public.save_drawing_campaign(pg_temp.drawing_payload(
    '2031-Q1', 'sample', 'v0', 12000, 2000, array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Gift card', 2, 5000, true)
  ));
  if closed_ok->>'status' is distinct from 'draft'
     or (select count(*) from public.drawing_campaigns where quarter_key = '2031-Q1') <> 2
     or (select count(*) from public.drawing_campaigns
         where quarter_key = '2031-Q1' and status <> 'closed') <> 1 then
    raise exception 'FAIL: closed campaign still blocks the quarter';
  end if;

  if (select count(*) from public.drawing_campaigns where id = sample_id) <> 1
     or (select count(*) from public.drawing_campaign_prizes where campaign_id = sample_id) <> 1 then
    raise exception 'FAIL: original sample campaign was lost';
  end if;
end;
$$;

set local role anon;
do $$
begin
  begin
    perform count(*) from public.drawing_campaigns;
    raise exception 'anon read campaigns';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.drawing_campaign_prizes;
    raise exception 'anon read prizes';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.drawing_campaigns (
      quarter_key, mode, rules_version, total_budget_cents, fulfillment_allowance_cents,
      eligible_entry_sources, starts_at, ends_at
    ) values (
      '2034-Q1', 'sample', 'v0', 1, 0, array['level_milestone'], now(), now()
    );
    raise exception 'anon insert';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.drawing_campaigns set rules_version = 'anon';
    raise exception 'anon update';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.drawing_campaign_prizes;
    raise exception 'anon delete';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_drawing_campaign('{}'::jsonb);
    raise exception 'anon execute';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role authenticated;
do $$
begin
  begin
    perform count(*) from public.drawing_campaigns;
    raise exception 'authenticated read campaigns';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.drawing_campaign_prizes;
    raise exception 'authenticated read prizes';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.drawing_campaign_prizes (
      campaign_id, label, quantity, unit_value_cents, is_sample, position
    ) values (
      '00000000-0000-4000-8000-000000000001', 'x', 1, 1, true, 0
    );
    raise exception 'authenticated insert';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.drawing_campaign_prizes set label = 'authenticated';
    raise exception 'authenticated update';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.drawing_campaigns;
    raise exception 'authenticated delete';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_drawing_campaign('{}'::jsonb);
    raise exception 'authenticated execute';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

set local role service_role;
do $$
declare
  saved jsonb;
  seen integer;
begin
  saved := public.save_drawing_campaign(pg_temp.drawing_payload(
    '2035-Q1', 'sample', 'v0', 1000, 0, array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Sticker', 1, 1000, true)
  ));
  select count(*) into seen
  from public.drawing_campaigns
  where id = (saved->>'id')::uuid;
  if seen <> 1 then
    raise exception 'FAIL: service_role cannot read the campaign it saved';
  end if;
  update public.drawing_campaigns
    set rules_version = 'v1'
  where id = (saved->>'id')::uuid;
  set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce immediate;
  if (select rules_version from public.drawing_campaigns where id = (saved->>'id')::uuid) is distinct from 'v1' then
    raise exception 'FAIL: service_role update did not stick';
  end if;
  delete from public.drawing_campaigns where id = (saved->>'id')::uuid;
  set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce immediate;
  if (select count(*) from public.drawing_campaigns where id = (saved->>'id')::uuid) <> 0
     or (select count(*) from public.drawing_campaign_prizes where campaign_id = (saved->>'id')::uuid) <> 0 then
    raise exception 'FAIL: service_role delete left rows';
  end if;
end;
$$;

reset role;

rollback;
