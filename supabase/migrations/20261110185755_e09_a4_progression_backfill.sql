-- E09-A4 idempotent backfill and recovery for the progression ledger.
-- Forward only. Does not edit 20261110152224_e09_a2_progression_ledger.sql.
-- Not applied to hosted. Do not run supabase db push for this file in this PR.
-- 20261110152224 is applied to hosted separately. Do not push that file here either.
-- E09_PROGRESSION_LEDGER_ENABLED stays unset. This file does not set it.
-- Nothing reads the ledger. verify_redemption and verify_redemption_and_settle
-- are unchanged. user_badges is unchanged.
--
-- Milestone rows are inserted by progression_insert_missing_v1_milestones.
-- That is the only copy of schedule v1 (300 / 1000 / 1500 / 2500, then +1000).
-- record_verified_visit_progress and backfill_verified_visit_progress both call it.
-- The recorder still inserts one drawing entry for every milestone it creates.
-- Backfill inserts an entry only for a milestone this call created whose
-- reached_at is on or after p_entries_from. p_entries_from has no default.
--
-- Rollback before a hosted apply is reverting this PR. After a hosted apply,
-- roll forward by dropping backfill_verified_visit_progress(timestamptz, uuid, boolean).
-- Leave progression_insert_missing_v1_milestones and the replaced recorder.
-- Rows already written stay in the A2 tables. Nothing reads them.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.progression_insert_missing_v1_milestones(p_user_id uuid)
returns setof public.progression_milestones
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
begin
  if p_user_id is null then
    return;
  end if;

  -- Same per-member lock as record_verified_visit_progress. Reentrant when
  -- the caller already holds it in this transaction.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('wanderbite.progression.v1'),
    pg_catalog.hashtext(p_user_id::text)
  );

  -- Recompute from the count of this member's v1 verified-visit events.
  -- Mirrors src/lib/progression/schedule.ts PROGRESSION_SCHEDULE_V1 and
  -- src/lib/progress/rules.ts XP_PER_VERIFIED_VISIT = 100:
  --   levels 1-4 at 300 / 1000 / 1500 / 2500 XP, then +1000 XP per level.
  -- Mirrors src/lib/progression/milestones.ts:
  --   milestone_key is schedule_version || ':level:' || level.
  --   The crossing visit is the event at position min_xp / 100 when events
  --   are ordered by occurred_at, then id. reached_at is that occurred_at,
  --   not the time of this call.
  -- Mirrors src/lib/progression/quarter.ts chicagoQuarterKey:
  --   quarter_key is the America/Chicago calendar quarter of that occurred_at.
  -- An existing milestone is not updated. A visit recorded later, even one
  -- that sorts earlier, does not move reached_at or the drawing entry.
  return query
  with ordered as (
    select
      e.id,
      e.occurred_at,
      row_number() over (order by e.occurred_at, e.id) as visit_n
    from public.progression_events e
    where e.user_id = p_user_id
      and e.source_kind = 'verified_visit'
      and e.schedule_version = 'v1'
  ),
  totals as (
    select coalesce(max(visit_n), 0)::integer as visits
    from ordered
  ),
  thresholds as (
    select explicit.level, explicit.min_xp
    from (
      values
        (1, 300),
        (2, 1000),
        (3, 1500),
        (4, 2500)
    ) as explicit(level, min_xp)
    union all
    select 4 + step.n, 2500 + step.n * 1000
    from totals
    cross join lateral pg_catalog.generate_series(
      1,
      case
        when totals.visits * 100 >= 2500
        then (totals.visits * 100 - 2500) / 1000
        else 0
      end
    ) as step(n)
  ),
  due as (
    select
      t.level,
      o.id as source_event_id,
      o.occurred_at as reached_at,
      pg_catalog.to_char(o.occurred_at at time zone 'America/Chicago', 'YYYY')
        || '-Q'
        || (((pg_catalog.date_part('month', o.occurred_at at time zone 'America/Chicago'))::integer - 1) / 3 + 1)::text
        as quarter_key
    from thresholds t
    join totals on t.min_xp <= totals.visits * 100
    join ordered o on o.visit_n = (t.min_xp / 100)
  ),
  inserted as (
    insert into public.progression_milestones (
      user_id,
      schedule_version,
      level,
      milestone_key,
      reached_at,
      quarter_key,
      source_event_id
    )
    select
      p_user_id,
      'v1',
      due.level,
      'v1:level:' || due.level::text,
      due.reached_at,
      due.quarter_key,
      due.source_event_id
    from due
    on conflict (user_id, milestone_key) do nothing
    returning *
  )
  select inserted.*
  from inserted
  order by inserted.level;
end;
$$;

revoke all on function public.progression_insert_missing_v1_milestones(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.progression_insert_missing_v1_milestones(uuid)
  to current_user;

comment on function public.progression_insert_missing_v1_milestones(uuid) is
  'Internal. Inserts missing v1 level milestones for one member and returns only the rows this call inserted. Does not write drawing entries. Not granted to anon, authenticated, or service_role.';

create or replace function public.record_verified_visit_progress(p_redemption_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  redemption public.redemptions%rowtype;
  inserted_event public.progression_events%rowtype;
  event_json jsonb := '[]'::jsonb;
  milestone_json jsonb := '[]'::jsonb;
  entry_json jsonb := '[]'::jsonb;
  milestone public.progression_milestones%rowtype;
  entry public.progression_drawing_entries%rowtype;
begin
  -- Unknown, not verified, or no event time: return null and write nothing.
  -- A verified row with null verified_at has no instant to store, so it is
  -- treated the same way. This does not raise.
  if p_redemption_id is null then
    return null;
  end if;

  select *
    into redemption
  from public.redemptions
  where id = p_redemption_id;

  if not found
     or redemption.status is distinct from 'verified'
     or redemption.verified_at is null
     or redemption.user_id is null then
    return null;
  end if;

  -- One recorder per member. The second visit waits until the first has
  -- inserted its event and any milestone it crossed.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('wanderbite.progression.v1'),
    pg_catalog.hashtext(redemption.user_id::text)
  );

  insert into public.progression_events (
    user_id,
    source_kind,
    source_id,
    occurred_at,
    xp,
    schedule_version
  ) values (
    redemption.user_id,
    'verified_visit',
    redemption.id,
    redemption.verified_at,
    100,
    'v1'
  )
  on conflict (source_kind, source_id) do nothing
  returning * into inserted_event;

  if found then
    event_json := pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(inserted_event));
  elsif not exists (
    select 1
    from public.progression_events as existing
    where existing.source_kind = 'verified_visit'
      and existing.source_id = redemption.id
      and existing.user_id = redemption.user_id
  ) then
    raise exception 'progression event owner mismatch'
      using errcode = '23514';
  end if;

  -- Missing milestones come from the shared helper. Each milestone this call
  -- inserts gets one drawing entry. An existing milestone is left alone,
  -- including its drawing entry.
  for milestone in
    select *
    from public.progression_insert_missing_v1_milestones(redemption.user_id)
  loop
    milestone_json := milestone_json || pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(milestone));

    insert into public.progression_drawing_entries (
      user_id,
      milestone_id,
      quarter_key,
      entry_source
    ) values (
      milestone.user_id,
      milestone.id,
      milestone.quarter_key,
      'level_milestone'
    )
    on conflict (milestone_id) do nothing
    returning * into entry;

    if found then
      entry_json := entry_json || pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(entry));
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'events', event_json,
    'milestones', milestone_json,
    'entries', entry_json
  );
end;
$$;

revoke all on function public.record_verified_visit_progress(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.record_verified_visit_progress(uuid)
  to service_role;

comment on function public.record_verified_visit_progress(uuid) is
  'Records one verified visit on the v1 progression ledger. Unknown id, a status other than verified, null verified_at, or null user_id returns null and writes nothing, without raising. A second call inserts nothing and returns empty events, milestones, and entries. Returned rows are only the ones this call inserted. Milestones come from progression_insert_missing_v1_milestones. Each milestone this call inserts gets one drawing entry. reached_at and quarter_key come from the crossing event, not from the call time. Not called by verify_redemption.';

create or replace function public.backfill_verified_visit_progress(
  p_entries_from timestamptz,
  p_user_id uuid default null,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  v_dry_run boolean := coalesce(p_dry_run, true);
  v_user_id uuid;
  v_members integer := 0;
  v_events integer := 0;
  v_milestones integer := 0;
  v_entries integer := 0;
  v_without integer := 0;
  v_member_events integer := 0;
  v_member_milestones integer := 0;
  v_member_entries integer := 0;
  v_member_without integer := 0;
  v_wrote integer := 0;
  v_milestone public.progression_milestones%rowtype;
begin
  if p_entries_from is null then
    raise exception 'p_entries_from is required'
      using errcode = '22023';
  end if;

  -- Dry run performs the same inserts, counts them, then undoes the writes.
  -- A second call is the recovery sweep: verified visits with no event row
  -- are inserted, and a milestone created by that call gets one drawing
  -- entry only when reached_at >= p_entries_from.
  begin
    for v_user_id in
      select distinct r.user_id
      from public.redemptions r
      where r.status = 'verified'
        and r.verified_at is not null
        and r.user_id is not null
        and (p_user_id is null or r.user_id = p_user_id)
      order by r.user_id
    loop
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('wanderbite.progression.v1'),
        pg_catalog.hashtext(v_user_id::text)
      );

      insert into public.progression_events (
        user_id,
        source_kind,
        source_id,
        occurred_at,
        xp,
        schedule_version
      )
      select
        r.user_id,
        'verified_visit',
        r.id,
        r.verified_at,
        100,
        'v1'
      from public.redemptions r
      where r.user_id = v_user_id
        and r.status = 'verified'
        and r.verified_at is not null
      on conflict (source_kind, source_id) do nothing;

      get diagnostics v_member_events = row_count;

      if exists (
        select 1
        from public.redemptions r
        join public.progression_events e
          on e.source_kind = 'verified_visit'
         and e.source_id = r.id
        where r.user_id = v_user_id
          and r.status = 'verified'
          and r.verified_at is not null
          and e.user_id is distinct from r.user_id
      ) then
        raise exception 'progression event owner mismatch'
          using errcode = '23514';
      end if;

      v_member_milestones := 0;
      v_member_entries := 0;
      v_member_without := 0;

      for v_milestone in
        select *
        from public.progression_insert_missing_v1_milestones(v_user_id)
      loop
        v_member_milestones := v_member_milestones + 1;
        if v_milestone.reached_at >= p_entries_from then
          insert into public.progression_drawing_entries (
            user_id,
            milestone_id,
            quarter_key,
            entry_source
          ) values (
            v_milestone.user_id,
            v_milestone.id,
            v_milestone.quarter_key,
            'level_milestone'
          )
          on conflict (milestone_id) do nothing;

          get diagnostics v_wrote = row_count;
          if v_wrote > 0 then
            v_member_entries := v_member_entries + 1;
          end if;
        else
          v_member_without := v_member_without + 1;
        end if;
      end loop;

      if v_member_events > 0 or v_member_milestones > 0 then
        v_members := v_members + 1;
      end if;
      v_events := v_events + v_member_events;
      v_milestones := v_milestones + v_member_milestones;
      v_entries := v_entries + v_member_entries;
      v_without := v_without + v_member_without;
    end loop;

    if v_dry_run then
      raise exception 'progression backfill dry run'
        using errcode = 'P0001';
    end if;
  exception
    when sqlstate 'P0001' then
      if sqlerrm is distinct from 'progression backfill dry run' then
        raise;
      end if;
  end;

  return pg_catalog.jsonb_build_object(
    'members', v_members,
    'events', v_events,
    'milestones', v_milestones,
    'entries', v_entries,
    'milestones_without_entry', v_without
  );
end;
$$;

revoke all on function public.backfill_verified_visit_progress(timestamptz, uuid, boolean)
  from public, anon, authenticated, service_role;

grant execute on function public.backfill_verified_visit_progress(timestamptz, uuid, boolean)
  to service_role;

comment on function public.backfill_verified_visit_progress(timestamptz, uuid, boolean) is
  'Backfills verified visits onto the v1 progression ledger and is the recovery sweep for visits the inline recorder missed. p_entries_from is required and has no default; null raises and writes nothing. p_dry_run defaults to true and writes nothing. A drawing entry is inserted only for a milestone this call created whose reached_at is on or after p_entries_from. A second call with nothing missing returns zero counts. service_role only.';
