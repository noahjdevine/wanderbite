-- E09-B6 audited sample fulfillment for simulated drawing winners.
-- Not applied to hosted. Do not run supabase db push for this file.
-- It does not edit 20261110214500, 20261110220339, or 20261110233322.
-- One fulfillment row per drawing_selection_winners row. Status moves
-- pending -> ready -> fulfilled, and pending or ready -> forfeited.
-- fulfilled and forfeited are final. Forfeit does not redraw or replace
-- a winner. Nothing notifies a member and nothing ships.
-- fulfillment_allowance_cents (E09-B1) is the campaign's reserved
-- fulfillment budget: it is added to prize quantity times unit value
-- when committed cents are checked against total_budget_cents. This
-- slice stores actual_cost_cents and does not compare that sum to the
-- allowance. Whether the allowance is a cap on recorded costs is open.
-- database.types.ts is unchanged. E09_PROGRESSION_LEDGER_ENABLED and
-- E09_MEMBER_PROGRESSION_UI_ENABLED stay unset.
-- Rollback before a hosted apply is reverting this migration. After a
-- hosted apply, roll forward by dropping create_drawing_fulfillments(uuid, text),
-- transition_drawing_fulfillment(uuid, text, text, text, integer),
-- and the two fulfillment tables.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- One row per simulated winner. winner_id is the only link to the draw.
-- user_id is not copied and is not a foreign key: deleting a member
-- leaves the winner row (E09-B5) and this row. What to do with those
-- leftover rows is the same follow-up as the winner audit.
create table public.drawing_fulfillments (
  id uuid primary key default gen_random_uuid(),
  winner_id uuid not null unique references public.drawing_selection_winners (id),
  selection_id uuid not null references public.drawing_selections (id),
  campaign_id uuid not null references public.drawing_campaigns (id),
  prize_id uuid not null references public.drawing_campaign_prizes (id),
  status text not null default 'pending',
  simulated boolean not null default true,
  -- Null until fulfilled. Required once fulfilled, and 0 is allowed.
  -- Not checked against fulfillment_allowance_cents.
  actual_cost_cents integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drawing_fulfillments_status_check
    check (status in ('pending', 'ready', 'fulfilled', 'forfeited')),
  constraint drawing_fulfillments_simulated_check
    check (simulated),
  constraint drawing_fulfillments_actual_cost_cents_check
    check (actual_cost_cents is null or actual_cost_cents >= 0),
  constraint drawing_fulfillments_cost_status_check
    check (
      (status = 'fulfilled' and actual_cost_cents is not null)
      or (status <> 'fulfilled' and actual_cost_cents is null)
    )
);

-- Unique winner_id covers that foreign key. The other parents need
-- their own indexes. The campaign index is also the list order.
create index drawing_fulfillments_selection_id_idx
  on public.drawing_fulfillments (selection_id);

create index drawing_fulfillments_campaign_id_created_at_idx
  on public.drawing_fulfillments (campaign_id, created_at, id);

create index drawing_fulfillments_prize_id_idx
  on public.drawing_fulfillments (prize_id);

comment on table public.drawing_fulfillments is
  'One simulated fulfillment per drawing winner. Status is pending, ready, fulfilled, or forfeited. Writes go through create_drawing_fulfillments and transition_drawing_fulfillment. service_role reads. Not applied to hosted. Members are not notified.';

comment on column public.drawing_fulfillments.winner_id is
  'drawing_selection_winners.id. One fulfillment per winner. Not a user id. Deleting a member does not remove this row.';

comment on column public.drawing_fulfillments.simulated is
  'Always true. Live selection is not stored, so live fulfillment is not stored.';

comment on column public.drawing_fulfillments.actual_cost_cents is
  'Operator-supplied cents when status becomes fulfilled. Null otherwise. 0 is allowed. A negative value fails drawing_fulfillments_actual_cost_cents_check. This is not capped by fulfillment_allowance_cents.';

comment on column public.drawing_fulfillments.status is
  'pending, ready, fulfilled, or forfeited. pending goes to ready or forfeited. ready goes to fulfilled or forfeited. fulfilled and forfeited do not move. pending does not jump to fulfilled.';

-- Append-only log. from_status is null on the creation row.
-- actor is the trimmed operator label, not an auth.users id.
-- note is at most 500 characters after trim.
create table public.drawing_fulfillment_events (
  id uuid primary key default gen_random_uuid(),
  fulfillment_id uuid not null references public.drawing_fulfillments (id),
  from_status text,
  to_status text not null,
  actor text not null,
  note text,
  actual_cost_cents integer,
  created_at timestamptz not null default clock_timestamp(),
  constraint drawing_fulfillment_events_from_status_check
    check (from_status is null or from_status in ('pending', 'ready', 'fulfilled', 'forfeited')),
  constraint drawing_fulfillment_events_to_status_check
    check (to_status in ('pending', 'ready', 'fulfilled', 'forfeited')),
  constraint drawing_fulfillment_events_actor_check
    check (actor = btrim(actor) and btrim(actor) <> ''),
  constraint drawing_fulfillment_events_note_check
    check (
      note is null
      or (char_length(note) between 1 and 500 and note = btrim(note))
    ),
  constraint drawing_fulfillment_events_actual_cost_cents_check
    check (actual_cost_cents is null or actual_cost_cents >= 0),
  constraint drawing_fulfillment_events_cost_status_check
    check (
      (to_status = 'fulfilled' and actual_cost_cents is not null)
      or (to_status <> 'fulfilled' and actual_cost_cents is null)
    )
);

create index drawing_fulfillment_events_fulfillment_id_idx
  on public.drawing_fulfillment_events (fulfillment_id, created_at, id);

comment on table public.drawing_fulfillment_events is
  'Append-only fulfillment log. One row when the fulfillment is created (from_status null) and one row per status change. UPDATE and DELETE raise fulfillment_event_immutable.';

comment on column public.drawing_fulfillment_events.actor is
  'Caller-supplied operator label. Trimmed. Not a foreign key to auth.users.';

comment on column public.drawing_fulfillment_events.from_status is
  'Previous status. Null on the creation event, whose to_status is pending.';

comment on column public.drawing_fulfillment_events.note is
  'Optional operator note, trimmed, 1 to 500 characters. Null when omitted.';

comment on column public.drawing_fulfillment_events.actual_cost_cents is
  'The cost recorded on a move to fulfilled. Null on every other event.';

-- Rejects DELETE always. Rejects INSERT and UPDATE unless this
-- transaction set wanderbite.drawing_fulfillment to the selection id.
-- The two RPCs set that with set_config(..., true) and clear it before
-- they return. Same latch shape as wanderbite.drawing_selection.
create or replace function public.drawing_fulfillments_guard()
returns trigger
language plpgsql
set search_path to pg_catalog, public
as $$
declare
  via text;
  winner_selection uuid;
  winner_campaign uuid;
  winner_prize uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'fulfillment_immutable' using errcode = 'P0001';
  end if;

  via := pg_catalog.current_setting('wanderbite.drawing_fulfillment', true);
  if via is distinct from new.selection_id::text then
    raise exception 'fulfillment_immutable' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' then
    if new.winner_id is distinct from old.winner_id
       or new.selection_id is distinct from old.selection_id
       or new.campaign_id is distinct from old.campaign_id
       or new.prize_id is distinct from old.prize_id
       or new.simulated is distinct from old.simulated
       or new.created_at is distinct from old.created_at
       or new.id is distinct from old.id then
      raise exception 'fulfillment_immutable' using errcode = 'P0001';
    end if;
  end if;

  select w.selection_id, w.campaign_id, w.prize_id
    into winner_selection, winner_campaign, winner_prize
  from public.drawing_selection_winners w
  where w.id = new.winner_id;

  if winner_selection is distinct from new.selection_id
     or winner_campaign is distinct from new.campaign_id
     or winner_prize is distinct from new.prize_id then
    raise exception 'fulfillment_immutable' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.drawing_fulfillments_guard()
  from public, anon, authenticated, service_role;

comment on function public.drawing_fulfillments_guard() is
  'Writer guard. DELETE always raises fulfillment_immutable. INSERT and UPDATE raise the same code unless wanderbite.drawing_fulfillment is the selection id, which the fulfillment RPCs set for their own writes and clear before return. Identity columns cannot change.';

create trigger drawing_fulfillments_guard
  before insert or update or delete on public.drawing_fulfillments
  for each row execute function public.drawing_fulfillments_guard();

-- UPDATE and DELETE always raise fulfillment_event_immutable.
-- INSERT raises the same code unless the fulfillment latch names the
-- parent row's selection, which is how the RPCs append a log row.
create or replace function public.drawing_fulfillment_events_guard()
returns trigger
language plpgsql
set search_path to pg_catalog, public
as $$
declare
  via text;
  parent_selection uuid;
begin
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    raise exception 'fulfillment_event_immutable' using errcode = 'P0001';
  end if;

  via := pg_catalog.current_setting('wanderbite.drawing_fulfillment', true);
  select f.selection_id
    into parent_selection
  from public.drawing_fulfillments f
  where f.id = new.fulfillment_id;

  if parent_selection is null or via is distinct from parent_selection::text then
    raise exception 'fulfillment_event_immutable' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.drawing_fulfillment_events_guard()
  from public, anon, authenticated, service_role;

comment on function public.drawing_fulfillment_events_guard() is
  'Append-only guard. UPDATE and DELETE raise fulfillment_event_immutable. INSERT raises the same code unless wanderbite.drawing_fulfillment is the parent fulfillment''s selection id.';

create trigger drawing_fulfillment_events_guard
  before insert or update or delete on public.drawing_fulfillment_events
  for each row execute function public.drawing_fulfillment_events_guard();

-- Codes, in order: not_found, invalid_run_by.
-- A second call inserts nothing and returns the rows already stored,
-- including when p_run_by differs from the first call. A blank label
-- is invalid_run_by even when the rows already exist. A missing
-- selection is not_found before the label is checked.
-- Every winner of the selection gets one pending row and one creation
-- event (from_status null, to_status pending). simulated is true.
create or replace function public.create_drawing_fulfillments(
  p_selection_id uuid,
  p_run_by text
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  v_selection public.drawing_selections%rowtype;
  v_actor text;
  v_rows jsonb;
begin
  if p_selection_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select *
    into v_selection
  from public.drawing_selections
  where id = p_selection_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_run_by is null or pg_catalog.btrim(p_run_by) = '' then
    raise exception 'invalid_run_by' using errcode = 'P0001';
  end if;

  v_actor := pg_catalog.btrim(p_run_by);

  if not exists (
    select 1
    from public.drawing_fulfillments
    where selection_id = v_selection.id
  ) then
    perform pg_catalog.set_config('wanderbite.drawing_fulfillment', v_selection.id::text, true);

    insert into public.drawing_fulfillments (
      winner_id,
      selection_id,
      campaign_id,
      prize_id,
      status,
      simulated
    )
    select
      w.id,
      w.selection_id,
      w.campaign_id,
      w.prize_id,
      'pending',
      true
    from public.drawing_selection_winners w
    where w.selection_id = v_selection.id;

    insert into public.drawing_fulfillment_events (
      fulfillment_id,
      from_status,
      to_status,
      actor
    )
    select
      f.id,
      null,
      'pending',
      v_actor
    from public.drawing_fulfillments f
    where f.selection_id = v_selection.id;
  end if;

  -- Drop the latch before returning so a later statement in the same
  -- transaction cannot write another fulfillment row.
  perform pg_catalog.set_config('wanderbite.drawing_fulfillment', '', true);

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(f) order by w.rank, f.id),
    '[]'::jsonb
  )
    into v_rows
  from public.drawing_fulfillments f
  join public.drawing_selection_winners w on w.id = f.winner_id
  where f.selection_id = v_selection.id;

  return v_rows;
end;
$$;

revoke all on function public.create_drawing_fulfillments(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_drawing_fulfillments(uuid, text) to service_role;

comment on function public.create_drawing_fulfillments(uuid, text) is
  'Inserts one pending simulated fulfillment and one creation event per winner of a selection. A second call inserts nothing and returns the existing rows. service_role only. Does not notify members, does not draw, and does not write selection rows.';

-- Codes, in order: not_found, invalid_actor, invalid_transition,
-- cost_required, cost_not_allowed. A negative cost is not one of those
-- codes: drawing_fulfillments_actual_cost_cents_check rejects it and
-- the statement changes nothing. A note longer than 500 characters
-- after trim fails drawing_fulfillment_events_note_check the same way.
-- The row is locked FOR UPDATE. Fulfilled requires a cost, and 0 is
-- allowed. A cost on any other move is cost_not_allowed. Forfeit does
-- not insert a winner, a selection, or another fulfillment.
create or replace function public.transition_drawing_fulfillment(
  p_fulfillment_id uuid,
  p_to_status text,
  p_actor text,
  p_note text default null,
  p_actual_cost_cents integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  v_row public.drawing_fulfillments%rowtype;
  v_from text;
  v_actor text;
  v_note text;
  v_allowed boolean;
begin
  if p_fulfillment_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select *
    into v_row
  from public.drawing_fulfillments
  where id = p_fulfillment_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_actor is null or pg_catalog.btrim(p_actor) = '' then
    raise exception 'invalid_actor' using errcode = 'P0001';
  end if;

  v_actor := pg_catalog.btrim(p_actor);
  v_from := v_row.status;
  v_allowed :=
    (v_from = 'pending' and p_to_status = 'ready')
    or (v_from = 'pending' and p_to_status = 'forfeited')
    or (v_from = 'ready' and p_to_status = 'fulfilled')
    or (v_from = 'ready' and p_to_status = 'forfeited');

  if not v_allowed then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  if p_to_status = 'fulfilled' and p_actual_cost_cents is null then
    raise exception 'cost_required' using errcode = 'P0001';
  end if;

  if p_to_status is distinct from 'fulfilled' and p_actual_cost_cents is not null then
    raise exception 'cost_not_allowed' using errcode = 'P0001';
  end if;

  if p_note is null or pg_catalog.btrim(p_note) = '' then
    v_note := null;
  else
    v_note := pg_catalog.btrim(p_note);
  end if;

  perform pg_catalog.set_config('wanderbite.drawing_fulfillment', v_row.selection_id::text, true);

  update public.drawing_fulfillments
    set status = p_to_status,
        actual_cost_cents = case
          when p_to_status = 'fulfilled' then p_actual_cost_cents
          else null
        end,
        updated_at = pg_catalog.clock_timestamp()
  where id = v_row.id
  returning * into v_row;

  insert into public.drawing_fulfillment_events (
    fulfillment_id,
    from_status,
    to_status,
    actor,
    note,
    actual_cost_cents
  ) values (
    v_row.id,
    v_from,
    v_row.status,
    v_actor,
    v_note,
    v_row.actual_cost_cents
  );

  perform pg_catalog.set_config('wanderbite.drawing_fulfillment', '', true);

  return pg_catalog.to_jsonb(v_row);
end;
$$;

revoke all on function public.transition_drawing_fulfillment(uuid, text, text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.transition_drawing_fulfillment(uuid, text, text, text, integer) to service_role;

comment on function public.transition_drawing_fulfillment(uuid, text, text, text, integer) is
  'Moves one fulfillment along pending -> ready -> fulfilled, or from pending or ready to forfeited. Locks the row. Writes the status and one event in the same transaction. A cost is required for fulfilled, including 0, and is rejected on every other move. Does not redraw, replace a winner, or notify a member. service_role only.';

alter table public.drawing_fulfillments enable row level security;
alter table public.drawing_fulfillment_events enable row level security;

revoke all on table public.drawing_fulfillments
  from public, anon, authenticated, service_role;
revoke all on table public.drawing_fulfillment_events
  from public, anon, authenticated, service_role;

-- Reads for the service-role store. Writes are the security definer
-- functions. anon and authenticated have no grants and no policies.
grant select on table public.drawing_fulfillments to service_role;
grant select on table public.drawing_fulfillment_events to service_role;
