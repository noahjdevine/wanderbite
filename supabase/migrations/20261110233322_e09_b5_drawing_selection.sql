-- E09-B5 audited simulated winner selection.
-- Not applied to hosted. Do not run supabase db push for this file.
-- One service_role call of select_drawing_winners draws a closed sample
-- campaign once. The draw reads progression_drawing_entries for that
-- quarter. It does not add a campaign foreign key to that table, and it
-- does not change progression writers, campaign storage, or the lifecycle.
-- Winners are simulated. Nothing notifies a member.
-- database.types.ts is unchanged. E09_PROGRESSION_LEDGER_ENABLED and
-- E09_MEMBER_PROGRESSION_UI_ENABLED stay unset.
-- Rollback before a hosted apply is reverting this migration. After a
-- hosted apply, roll forward by dropping select_drawing_winners(uuid, text, text)
-- and the two selection tables.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- SHA-256 and gen_random_bytes. The Supabase Postgres image installs
-- pgcrypto in extensions. Both statements are no-ops when that is already true.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- One append-only audit row per campaign. campaign_id is unique, so a
-- second draw cannot insert another row. simulated is checked true: this
-- slice never stores a live result.
create table public.drawing_selections (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references public.drawing_campaigns (id),
  algorithm_version text not null,
  -- 32 bytes from gen_random_bytes, lowercase hex. A test may pass the same
  -- shape to select_drawing_winners. The application store does not.
  seed text not null,
  eligible_entry_count integer not null,
  eligible_member_count integer not null,
  -- Eligible entry ids in sha256-rank order (seed || id, then id). This is
  -- the pool the draw used. A later change to progression_drawing_entries
  -- does not rewrite it.
  eligible_entry_ids uuid[] not null,
  -- Member of each eligible_entry_ids element, same order and length.
  -- Entry ids alone cannot replay one prize per member.
  eligible_user_ids uuid[] not null,
  prize_unit_count integer not null,
  unfilled_unit_count integer not null,
  simulated boolean not null default true,
  -- Operator label supplied by the caller. Not an auth.users id.
  run_by text not null,
  created_at timestamptz not null default now(),
  constraint drawing_selections_id_campaign_key unique (id, campaign_id),
  constraint drawing_selections_algorithm_version_check
    check (algorithm_version = 'v1-sha256-rank'),
  constraint drawing_selections_seed_check
    check (seed ~ '^[0-9a-f]{64}$'),
  constraint drawing_selections_eligible_entry_count_check
    check (eligible_entry_count >= 0),
  constraint drawing_selections_eligible_member_count_check
    check (eligible_member_count >= 0 and eligible_member_count <= eligible_entry_count),
  constraint drawing_selections_eligible_entry_ids_check
    check (cardinality(eligible_entry_ids) = eligible_entry_count),
  constraint drawing_selections_eligible_user_ids_check
    check (cardinality(eligible_user_ids) = eligible_entry_count),
  constraint drawing_selections_prize_unit_count_check
    check (prize_unit_count >= 0),
  constraint drawing_selections_unfilled_unit_count_check
    check (unfilled_unit_count >= 0 and unfilled_unit_count <= prize_unit_count),
  constraint drawing_selections_simulated_check
    check (simulated),
  constraint drawing_selections_run_by_check
    check (btrim(run_by) <> '')
);

comment on table public.drawing_selections is
  'One simulated draw per closed sample campaign. Append-only. Seed plus the eligible entry ids reproduce the winners. service_role reads; select_drawing_winners writes. Not applied to hosted. Members are not notified.';

comment on column public.drawing_selections.seed is
  'Lowercase hex of 32 random bytes, or the same shape passed to select_drawing_winners for a test. Rank is sha256 of the UTF-8 bytes of seed || entry_id::text, then entry id.';

comment on column public.drawing_selections.eligible_entry_ids is
  'Eligible progression_drawing_entries.id values in sha256-rank order. Together with the seed and eligible_user_ids, this is enough to reproduce the winners without reading the ledger again.';

comment on column public.drawing_selections.eligible_user_ids is
  'user_id of each eligible_entry_ids element, in that same order. Required to replay the one-prize-per-member skip.';

comment on column public.drawing_selections.run_by is
  'Caller-supplied operator label. Trimmed. Not a foreign key to auth.users.';

comment on column public.drawing_selections.simulated is
  'Always true. Live selection is rejected before a row is written.';

-- Winner rows copy entry_id and user_id. They do not reference
-- progression_drawing_entries or user_profiles. Those parents cascade
-- when a member is deleted, and an ON DELETE on a winner row would either
-- erase the audit or, with the immutability trigger, block the delete.
-- A deleted member's winner rows stay, with ids that may no longer point
-- at a profile or an entry. Retention of those rows is a follow-up.
create table public.drawing_selection_winners (
  id uuid primary key default gen_random_uuid(),
  selection_id uuid not null,
  campaign_id uuid not null,
  prize_id uuid not null references public.drawing_campaign_prizes (id),
  -- 1..quantity for that prize, in prize order.
  unit_index integer not null,
  entry_id uuid not null,
  user_id uuid not null,
  -- 1-based place of this entry in the sha256 order of eligible entries.
  -- A skipped extra entry of a member who already won keeps its place, so
  -- the next winner's rank is not compacted.
  rank integer not null,
  created_at timestamptz not null default now(),
  constraint drawing_selection_winners_selection_campaign_fkey
    foreign key (selection_id, campaign_id)
    references public.drawing_selections (id, campaign_id),
  constraint drawing_selection_winners_prize_unit_key
    unique (selection_id, prize_id, unit_index),
  constraint drawing_selection_winners_user_key
    unique (selection_id, user_id),
  constraint drawing_selection_winners_entry_key
    unique (selection_id, entry_id),
  constraint drawing_selection_winners_unit_index_check
    check (unit_index >= 1),
  constraint drawing_selection_winners_rank_check
    check (rank >= 1)
);

-- Unique (selection_id, prize_id, unit_index) leads with selection_id, so
-- it covers the selection_id side of the composite foreign key.
create index drawing_selection_winners_campaign_id_idx
  on public.drawing_selection_winners (campaign_id);

create index drawing_selection_winners_prize_id_idx
  on public.drawing_selection_winners (prize_id);

comment on table public.drawing_selection_winners is
  'One simulated winner per filled prize unit. One prize per member. entry_id and user_id are copies, not foreign keys, so deleting a member leaves the audit row. Append-only.';

comment on column public.drawing_selection_winners.rank is
  '1-based index of the winning entry in the eligible sha256 order. Not renumbered when an earlier entry was skipped.';

-- Rejects UPDATE and DELETE, and rejects INSERT unless this transaction
-- set wanderbite.drawing_selection to the campaign id. select_drawing_winners
-- sets that with set_config(..., true), which is local to the transaction.
-- The same pattern as wanderbite.drawing_campaign_transition.
create or replace function public.drawing_selections_guard()
returns trigger
language plpgsql
set search_path to pg_catalog, public
as $$
declare
  via text;
begin
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    raise exception 'selection_immutable' using errcode = 'P0001';
  end if;

  via := pg_catalog.current_setting('wanderbite.drawing_selection', true);
  if via is distinct from new.campaign_id::text then
    raise exception 'selection_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.drawing_selections_guard()
  from public, anon, authenticated, service_role;

comment on function public.drawing_selections_guard() is
  'Append-only guard. UPDATE and DELETE raise selection_immutable. INSERT raises the same code unless wanderbite.drawing_selection is the campaign id, which select_drawing_winners sets for its own writes.';

create trigger drawing_selections_guard
  before insert or update or delete on public.drawing_selections
  for each row execute function public.drawing_selections_guard();

create trigger drawing_selection_winners_guard
  before insert or update or delete on public.drawing_selection_winners
  for each row execute function public.drawing_selections_guard();

-- Codes, in order: not_found, live_selection_blocked, campaign_not_closed,
-- already_selected, invalid_run_by, invalid_seed, no_eligible_entries.
-- no_eligible_entries writes nothing. A live campaign is rejected even
-- when it is not closed. campaign_not_closed covers a status other than
-- closed, a null activated_at (never activated, including draft → closed),
-- or a null closed_at (a direct draft → closed).
-- Eligible entries: entry.quarter_key = campaign.quarter_key, entry_source
-- in eligible_entry_sources, and the milestone reached_at is strictly
-- before closed_at. Order is sha256(seed || entry_id::text) then entry id.
-- Prize units are position, then prize id, then unit_index from 1.
-- A member already given a unit is skipped. Leftover units are
-- unfilled_unit_count. p_seed is optional and service_role only because
-- the function is. Null generates the seed. A supplied seed is for tests.
create or replace function public.select_drawing_winners(
  p_campaign_id uuid,
  p_run_by text,
  p_seed text default null
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  camp public.drawing_campaigns%rowtype;
  prize public.drawing_campaign_prizes%rowtype;
  v_seed text;
  v_entry_ids uuid[];
  v_user_ids uuid[];
  v_entry_count integer;
  v_member_count integer;
  v_prize_ids uuid[] := '{}';
  v_unit_indexes integer[] := '{}';
  v_unit_count integer;
  v_win_prize uuid[] := '{}';
  v_win_unit integer[] := '{}';
  v_win_entry uuid[] := '{}';
  v_win_user uuid[] := '{}';
  v_win_rank integer[] := '{}';
  v_assigned integer := 0;
  v_won uuid[] := '{}';
  v_qty integer;
  v_index integer;
  v_selection_id uuid;
  v_selection public.drawing_selections%rowtype;
  v_winners jsonb;
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

  if camp.mode = 'live' then
    raise exception 'live_selection_blocked' using errcode = 'P0001';
  end if;

  if camp.status is distinct from 'closed'
     or camp.activated_at is null
     or camp.closed_at is null
     or camp.mode is distinct from 'sample' then
    raise exception 'campaign_not_closed' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.drawing_selections
    where campaign_id = camp.id
  ) then
    raise exception 'already_selected' using errcode = 'P0001';
  end if;

  if p_run_by is null or pg_catalog.btrim(p_run_by) = '' then
    raise exception 'invalid_run_by' using errcode = 'P0001';
  end if;

  if p_seed is null then
    v_seed := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  elsif p_seed !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_seed' using errcode = 'P0001';
  else
    v_seed := p_seed;
  end if;

  with eligible as (
    select
      e.id,
      e.user_id,
      extensions.digest(v_seed || e.id::text, 'sha256') as rank_key
    from public.progression_drawing_entries e
    join public.progression_milestones m on m.id = e.milestone_id
    where e.quarter_key = camp.quarter_key
      and e.entry_source = any (camp.eligible_entry_sources)
      and m.reached_at < camp.closed_at
  )
  select
    coalesce((select pg_catalog.array_agg(id order by rank_key, id) from eligible), '{}'),
    coalesce((select pg_catalog.array_agg(user_id order by rank_key, id) from eligible), '{}'),
    (select count(*)::integer from eligible),
    (select count(distinct user_id)::integer from eligible)
  into v_entry_ids, v_user_ids, v_entry_count, v_member_count;

  if v_entry_count = 0 then
    raise exception 'no_eligible_entries' using errcode = 'P0001';
  end if;

  for prize in
    select *
    from public.drawing_campaign_prizes
    where campaign_id = camp.id
    order by position, id
  loop
    if prize.quantity <> pg_catalog.trunc(prize.quantity) or prize.quantity < 1 then
      raise exception 'non_integer_quantity' using errcode = 'P0001';
    end if;
    v_qty := pg_catalog.trunc(prize.quantity)::integer;
    for v_index in 1..v_qty loop
      v_prize_ids := v_prize_ids || prize.id;
      v_unit_indexes := v_unit_indexes || v_index;
    end loop;
  end loop;

  v_unit_count := coalesce(pg_catalog.array_length(v_prize_ids, 1), 0);

  for v_index in 1..v_entry_count loop
    exit when v_assigned >= v_unit_count;
    if v_user_ids[v_index] = any (v_won) then
      continue;
    end if;
    v_assigned := v_assigned + 1;
    v_won := v_won || v_user_ids[v_index];
    v_win_prize := v_win_prize || v_prize_ids[v_assigned];
    v_win_unit := v_win_unit || v_unit_indexes[v_assigned];
    v_win_entry := v_win_entry || v_entry_ids[v_index];
    v_win_user := v_win_user || v_user_ids[v_index];
    v_win_rank := v_win_rank || v_index;
  end loop;

  perform pg_catalog.set_config('wanderbite.drawing_selection', camp.id::text, true);

  begin
    insert into public.drawing_selections (
      campaign_id,
      algorithm_version,
      seed,
      eligible_entry_count,
      eligible_member_count,
      eligible_entry_ids,
      eligible_user_ids,
      prize_unit_count,
      unfilled_unit_count,
      simulated,
      run_by
    ) values (
      camp.id,
      'v1-sha256-rank',
      v_seed,
      v_entry_count,
      v_member_count,
      v_entry_ids,
      v_user_ids,
      v_unit_count,
      v_unit_count - v_assigned,
      true,
      pg_catalog.btrim(p_run_by)
    )
    returning id into v_selection_id;
  exception
    when unique_violation then
      raise exception 'already_selected' using errcode = 'P0001';
  end;

  for v_index in 1..v_assigned loop
    insert into public.drawing_selection_winners (
      selection_id,
      campaign_id,
      prize_id,
      unit_index,
      entry_id,
      user_id,
      rank
    ) values (
      v_selection_id,
      camp.id,
      v_win_prize[v_index],
      v_win_unit[v_index],
      v_win_entry[v_index],
      v_win_user[v_index],
      v_win_rank[v_index]
    );
  end loop;

  select *
    into v_selection
  from public.drawing_selections
  where id = v_selection_id;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(w) order by w.rank), '[]'::jsonb)
    into v_winners
  from public.drawing_selection_winners w
  where w.selection_id = v_selection_id;

  -- Drop the insert flag before returning so a later statement in the
  -- same transaction cannot append another row.
  perform pg_catalog.set_config('wanderbite.drawing_selection', '', true);

  return pg_catalog.jsonb_build_object(
    'selection', pg_catalog.to_jsonb(v_selection),
    'winners', v_winners
  );
end;
$$;

revoke all on function public.select_drawing_winners(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.select_drawing_winners(uuid, text, text) to service_role;

comment on function public.select_drawing_winners(uuid, text, text) is
  'Draws one closed sample campaign once from that quarter''s drawing entries. Records the seed, eligible_entry_ids in sha256-rank order, eligible_user_ids in that same order, and one simulated winner per filled prize unit, one prize per member. service_role only. Does not notify members, does not write progression rows, and does not run for live campaigns. A null p_seed generates 32 random bytes. A supplied 64-char lowercase hex seed is for tests.';

alter table public.drawing_selections enable row level security;
alter table public.drawing_selection_winners enable row level security;

revoke all on table public.drawing_selections
  from public, anon, authenticated, service_role;
revoke all on table public.drawing_selection_winners
  from public, anon, authenticated, service_role;

-- Reads for the service-role store. Writes are the security definer
-- function. anon and authenticated have no grants and no policies.
grant select on table public.drawing_selections to service_role;
grant select on table public.drawing_selection_winners to service_role;
