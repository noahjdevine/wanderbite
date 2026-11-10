-- E09-B4 drawing campaign lifecycle.
-- Not applied to hosted. Do not run supabase db push for this file.
-- A campaign moves draft → active → closed only through
-- transition_drawing_campaign, plus a direct draft → closed.
-- Active and closed rows lock quarter, mode, rules version, budget,
-- entry sources, the quarter window, and prizes.
-- Activation in this slice allows mode sample only. A later migration
-- can allow live. database.types.ts is unchanged. Progression tables,
-- verify RPCs, and the A3 caller are unchanged.
-- E09_PROGRESSION_LEDGER_ENABLED and E09_MEMBER_PROGRESSION_UI_ENABLED
-- stay unset.
-- Rollback before a hosted apply is reverting this migration. After a
-- hosted apply, roll forward by dropping transition_drawing_campaign,
-- the lock and transition triggers, activated_at, and closed_at, and
-- restoring save_drawing_campaign from 20261110214500.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.drawing_campaigns
  add column activated_at timestamptz,
  add column closed_at timestamptz;

comment on column public.drawing_campaigns.activated_at is
  'Set by transition_drawing_campaign when a draft becomes active. Null on a draft, and still null when a draft is closed without activation. Not cleared when the campaign is later closed.';

comment on column public.drawing_campaigns.closed_at is
  'Set by transition_drawing_campaign when status becomes closed. A direct draft → closed update is allowed and does not stamp this column.';

-- Rejects configuration and prize writes once the stored status is
-- active or closed. Status changes are a separate deferred constraint:
-- a direct update can see the new status inside an open transaction,
-- and commit rejects any change that skips transition_drawing_campaign
-- other than draft → closed.
create or replace function public.drawing_campaigns_lock()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  campaign_status text;
  campaign_id uuid;
  via_rpc text;
begin
  if tg_table_name = 'drawing_campaign_prizes' then
    if tg_op = 'DELETE' then
      campaign_id := old.campaign_id;
    else
      campaign_id := new.campaign_id;
    end if;
    select status
      into campaign_status
    from public.drawing_campaigns
    where id = campaign_id;
    if campaign_status in ('active', 'closed') then
      raise exception 'campaign_locked' using errcode = 'P0001';
    end if;
    if tg_op = 'UPDATE' and new.campaign_id is distinct from old.campaign_id then
      select status
        into campaign_status
      from public.drawing_campaigns
      where id = old.campaign_id;
      if campaign_status in ('active', 'closed') then
        raise exception 'campaign_locked' using errcode = 'P0001';
      end if;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status in ('active', 'closed') then
      raise exception 'campaign_locked' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.status in ('active', 'closed') then
    if new.quarter_key is distinct from old.quarter_key
       or new.mode is distinct from old.mode
       or new.rules_version is distinct from old.rules_version
       or new.total_budget_cents is distinct from old.total_budget_cents
       or new.fulfillment_allowance_cents is distinct from old.fulfillment_allowance_cents
       or new.eligible_entry_sources is distinct from old.eligible_entry_sources
       or new.starts_at is distinct from old.starts_at
       or new.ends_at is distinct from old.ends_at
    then
      raise exception 'campaign_locked' using errcode = 'P0001';
    end if;
    if new.activated_at is distinct from old.activated_at
       or new.closed_at is distinct from old.closed_at
    then
      via_rpc := pg_catalog.current_setting('wanderbite.drawing_campaign_transition', true);
      if via_rpc is distinct from new.id::text then
        raise exception 'campaign_locked' using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.drawing_campaigns_lock()
  from public, anon, authenticated, service_role;

comment on function public.drawing_campaigns_lock() is
  'Immediate edit lock for an active or closed drawing campaign and its prizes. service_role table grants still pass through this trigger. Does not read progression tables.';

create trigger drawing_campaigns_lock
  before update or delete on public.drawing_campaigns
  for each row execute function public.drawing_campaigns_lock();

create trigger drawing_campaign_prizes_lock
  before insert or update or delete on public.drawing_campaign_prizes
  for each row execute function public.drawing_campaigns_lock();

create or replace function public.drawing_campaigns_transition_guard()
returns trigger
language plpgsql
set search_path to pg_catalog, public
as $$
declare
  via_rpc text;
  allowed boolean;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  via_rpc := pg_catalog.current_setting('wanderbite.drawing_campaign_transition', true);
  allowed :=
    (old.status = 'draft' and new.status = 'closed')
    or (
      via_rpc is not distinct from new.id::text
      and (
        (old.status = 'draft' and new.status = 'active')
        or (old.status = 'active' and new.status = 'closed')
        or (old.status = 'draft' and new.status = 'closed')
      )
    );

  if not allowed then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.drawing_campaigns_transition_guard()
  from public, anon, authenticated, service_role;

comment on function public.drawing_campaigns_transition_guard() is
  'Deferred status guard. draft → closed may commit from direct SQL. draft → active and active → closed commit only from transition_drawing_campaign. closed → anything and active → draft do not commit.';

create constraint trigger drawing_campaigns_transition
  after update on public.drawing_campaigns
  deferrable initially deferred
  for each row
  when (old.status is distinct from new.status)
  execute function public.drawing_campaigns_transition_guard();

create or replace function public.drawing_campaign_as_json(p_id uuid)
returns jsonb
language sql
stable
set search_path to pg_catalog, public
as $$
  select pg_catalog.jsonb_build_object(
    'id', c.id,
    'quarter_key', c.quarter_key,
    'mode', c.mode,
    'rules_version', c.rules_version,
    'status', c.status,
    'total_budget_cents', c.total_budget_cents,
    'fulfillment_allowance_cents', c.fulfillment_allowance_cents,
    'eligible_entry_sources', pg_catalog.to_jsonb(c.eligible_entry_sources),
    'starts_at', c.starts_at,
    'ends_at', c.ends_at,
    'activated_at', c.activated_at,
    'closed_at', c.closed_at,
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'prizes', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', p.id,
          'campaign_id', p.campaign_id,
          'label', p.label,
          'quantity', p.quantity,
          'unit_value_cents', p.unit_value_cents,
          'is_sample', p.is_sample,
          'position', p.position
        )
        order by p.position
      )
      from public.drawing_campaign_prizes p
      where p.campaign_id = c.id
    ), '[]'::jsonb)
  )
  from public.drawing_campaigns c
  where c.id = p_id;
$$;

revoke all on function public.drawing_campaign_as_json(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.drawing_campaign_as_json(uuid) to service_role;

-- Same writer as E09-B3, plus the active/closed edit lock. A duplicate
-- open quarter is reported as quarter_campaign_open and keeps SQLSTATE
-- 23505 so the partial unique index remains the constraint that fires.
create or replace function public.save_drawing_campaign(p_payload jsonb)
returns jsonb
language plpgsql
set search_path to pg_catalog, public
as $$
declare
  v_id uuid;
  v_mode text;
  v_quarter_key text;
  v_rules_version text;
  v_status text;
  v_total bigint;
  v_fulfillment bigint;
  v_sources text[] := '{}';
  v_starts timestamptz;
  v_ends timestamptz;
  v_prize jsonb;
  v_elem jsonb;
  v_label text;
  v_quantity bigint;
  v_unit bigint;
  v_is_sample boolean;
  v_position integer := 0;
  v_saved jsonb;
begin
  if pg_catalog.jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'invalid_mode' using errcode = 'P0001';
  end if;

  -- Keep intermediate prize deletes deferred, then check the final rows
  -- before return. Set them deferred again so this call does not leave the
  -- caller's transaction in immediate mode.
  set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce deferred;

  v_quarter_key := p_payload->>'quarter_key';
  v_mode := p_payload->>'mode';
  v_rules_version := coalesce(p_payload->>'rules_version', '');

  if v_quarter_key is null then
    raise exception 'invalid_quarter_key' using errcode = 'P0001';
  end if;
  if v_mode is null then
    raise exception 'invalid_mode' using errcode = 'P0001';
  end if;

  v_total := public.drawing_campaign_json_int(p_payload->'total_budget_cents', 'cents');
  v_fulfillment := public.drawing_campaign_json_int(p_payload->'fulfillment_allowance_cents', 'cents');

  if pg_catalog.jsonb_typeof(p_payload->'starts_at') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_payload->'ends_at') is distinct from 'string' then
    raise exception 'invalid_quarter_key' using errcode = 'P0001';
  end if;

  begin
    v_starts := (p_payload->>'starts_at')::timestamptz;
    v_ends := (p_payload->>'ends_at')::timestamptz;
  exception
    when invalid_datetime_format or datetime_field_overflow then
      raise exception 'invalid_quarter_key' using errcode = 'P0001';
  end;

  if pg_catalog.jsonb_typeof(p_payload->'eligible_entry_sources') is distinct from 'array' then
    v_sources := '{}';
  else
    for v_elem in
      select value from pg_catalog.jsonb_array_elements(p_payload->'eligible_entry_sources')
    loop
      if pg_catalog.jsonb_typeof(v_elem) is distinct from 'string' then
        raise exception 'unknown_entry_source' using errcode = 'P0001';
      end if;
      v_sources := v_sources || (v_elem #>> '{}');
    end loop;
  end if;

  begin
    if p_payload->>'id' is not null and p_payload->>'id' <> '' then
      v_id := (p_payload->>'id')::uuid;
      select status
        into v_status
      from public.drawing_campaigns
      where id = v_id
      for update;
      if not found then
        raise exception 'not_found' using errcode = 'P0002';
      end if;
      if v_status in ('active', 'closed') then
        raise exception 'campaign_locked' using errcode = 'P0001';
      end if;
      update public.drawing_campaigns
        set quarter_key = v_quarter_key,
            mode = v_mode,
            rules_version = v_rules_version,
            total_budget_cents = v_total,
            fulfillment_allowance_cents = v_fulfillment,
            eligible_entry_sources = v_sources,
            starts_at = v_starts,
            ends_at = v_ends
      where id = v_id;
      if not found then
        raise exception 'not_found' using errcode = 'P0002';
      end if;
      delete from public.drawing_campaign_prizes where campaign_id = v_id;
    else
      insert into public.drawing_campaigns (
        quarter_key,
        mode,
        rules_version,
        status,
        total_budget_cents,
        fulfillment_allowance_cents,
        eligible_entry_sources,
        starts_at,
        ends_at
      ) values (
        v_quarter_key,
        v_mode,
        v_rules_version,
        'draft',
        v_total,
        v_fulfillment,
        v_sources,
        v_starts,
        v_ends
      )
      returning id into v_id;
    end if;

    if pg_catalog.jsonb_typeof(p_payload->'prizes') = 'array' then
      for v_prize in
        select value from pg_catalog.jsonb_array_elements(p_payload->'prizes')
      loop
        v_label := coalesce(v_prize->>'label', '');
        v_quantity := public.drawing_campaign_json_int(v_prize->'quantity', 'quantity');
        v_unit := public.drawing_campaign_json_int(v_prize->'unit_value_cents', 'cents');
        if pg_catalog.jsonb_typeof(v_prize->'is_sample') is distinct from 'boolean' then
          if v_mode is distinct from 'live' then
            raise exception 'sample_prize_required' using errcode = 'P0001';
          end if;
          if v_prize->'is_sample' = 'true'::jsonb then
            raise exception 'live_sample_prize' using errcode = 'P0001';
          end if;
          v_is_sample := false;
        else
          v_is_sample := (v_prize->>'is_sample')::boolean;
        end if;
        insert into public.drawing_campaign_prizes (
          campaign_id,
          label,
          quantity,
          unit_value_cents,
          is_sample,
          position
        ) values (
          v_id,
          v_label,
          v_quantity,
          v_unit,
          v_is_sample,
          v_position
        );
        v_position := v_position + 1;
      end loop;
    end if;
  exception
    when unique_violation then
      if pg_catalog.strpos(sqlerrm, 'drawing_campaigns_one_open_quarter_idx') > 0 then
        raise exception 'quarter_campaign_open: drawing_campaigns_one_open_quarter_idx'
          using errcode = '23505';
      end if;
      raise;
  end;

  set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce immediate;
  set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce deferred;

  v_saved := public.drawing_campaign_as_json(v_id);
  if v_saved is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v_saved;
end;
$$;

comment on function public.save_drawing_campaign(jsonb) is
  'Inserts or replaces one drawing campaign and its prizes in one transaction. Refuses the replace when the stored status is active or closed. service_role only. Does not select winners, read progression tables, or expose the row to members.';

create or replace function public.transition_drawing_campaign(
  p_campaign_id uuid,
  p_to_status text
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  camp public.drawing_campaigns%rowtype;
  prize_count bigint;
  saved jsonb;
begin
  if p_campaign_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select *
    into camp
  from public.drawing_campaigns
  where id = p_campaign_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_to_status is null
     or (
       not (camp.status = 'draft' and p_to_status = 'active')
       and not (camp.status = 'active' and p_to_status = 'closed')
       and not (camp.status = 'draft' and p_to_status = 'closed')
     )
  then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  if camp.status = 'draft' and p_to_status = 'active' then
    if camp.mode is distinct from 'sample' then
      raise exception 'live_activation_blocked' using errcode = 'P0001';
    end if;
    if pg_catalog.now() >= camp.ends_at then
      raise exception 'campaign_window_ended' using errcode = 'P0001';
    end if;
    select count(*)
      into prize_count
    from public.drawing_campaign_prizes
    where campaign_id = camp.id;
    if prize_count = 0 then
      raise exception 'no_prizes' using errcode = 'P0001';
    end if;
    if exists (
      select 1
      from public.drawing_campaigns other
      where other.quarter_key = camp.quarter_key
        and other.status <> 'closed'
        and other.id <> camp.id
    ) then
      raise exception 'quarter_campaign_open: drawing_campaigns_one_open_quarter_idx'
        using errcode = '23505';
    end if;
    -- Re-check the stored budget after the prize count. drawing_campaign_reject
    -- raises over_budget when committed cents exceed the total. A draft that
    -- already committed passed this check; activation runs it again.
    perform public.drawing_campaign_reject(camp.id);
  end if;

  perform pg_catalog.set_config(
    'wanderbite.drawing_campaign_transition',
    camp.id::text,
    true
  );

  begin
    update public.drawing_campaigns
      set status = p_to_status,
          activated_at = case
            when camp.status = 'draft' and p_to_status = 'active' then pg_catalog.now()
            else activated_at
          end,
          closed_at = case
            when p_to_status = 'closed' then pg_catalog.now()
            else closed_at
          end
    where id = camp.id;
  exception
    when unique_violation then
      raise exception 'quarter_campaign_open: drawing_campaigns_one_open_quarter_idx'
        using errcode = '23505';
  end;

  set constraints drawing_campaigns_transition immediate;
  set constraints drawing_campaigns_transition deferred;

  saved := public.drawing_campaign_as_json(camp.id);
  if saved is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return saved;
end;
$$;

revoke all on function public.transition_drawing_campaign(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.transition_drawing_campaign(uuid, text) to service_role;

comment on function public.transition_drawing_campaign(uuid, text) is
  'Moves one drawing campaign draft → active, active → closed, or draft → closed. Activation requires mode sample, a still-open quarter window, at least one prize, and committed cents at or under the total. service_role only. Does not select winners or read progression tables.';
