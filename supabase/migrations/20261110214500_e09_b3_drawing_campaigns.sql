-- E09-B3 drawing campaign storage.
-- Not applied to hosted. Do not run supabase db push for this file.
-- Sample and live campaigns can be stored. Nothing reads these tables.
-- Storing a live campaign does not show it to members and does not select winners.
-- database.types.ts is unchanged. Progression tables, verify RPCs, and the
-- A3 caller are unchanged. E09_PROGRESSION_LEDGER_ENABLED and
-- E09_MEMBER_PROGRESSION_UI_ENABLED stay unset.
-- Rollback before a hosted apply is reverting this migration. After a hosted
-- apply, roll forward by dropping the two tables, the triggers, and
-- save_drawing_campaign(jsonb).

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.drawing_campaigns (
  id uuid primary key default gen_random_uuid(),
  -- YYYY-Qn. The Chicago quarter of starts_at, checked with drawing_campaign_reject.
  quarter_key text not null,
  mode text not null,
  -- Version token only. Not the rules text.
  rules_version text not null,
  status text not null default 'draft',
  -- Unconstrained numeric so a fractional insert is still visible to the
  -- trigger. numeric(n, 0) would round it before the check.
  total_budget_cents numeric not null,
  fulfillment_allowance_cents numeric not null,
  eligible_entry_sources text[] not null,
  -- Inclusive America/Chicago quarter start, and exclusive quarter end.
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drawing_campaigns_status_check
    check (status in ('draft', 'active', 'closed'))
);

-- One open configuration per quarter. A closed row does not count.
-- This index is the only writer of that rule.
create unique index drawing_campaigns_one_open_quarter_idx
  on public.drawing_campaigns (quarter_key)
  where status <> 'closed';

comment on table public.drawing_campaigns is
  'Quarterly drawing configuration. Committed cents are prize quantity times unit value, plus the fulfillment allowance, and must not exceed total_budget_cents. service_role only. Not read by members.';

comment on column public.drawing_campaigns.eligible_entry_sources is
  'Only level_milestone is accepted. Public reviews, QR issuance, and recipes are rejected.';

comment on column public.drawing_campaigns.mode is
  'sample or live. A stored live row is not a member-visible drawing and does not select winners.';

create table public.drawing_campaign_prizes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.drawing_campaigns (id) on delete cascade,
  label text not null,
  quantity numeric not null,
  unit_value_cents numeric not null,
  is_sample boolean not null,
  position integer not null,
  constraint drawing_campaign_prizes_position_key unique (campaign_id, position),
  constraint drawing_campaign_prizes_position_check
    check (position >= 0)
);

-- Unique (campaign_id, position) leads with campaign_id, so it covers the
-- campaign_id foreign key.

comment on table public.drawing_campaign_prizes is
  'Prizes for one drawing campaign. Sample mode requires is_sample and a label containing Sample prize. Live mode rejects is_sample.';

create or replace function public.set_drawing_campaigns_updated_at()
returns trigger
language plpgsql
set search_path to pg_catalog
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create trigger set_drawing_campaigns_updated_at_trigger
  before update on public.drawing_campaigns
  for each row execute function public.set_drawing_campaigns_updated_at();

revoke all on function public.set_drawing_campaigns_updated_at()
  from public, anon, authenticated, service_role;

-- Raises one B1 code from src/lib/drawings/campaign.ts. Called at commit by
-- the deferred constraint triggers, including a direct SQL write that never
-- goes through save_drawing_campaign.
create or replace function public.drawing_campaign_reject(p_campaign_id uuid)
returns void
language plpgsql
set search_path to pg_catalog, public
as $$
declare
  camp public.drawing_campaigns%rowtype;
  prize public.drawing_campaign_prizes%rowtype;
  has_prize boolean := false;
  committed numeric := 0;
  source text;
  normalized text;
  year integer;
  quarter integer;
  start_month integer;
  end_year integer;
  end_month integer;
  window_start timestamptz;
  window_end timestamptz;
begin
  select *
    into camp
  from public.drawing_campaigns
  where id = p_campaign_id;

  if not found then
    return;
  end if;

  if camp.quarter_key is null or camp.quarter_key !~ '^[0-9]{4}-Q[1-4]$' then
    raise exception 'invalid_quarter_key' using errcode = 'P0001';
  end if;

  if camp.mode is distinct from 'sample' and camp.mode is distinct from 'live' then
    raise exception 'invalid_mode' using errcode = 'P0001';
  end if;

  if camp.rules_version is null or pg_catalog.btrim(camp.rules_version) = '' then
    raise exception 'invalid_rules_version' using errcode = 'P0001';
  end if;

  if camp.total_budget_cents <> pg_catalog.trunc(camp.total_budget_cents)
     or camp.fulfillment_allowance_cents <> pg_catalog.trunc(camp.fulfillment_allowance_cents) then
    raise exception 'non_integer_cents' using errcode = 'P0001';
  end if;

  if camp.total_budget_cents < 0 or camp.fulfillment_allowance_cents < 0 then
    raise exception 'negative_cents' using errcode = 'P0001';
  end if;

  year := pg_catalog.substring(camp.quarter_key, 1, 4)::integer;
  quarter := pg_catalog.substring(camp.quarter_key, 7, 1)::integer;
  start_month := (quarter - 1) * 3 + 1;
  if quarter = 4 then
    end_year := year + 1;
    end_month := 1;
  else
    end_year := year;
    end_month := start_month + 3;
  end if;
  window_start := pg_catalog.make_timestamptz(year, start_month, 1, 0, 0, 0, 'America/Chicago');
  window_end := pg_catalog.make_timestamptz(end_year, end_month, 1, 0, 0, 0, 'America/Chicago');
  if camp.starts_at is distinct from window_start or camp.ends_at is distinct from window_end then
    raise exception 'invalid_quarter_key' using errcode = 'P0001';
  end if;

  if camp.eligible_entry_sources is null or pg_catalog.cardinality(camp.eligible_entry_sources) = 0 then
    raise exception 'unknown_entry_source' using errcode = 'P0001';
  end if;

  foreach source in array camp.eligible_entry_sources loop
    if source is null then
      raise exception 'unknown_entry_source' using errcode = 'P0001';
    end if;
    if pg_catalog.btrim(source) = 'level_milestone' then
      continue;
    end if;
    normalized := pg_catalog.lower(
      pg_catalog.regexp_replace(pg_catalog.btrim(source), '[[:space:]-]+', '_', 'g')
    );
    if normalized in (
      'review',
      'reviews',
      'public_review',
      'public_reviews',
      'google_review',
      'yelp',
      'yelp_review',
      'rating',
      'ratings',
      'bite_note',
      'public_note'
    ) or pg_catalog.strpos(normalized, 'review') > 0 then
      raise exception 'public_review_entry' using errcode = 'P0001';
    end if;
    raise exception 'unknown_entry_source' using errcode = 'P0001';
  end loop;

  for prize in
    select *
    from public.drawing_campaign_prizes
    where campaign_id = p_campaign_id
    order by position
  loop
    has_prize := true;
    if prize.label is null or pg_catalog.btrim(prize.label) = '' then
      raise exception 'invalid_label' using errcode = 'P0001';
    end if;
    if prize.quantity <> pg_catalog.trunc(prize.quantity) then
      raise exception 'non_integer_quantity' using errcode = 'P0001';
    end if;
    if prize.quantity < 0 then
      raise exception 'negative_quantity' using errcode = 'P0001';
    end if;
    if prize.quantity = 0 then
      raise exception 'zero_quantity' using errcode = 'P0001';
    end if;
    if prize.unit_value_cents <> pg_catalog.trunc(prize.unit_value_cents) then
      raise exception 'non_integer_cents' using errcode = 'P0001';
    end if;
    if prize.unit_value_cents < 0 then
      raise exception 'negative_cents' using errcode = 'P0001';
    end if;
    if camp.mode = 'sample' then
      if prize.is_sample is not true then
        raise exception 'sample_prize_required' using errcode = 'P0001';
      end if;
      if pg_catalog.strpos(prize.label, 'Sample prize') = 0 then
        raise exception 'sample_label_required' using errcode = 'P0001';
      end if;
    elsif prize.is_sample is true then
      raise exception 'live_sample_prize' using errcode = 'P0001';
    end if;
    committed := committed + (prize.quantity::numeric * prize.unit_value_cents::numeric);
  end loop;

  if not has_prize then
    raise exception 'empty_prizes' using errcode = 'P0001';
  end if;

  committed := committed + camp.fulfillment_allowance_cents::numeric;
  if committed > camp.total_budget_cents::numeric then
    raise exception 'over_budget' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.drawing_campaign_reject(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.drawing_campaigns_enforce()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  target uuid;
begin
  if tg_table_name = 'drawing_campaigns' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    target := new.id;
  elsif tg_op = 'DELETE' then
    target := old.campaign_id;
  else
    target := new.campaign_id;
  end if;

  perform public.drawing_campaign_reject(target);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.drawing_campaigns_enforce()
  from public, anon, authenticated, service_role;

comment on function public.drawing_campaigns_enforce() is
  'Deferred check for one campaign row or its prizes. A direct SQL write is rejected with the same codes as validateCampaignDraft. Does not read progression tables.';

-- Initially deferred so a campaign and its prizes can be written in one
-- transaction. save_drawing_campaign sets the constraints immediate before
-- it returns. A direct statement is checked at commit.
create constraint trigger drawing_campaigns_enforce
  after insert or update or delete on public.drawing_campaigns
  deferrable initially deferred
  for each row execute function public.drawing_campaigns_enforce();

create constraint trigger drawing_campaign_prizes_enforce
  after insert or update or delete on public.drawing_campaign_prizes
  deferrable initially deferred
  for each row execute function public.drawing_campaigns_enforce();

-- JSON numbers that are not integers are rejected here with the B1 code.
-- A fractional numeric written directly is rejected by drawing_campaign_reject.
-- Negative integers pass through and that function raises negative_cents
-- or negative_quantity.
create or replace function public.drawing_campaign_json_int(p_value jsonb, p_kind text)
returns bigint
language plpgsql
immutable
set search_path to pg_catalog
as $$
declare
  num numeric;
  code text;
begin
  code := case
    when p_kind = 'quantity' then 'non_integer_quantity'
    else 'non_integer_cents'
  end;
  if p_value is null or pg_catalog.jsonb_typeof(p_value) is distinct from 'number' then
    raise exception '%', code using errcode = 'P0001';
  end if;
  num := (p_value #>> '{}')::numeric;
  if num <> pg_catalog.trunc(num)
     or num > 9223372036854775807
     or num < -9223372036854775808 then
    raise exception '%', code using errcode = 'P0001';
  end if;
  return num::bigint;
end;
$$;

revoke all on function public.drawing_campaign_json_int(jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.drawing_campaign_json_int(jsonb, text) to service_role;

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

  if p_payload->>'id' is not null and p_payload->>'id' <> '' then
    v_id := (p_payload->>'id')::uuid;
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

  set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce immediate;
  set constraints drawing_campaigns_enforce, drawing_campaign_prizes_enforce deferred;

  v_saved := public.drawing_campaign_as_json(v_id);
  if v_saved is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v_saved;
end;
$$;

revoke all on function public.save_drawing_campaign(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_drawing_campaign(jsonb) to service_role;

comment on function public.save_drawing_campaign(jsonb) is
  'Inserts or replaces one drawing campaign and its prizes in one transaction. service_role only. Does not select winners, read progression tables, or expose the row to members.';

alter table public.drawing_campaigns enable row level security;
alter table public.drawing_campaign_prizes enable row level security;

revoke all on table public.drawing_campaigns
  from public, anon, authenticated, service_role;
revoke all on table public.drawing_campaign_prizes
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.drawing_campaigns to service_role;
grant select, insert, update, delete on table public.drawing_campaign_prizes to service_role;
