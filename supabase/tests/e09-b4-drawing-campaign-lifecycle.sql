-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E09-B4: draft → active → closed through transition_drawing_campaign,
-- sample-only activation, and the edit lock on active and closed rows.
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

create function pg_temp.campaign_fingerprint(p_id uuid)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'quarter_key', c.quarter_key,
    'mode', c.mode,
    'rules_version', c.rules_version,
    'status', c.status,
    'total_budget_cents', c.total_budget_cents,
    'fulfillment_allowance_cents', c.fulfillment_allowance_cents,
    'eligible_entry_sources', to_jsonb(c.eligible_entry_sources),
    'starts_at', c.starts_at,
    'ends_at', c.ends_at,
    'activated_at', c.activated_at,
    'closed_at', c.closed_at,
    'prizes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'label', p.label,
        'quantity', p.quantity,
        'unit_value_cents', p.unit_value_cents,
        'is_sample', p.is_sample,
        'position', p.position
      ) order by p.position)
      from public.drawing_campaign_prizes p
      where p.campaign_id = c.id
    ), '[]'::jsonb)
  )
  from public.drawing_campaigns c
  where c.id = p_id;
$$;

do $$
declare
  sample_id uuid;
  live_id uuid;
  ended_id uuid;
  empty_id uuid;
  over_id uuid;
  direct_close_id uuid;
  direct_active_id uuid;
  before_fp jsonb;
  after_fp jsonb;
  saved jsonb;
  prize_id uuid;
  activated timestamptz;
  fn_definer boolean;
  fn_config text[];
begin
  if now() < '2026-10-01 05:00:00+00'::timestamptz then
    raise exception 'FAIL: clock is before the 2026-Q3 end';
  end if;
  if now() >= '2027-04-01 05:00:00+00'::timestamptz then
    raise exception 'FAIL: clock is at or after the 2027-Q1 end';
  end if;

  select p.prosecdef, p.proconfig
    into fn_definer, fn_config
  from pg_proc p
  where p.oid = 'public.transition_drawing_campaign(uuid, text)'::regprocedure;
  if fn_definer is not true
     or fn_config is distinct from array['search_path=pg_catalog, public'] then
    raise exception 'FAIL: transition_drawing_campaign must be security definer with a pinned search_path';
  end if;

  select p.prosecdef, p.proconfig
    into fn_definer, fn_config
  from pg_proc p
  where p.oid = 'public.save_drawing_campaign(jsonb)'::regprocedure;
  if fn_definer is true
     or fn_config is distinct from array['search_path=pg_catalog, public'] then
    raise exception 'FAIL: save_drawing_campaign must stay invoker with a pinned search_path';
  end if;

  if has_function_privilege('anon', 'public.transition_drawing_campaign(uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.transition_drawing_campaign(uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.transition_drawing_campaign(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.drawing_campaigns_lock()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.drawing_campaigns_lock()', 'EXECUTE')
     or has_function_privilege('anon', 'public.drawing_campaigns_transition_guard()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.drawing_campaigns_transition_guard()', 'EXECUTE') then
    raise exception 'FAIL: lifecycle function grants';
  end if;

  if (select count(*) from pg_trigger
      where tgname = 'drawing_campaigns_transition'
        and tgrelid = 'public.drawing_campaigns'::regclass
        and tgenabled = 'O'
        and tgdeferrable
        and tginitdeferred) <> 1 then
    raise exception 'FAIL: transition constraint is not deferred';
  end if;

  if (select count(*) from pg_trigger
      where tgname in ('drawing_campaigns_lock', 'drawing_campaign_prizes_lock')
        and tgenabled = 'O'
        and not tgdeferrable) <> 2 then
    raise exception 'FAIL: edit lock triggers';
  end if;

  if exists (
    select 1
    from pg_attribute
    where attrelid = 'public.drawing_campaigns'::regclass
      and attname in ('activated_at', 'closed_at')
      and atttypid <> 'timestamptz'::regtype
  ) or (
    select count(*) from pg_attribute
    where attrelid = 'public.drawing_campaigns'::regclass
      and attname in ('activated_at', 'closed_at')
      and not attisdropped
  ) <> 2 then
    raise exception 'FAIL: activated_at and closed_at columns';
  end if;

  saved := public.save_drawing_campaign(pg_temp.drawing_payload(
    '2027-Q1', 'sample', 'v0', 12000, 2000, array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Gift card', 2, 5000, true)
  ));
  sample_id := (saved->>'id')::uuid;
  before_fp := pg_temp.campaign_fingerprint(sample_id);
  saved := public.transition_drawing_campaign(sample_id, 'active');
  if saved->>'status' is distinct from 'active'
     or saved->>'activated_at' is null
     or saved->>'closed_at' is not null
     or saved->>'quarter_key' is distinct from '2027-Q1'
     or saved->>'mode' is distinct from 'sample'
     or saved->>'rules_version' is distinct from 'v0'
     or (saved->>'total_budget_cents')::bigint <> 12000
     or (saved->'prizes'->0->>'id') is distinct from (before_fp->'prizes'->0->>'id')
     or (saved->'prizes'->0->>'quantity')::bigint <> 2 then
    raise exception 'FAIL: activation shape %', saved;
  end if;
  after_fp := pg_temp.campaign_fingerprint(sample_id);
  if after_fp->>'quarter_key' is distinct from before_fp->>'quarter_key'
     or after_fp->>'mode' is distinct from before_fp->>'mode'
     or after_fp->>'rules_version' is distinct from before_fp->>'rules_version'
     or after_fp->>'total_budget_cents' is distinct from before_fp->>'total_budget_cents'
     or after_fp->>'fulfillment_allowance_cents' is distinct from before_fp->>'fulfillment_allowance_cents'
     or after_fp->>'eligible_entry_sources' is distinct from before_fp->>'eligible_entry_sources'
     or after_fp->>'starts_at' is distinct from before_fp->>'starts_at'
     or after_fp->>'ends_at' is distinct from before_fp->>'ends_at'
     or after_fp->'prizes' is distinct from before_fp->'prizes'
     or after_fp->>'activated_at' is null
     or after_fp->>'closed_at' is not null then
    raise exception 'FAIL: activation changed the stored campaign %', after_fp;
  end if;
  activated := (after_fp->>'activated_at')::timestamptz;

  before_fp := pg_temp.campaign_fingerprint(sample_id);
  begin
    perform public.save_drawing_campaign(
      pg_temp.drawing_payload(
        '2027-Q1', 'sample', 'v1', 12000, 2000, array['level_milestone'],
        pg_temp.sample_prizes('Sample prize: Gift card', 2, 5000, true)
      ) || jsonb_build_object('id', sample_id)
    );
    raise exception 'accepted save';
  exception
    when others then
      if sqlerrm is distinct from 'campaign_locked' and sqlerrm is distinct from 'accepted save' then
        raise exception 'FAIL: active save got %', sqlerrm;
      end if;
      if sqlerrm = 'accepted save' then
        raise exception 'FAIL: active save was accepted';
      end if;
  end;
  if pg_temp.campaign_fingerprint(sample_id) is distinct from before_fp then
    raise exception 'FAIL: active save changed the row';
  end if;

  prize_id := (before_fp->'prizes'->0->>'id')::uuid;
  begin
    update public.drawing_campaign_prizes
      set quantity = quantity + 1
    where id = prize_id;
    raise exception 'accepted prize update';
  exception
    when others then
      if sqlerrm is distinct from 'campaign_locked' then
        raise exception 'FAIL: prize update got %', sqlerrm;
      end if;
  end;
  begin
    insert into public.drawing_campaign_prizes (
      campaign_id, label, quantity, unit_value_cents, is_sample, position
    ) values (
      sample_id, 'Sample prize: Extra', 1, 100, true, 1
    );
    raise exception 'accepted prize insert';
  exception
    when others then
      if sqlerrm is distinct from 'campaign_locked' then
        raise exception 'FAIL: prize insert got %', sqlerrm;
      end if;
  end;
  begin
    delete from public.drawing_campaign_prizes where id = prize_id;
    raise exception 'accepted prize delete';
  exception
    when others then
      if sqlerrm is distinct from 'campaign_locked' then
        raise exception 'FAIL: prize delete got %', sqlerrm;
      end if;
  end;
  begin
    update public.drawing_campaigns
      set total_budget_cents = total_budget_cents - 1,
          mode = 'live',
          quarter_key = '2027-Q2',
          rules_version = 'changed',
          fulfillment_allowance_cents = 0,
          eligible_entry_sources = array['recipe']::text[],
          starts_at = starts_at + interval '1 second',
          ends_at = ends_at + interval '1 second'
    where id = sample_id;
    raise exception 'accepted field update';
  exception
    when others then
      if sqlerrm is distinct from 'campaign_locked' then
        raise exception 'FAIL: locked field update got %', sqlerrm;
      end if;
  end;
  begin
    delete from public.drawing_campaigns where id = sample_id;
    raise exception 'accepted campaign delete';
  exception
    when others then
      if sqlerrm is distinct from 'campaign_locked' then
        raise exception 'FAIL: campaign delete got %', sqlerrm;
      end if;
  end;
  if pg_temp.campaign_fingerprint(sample_id) is distinct from before_fp then
    raise exception 'FAIL: locked writes changed the active campaign';
  end if;

  saved := public.transition_drawing_campaign(sample_id, 'closed');
  if saved->>'status' is distinct from 'closed'
     or saved->>'activated_at' is distinct from before_fp->>'activated_at'
     or saved->>'closed_at' is null
     or (saved->'prizes'->0->>'quantity')::bigint <> 2
     or saved->>'rules_version' is distinct from 'v0' then
    raise exception 'FAIL: close shape %', saved;
  end if;
  if (select activated_at from public.drawing_campaigns where id = sample_id) is distinct from activated then
    raise exception 'FAIL: close moved activated_at';
  end if;

  before_fp := pg_temp.campaign_fingerprint(sample_id);
  begin
    perform public.transition_drawing_campaign(sample_id, 'active');
    raise exception 'accepted reopen';
  exception
    when others then
      if sqlerrm is distinct from 'invalid_transition' then
        raise exception 'FAIL: reopen got %', sqlerrm;
      end if;
  end;
  begin
    perform public.transition_drawing_campaign(sample_id, 'closed');
    raise exception 'accepted reclose';
  exception
    when others then
      if sqlerrm is distinct from 'invalid_transition' then
        raise exception 'FAIL: reclose got %', sqlerrm;
      end if;
  end;
  begin
    update public.drawing_campaigns set rules_version = 'closed-edit' where id = sample_id;
    raise exception 'accepted closed edit';
  exception
    when others then
      if sqlerrm is distinct from 'campaign_locked' then
        raise exception 'FAIL: closed edit got %', sqlerrm;
      end if;
  end;
  begin
    update public.drawing_campaigns set status = 'draft' where id = sample_id;
    set constraints drawing_campaigns_transition immediate;
    raise exception 'accepted closed to draft';
  exception
    when others then
      if sqlerrm is distinct from 'invalid_transition' then
        raise exception 'FAIL: closed to draft got %', sqlerrm;
      end if;
  end;
  set constraints drawing_campaigns_transition deferred;
  if pg_temp.campaign_fingerprint(sample_id) is distinct from before_fp then
    raise exception 'FAIL: closed campaign changed';
  end if;

  saved := public.save_drawing_campaign(pg_temp.drawing_payload(
    '2027-Q2', 'live', 'rules-2027-04', 12000, 2000, array['level_milestone'],
    pg_temp.sample_prizes('Gift card', 2, 5000, false)
  ));
  live_id := (saved->>'id')::uuid;
  begin
    perform public.transition_drawing_campaign(live_id, 'active');
    raise exception 'accepted live activation';
  exception
    when others then
      if sqlerrm is distinct from 'live_activation_blocked' then
        raise exception 'FAIL: live activation got %', sqlerrm;
      end if;
  end;
  if (select status from public.drawing_campaigns where id = live_id) is distinct from 'draft' then
    raise exception 'FAIL: live activation changed status';
  end if;
  saved := public.save_drawing_campaign(
    pg_temp.drawing_payload(
      '2027-Q2', 'live', 'rules-2027-04-b', 12000, 2000, array['level_milestone'],
      pg_temp.sample_prizes('Gift card', 2, 5000, false)
    ) || jsonb_build_object('id', live_id)
  );
  if saved->>'status' is distinct from 'draft'
     or saved->>'rules_version' is distinct from 'rules-2027-04-b' then
    raise exception 'FAIL: live draft edit %', saved;
  end if;

  saved := public.save_drawing_campaign(pg_temp.drawing_payload(
    '2026-Q3', 'sample', 'v0', 12000, 2000, array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Gift card', 2, 5000, true)
  ));
  ended_id := (saved->>'id')::uuid;
  begin
    perform public.transition_drawing_campaign(ended_id, 'active');
    raise exception 'accepted ended window';
  exception
    when others then
      if sqlerrm is distinct from 'campaign_window_ended' then
        raise exception 'FAIL: ended window got %', sqlerrm;
      end if;
  end;
  if (select status from public.drawing_campaigns where id = ended_id) is distinct from 'draft' then
    raise exception 'FAIL: ended activation changed status';
  end if;

  alter table public.drawing_campaigns disable trigger drawing_campaigns_enforce;
  alter table public.drawing_campaign_prizes disable trigger drawing_campaign_prizes_enforce;
  insert into public.drawing_campaigns (
    quarter_key, mode, rules_version, status, total_budget_cents, fulfillment_allowance_cents,
    eligible_entry_sources, starts_at, ends_at
  ) values (
    '2028-Q1', 'sample', 'v0', 'draft', 1000, 0, array['level_milestone'],
    make_timestamptz(2028, 1, 1, 0, 0, 0, 'America/Chicago'),
    make_timestamptz(2028, 4, 1, 0, 0, 0, 'America/Chicago')
  )
  returning id into empty_id;
  alter table public.drawing_campaigns enable trigger drawing_campaigns_enforce;
  alter table public.drawing_campaign_prizes enable trigger drawing_campaign_prizes_enforce;
  begin
    perform public.transition_drawing_campaign(empty_id, 'active');
    raise exception 'accepted no prizes';
  exception
    when others then
      if sqlerrm is distinct from 'no_prizes' then
        raise exception 'FAIL: no prizes got %', sqlerrm;
      end if;
  end;
  if (select status from public.drawing_campaigns where id = empty_id) is distinct from 'draft'
     or (select count(*) from public.drawing_campaign_prizes where campaign_id = empty_id) <> 0 then
    raise exception 'FAIL: no-prize activation wrote a prize or status';
  end if;

  saved := public.save_drawing_campaign(pg_temp.drawing_payload(
    '2028-Q2', 'sample', 'v0', 12000, 2000, array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Gift card', 2, 5000, true)
  ));
  over_id := (saved->>'id')::uuid;
  alter table public.drawing_campaigns disable trigger drawing_campaigns_enforce;
  update public.drawing_campaigns set total_budget_cents = 1 where id = over_id;
  alter table public.drawing_campaigns enable trigger drawing_campaigns_enforce;
  begin
    perform public.transition_drawing_campaign(over_id, 'active');
    raise exception 'accepted over budget';
  exception
    when others then
      if sqlerrm is distinct from 'over_budget' then
        raise exception 'FAIL: activation over_budget got %', sqlerrm;
      end if;
  end;
  if (select status from public.drawing_campaigns where id = over_id) is distinct from 'draft' then
    raise exception 'FAIL: over-budget activation changed status';
  end if;

  saved := public.save_drawing_campaign(pg_temp.drawing_payload(
    '2029-Q1', 'sample', 'v0', 1000, 0, array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Sticker', 1, 1000, true)
  ));
  direct_close_id := (saved->>'id')::uuid;
  update public.drawing_campaigns set status = 'closed' where id = direct_close_id;
  set constraints drawing_campaigns_transition immediate;
  set constraints drawing_campaigns_transition deferred;
  if (select status from public.drawing_campaigns where id = direct_close_id) is distinct from 'closed'
     or (select closed_at from public.drawing_campaigns where id = direct_close_id) is not null
     or (select activated_at from public.drawing_campaigns where id = direct_close_id) is not null then
    raise exception 'FAIL: direct draft close';
  end if;
  saved := public.save_drawing_campaign(pg_temp.drawing_payload(
    '2029-Q1', 'sample', 'v0', 1000, 0, array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Sticker', 1, 1000, true)
  ));
  if saved->>'status' is distinct from 'draft' then
    raise exception 'FAIL: direct close still blocks the quarter';
  end if;

  saved := public.save_drawing_campaign(pg_temp.drawing_payload(
    '2030-Q1', 'sample', 'v0', 1000, 0, array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Sticker', 1, 1000, true)
  ));
  direct_active_id := (saved->>'id')::uuid;
  before_fp := pg_temp.campaign_fingerprint(direct_active_id);
  begin
    update public.drawing_campaigns set status = 'active' where id = direct_active_id;
    set constraints drawing_campaigns_transition immediate;
    raise exception 'accepted direct activation';
  exception
    when others then
      if sqlerrm is distinct from 'invalid_transition' then
        raise exception 'FAIL: direct activation got %', sqlerrm;
      end if;
  end;
  set constraints drawing_campaigns_transition deferred;
  if pg_temp.campaign_fingerprint(direct_active_id) is distinct from before_fp then
    raise exception 'FAIL: direct activation changed the draft';
  end if;

  saved := public.save_drawing_campaign(pg_temp.drawing_payload(
    '2031-Q1', 'sample', 'v0', 1000, 0, array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Sticker', 1, 1000, true)
  ));
  saved := public.transition_drawing_campaign((saved->>'id')::uuid, 'active');
  if saved->>'status' is distinct from 'active' then
    raise exception 'FAIL: 2031-Q1 did not activate';
  end if;
  before_fp := pg_temp.campaign_fingerprint((saved->>'id')::uuid);
  begin
    update public.drawing_campaigns set status = 'draft' where id = (saved->>'id')::uuid;
    set constraints drawing_campaigns_transition immediate;
    raise exception 'accepted active to draft';
  exception
    when others then
      if sqlerrm is distinct from 'invalid_transition' then
        raise exception 'FAIL: active to draft got %', sqlerrm;
      end if;
  end;
  set constraints drawing_campaigns_transition deferred;
  if pg_temp.campaign_fingerprint((saved->>'id')::uuid) is distinct from before_fp
     or (select status from public.drawing_campaigns where quarter_key = '2031-Q1') is distinct from 'active' then
    raise exception 'FAIL: active to draft changed the row';
  end if;

  begin
    perform public.save_drawing_campaign(pg_temp.drawing_payload(
      '2030-Q1', 'sample', 'v0', 1000, 0, array['level_milestone'],
      pg_temp.sample_prizes('Sample prize: Sticker', 1, 1000, true)
    ));
    raise exception 'accepted second open';
  exception
    when unique_violation then
      if position('quarter_campaign_open' in sqlerrm) = 0
         or position('drawing_campaigns_one_open_quarter_idx' in sqlerrm) = 0 then
        raise exception 'FAIL: second open got %', sqlerrm;
      end if;
  end;
  begin
    insert into public.drawing_campaigns (
      quarter_key, mode, rules_version, total_budget_cents, fulfillment_allowance_cents,
      eligible_entry_sources, starts_at, ends_at
    ) values (
      '2030-Q1', 'sample', 'v0', 1000, 0, array['level_milestone'],
      make_timestamptz(2030, 1, 1, 0, 0, 0, 'America/Chicago'),
      make_timestamptz(2030, 4, 1, 0, 0, 0, 'America/Chicago')
    );
    raise exception 'accepted direct second open';
  exception
    when unique_violation then
      if position('drawing_campaigns_one_open_quarter_idx' in sqlerrm) = 0 then
        raise exception 'FAIL: direct second open got %', sqlerrm;
      end if;
  end;
  if (select count(*) from public.drawing_campaigns
      where quarter_key = '2030-Q1' and status <> 'closed') <> 1 then
    raise exception 'FAIL: two open campaigns for one quarter';
  end if;

  begin
    perform public.transition_drawing_campaign('00000000-0000-4000-8000-000000000099', 'active');
    raise exception 'accepted missing';
  exception
    when others then
      if sqlerrm is distinct from 'not_found' then
        raise exception 'FAIL: missing campaign got %', sqlerrm;
      end if;
  end;

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
      and p.prosrc ilike '%transition_drawing_campaign%'
  ) then
    raise exception 'FAIL: progression or verify SQL calls the campaign transition';
  end if;
end;
$$;

set local role anon;
do $$
begin
  begin
    perform public.transition_drawing_campaign('00000000-0000-4000-8000-000000000099', 'active');
    raise exception 'anon transition';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.drawing_campaigns set rules_version = 'anon';
    raise exception 'anon update';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.drawing_campaign_prizes (
      campaign_id, label, quantity, unit_value_cents, is_sample, position
    ) values (
      '00000000-0000-4000-8000-000000000099', 'x', 1, 1, true, 0
    );
    raise exception 'anon prize insert';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role authenticated;
do $$
begin
  begin
    perform public.transition_drawing_campaign('00000000-0000-4000-8000-000000000099', 'closed');
    raise exception 'authenticated transition';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.drawing_campaigns;
    raise exception 'authenticated delete';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.drawing_campaign_prizes set label = 'authenticated';
    raise exception 'authenticated prize update';
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
    '2036-Q1', 'sample', 'v0', 1000, 0, array['level_milestone'],
    pg_temp.sample_prizes('Sample prize: Sticker', 1, 1000, true)
  ));
  saved := public.transition_drawing_campaign((saved->>'id')::uuid, 'active');
  if saved->>'status' is distinct from 'active' then
    raise exception 'FAIL: service_role activation %', saved;
  end if;
  select count(*) into seen
  from public.drawing_campaigns
  where id = (saved->>'id')::uuid
    and status = 'active';
  if seen <> 1 then
    raise exception 'FAIL: service_role cannot read the campaign it activated';
  end if;
  begin
    update public.drawing_campaign_prizes
      set label = 'Sample prize: Changed'
    where campaign_id = (saved->>'id')::uuid;
    raise exception 'service_role edited a prize';
  exception
    when others then
      if sqlerrm is distinct from 'campaign_locked' then
        raise exception 'FAIL: service_role prize edit got %', sqlerrm;
      end if;
  end;
  saved := public.transition_drawing_campaign((saved->>'id')::uuid, 'closed');
  if saved->>'status' is distinct from 'closed' then
    raise exception 'FAIL: service_role close %', saved;
  end if;
end;
$$;

reset role;

rollback;
