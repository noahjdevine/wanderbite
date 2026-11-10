-- E09-A2 durable progression ledger.
-- Not applied to hosted. Do not run supabase db push for this file in this PR.
-- Nothing calls record_verified_visit_progress. verify_redemption and
-- verify_redemption_and_settle are unchanged. user_badges is unchanged.
-- A make-up visit is a normal verified redemption once status is verified and
-- verified_at is set. A savings correction does not change those columns.
-- This function does not read visit-problem tables and is not hooked to either path.
-- Rollback before a hosted apply is reverting this migration. After a hosted
-- apply, roll forward by dropping the three tables and this function.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.progression_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  -- verified_visit today. source_id is redemptions.id for that kind and is not
  -- a foreign key, so a later kind can store a different id in the same column.
  source_kind text not null,
  source_id uuid not null,
  -- Event time. For a verified visit this is redemptions.verified_at, not the
  -- time the row was inserted.
  occurred_at timestamptz not null,
  -- v1 awards XP_PER_VERIFIED_VISIT from src/lib/progress/rules.ts.
  xp integer not null,
  -- PROGRESSION_SCHEDULE_VERSION from src/lib/progression/schedule.ts.
  schedule_version text not null,
  created_at timestamptz not null default now(),
  constraint progression_events_source_kind_check
    check (source_kind in ('verified_visit')),
  constraint progression_events_xp_check
    check (xp = 100),
  constraint progression_events_schedule_version_check
    check (schedule_version in ('v1')),
  constraint progression_events_source_key unique (source_kind, source_id)
);

-- Leads with user_id, so it covers the user_id foreign key, member RLS, and
-- the per-member occurred_at order used to find a crossing visit.
create index progression_events_user_id_occurred_at_idx
  on public.progression_events (user_id, occurred_at, id);

comment on table public.progression_events is
  'One XP award per source. A verified visit is one row keyed by (verified_visit, redemptions.id). occurred_at is the visit verified time.';

comment on column public.progression_events.source_id is
  'For source_kind verified_visit, public.redemptions.id. Not a foreign key.';

create table public.progression_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  schedule_version text not null,
  level integer not null,
  -- ${scheduleVersion}:level:${level}, matching src/lib/progression/milestones.ts.
  milestone_key text not null,
  -- occurred_at of the event that crossed minXp when this row was inserted.
  reached_at timestamptz not null,
  -- America/Chicago calendar quarter of reached_at, YYYY-Qn.
  quarter_key text not null,
  source_event_id uuid not null references public.progression_events (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint progression_milestones_schedule_version_check
    check (schedule_version in ('v1')),
  constraint progression_milestones_level_check
    check (level >= 1),
  constraint progression_milestones_key_check
    check (milestone_key = schedule_version || ':level:' || level::text),
  constraint progression_milestones_quarter_key_check
    check (quarter_key ~ '^[0-9]{4}-Q[1-4]$'),
  constraint progression_milestones_user_milestone_key unique (user_id, milestone_key)
);

-- Unique (user_id, milestone_key) already covers the user_id foreign key.
create index progression_milestones_source_event_id_idx
  on public.progression_milestones (source_event_id);

comment on table public.progression_milestones is
  'One row per member per milestone_key. reached_at is frozen at insert to the crossing event time. A later event does not move it.';

create table public.progression_drawing_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  milestone_id uuid not null references public.progression_milestones (id) on delete cascade,
  quarter_key text not null,
  -- level_milestone today. Text, not an enum, so a later migration can allow
  -- another source. No campaign foreign key (campaigns are E09-B).
  entry_source text not null,
  created_at timestamptz not null default now(),
  constraint progression_drawing_entries_milestone_id_key unique (milestone_id),
  constraint progression_drawing_entries_quarter_key_check
    check (quarter_key ~ '^[0-9]{4}-Q[1-4]$'),
  constraint progression_drawing_entries_entry_source_check
    check (entry_source in ('level_milestone'))
);

-- Unique (milestone_id) already covers the milestone_id foreign key.
create index progression_drawing_entries_user_id_idx
  on public.progression_drawing_entries (user_id);

comment on table public.progression_drawing_entries is
  'One drawing entry per milestone. quarter_key is copied from the milestone at insert. No campaign.';

alter table public.progression_events enable row level security;
alter table public.progression_milestones enable row level security;
alter table public.progression_drawing_entries enable row level security;

revoke all on table public.progression_events
  from public, anon, authenticated, service_role;
revoke all on table public.progression_milestones
  from public, anon, authenticated, service_role;
revoke all on table public.progression_drawing_entries
  from public, anon, authenticated, service_role;

grant select on table public.progression_events to authenticated, service_role;
grant select on table public.progression_milestones to authenticated, service_role;
grant select on table public.progression_drawing_entries to authenticated, service_role;

-- Members read their own rows. No insert, update, or delete policy: those
-- writes are only the security definer function below. RLS is not forced, so
-- the function owner can write. Authenticated callers still need a policy.
create policy progression_events_select_own
  on public.progression_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy progression_milestones_select_own
  on public.progression_milestones
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy progression_drawing_entries_select_own
  on public.progression_drawing_entries
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

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
  due record;
  milestone public.progression_milestones%rowtype;
  entry public.progression_drawing_entries%rowtype;
  chicago_local timestamp;
  quarter text;
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
  for due in
    with ordered as (
      select
        e.id,
        e.occurred_at,
        row_number() over (order by e.occurred_at, e.id) as visit_n
      from public.progression_events e
      where e.user_id = redemption.user_id
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
    )
    select
      t.level,
      t.min_xp,
      o.id as source_event_id,
      o.occurred_at as reached_at
    from thresholds t
    join totals on t.min_xp <= totals.visits * 100
    join ordered o on o.visit_n = (t.min_xp / 100)
    order by t.level
  loop
    chicago_local := due.reached_at at time zone 'America/Chicago';
    quarter := pg_catalog.to_char(chicago_local, 'YYYY')
      || '-Q'
      || (((pg_catalog.date_part('month', chicago_local))::integer - 1) / 3 + 1)::text;

    insert into public.progression_milestones (
      user_id,
      schedule_version,
      level,
      milestone_key,
      reached_at,
      quarter_key,
      source_event_id
    ) values (
      redemption.user_id,
      'v1',
      due.level,
      'v1:level:' || due.level::text,
      due.reached_at,
      quarter,
      due.source_event_id
    )
    on conflict (user_id, milestone_key) do nothing
    returning * into milestone;

    if found then
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
  'Records one verified visit on the v1 progression ledger. Unknown id, a status other than verified, null verified_at, or null user_id returns null and writes nothing, without raising. A second call inserts nothing and returns empty events, milestones, and entries. Returned rows are only the ones this call inserted. reached_at and quarter_key come from the crossing event, not from the call time. Not called by verify_redemption.';
