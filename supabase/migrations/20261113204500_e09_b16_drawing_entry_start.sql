-- E09-B16: live recording follows the drawing-entry start date.
-- Forward only. Does not edit 20261110182527_e09_a2_progression_ledger.sql
-- or 20261110185755_e09_a4_progression_backfill.sql.
-- Not applied to hosted. Do not run supabase db push for this file.
-- E09_PROGRESSION_LEDGER_ENABLED stays unset. This file does not set it.
-- verify_redemption and verify_redemption_and_settle are unchanged.
-- Level thresholds are unchanged. Milestones and XP events are unchanged.
-- Only the drawing-entry insert is gated.
--
-- progression_drawing_entries_from() is the only SQL copy of the start
-- instant. record_verified_visit_progress inserts an entry only when the
-- milestone it just created has reached_at >= that instant.
-- backfill_verified_visit_progress still requires p_entries_from. Null still
-- raises. Pass the helper's instant when the cutoff should match live
-- recording.
--
-- Rollback is a later forward migration that restores the previous recorder
-- body and drops progression_drawing_entries_from(). Rows already written stay.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.progression_drawing_entries_from()
returns timestamptz
language sql
immutable
security invoker
set search_path to pg_catalog, public
as $$
  select '2027-01-01 00:00:00-06'::timestamptz;
$$;

revoke all on function public.progression_drawing_entries_from()
  from public, anon, authenticated, service_role;

grant execute on function public.progression_drawing_entries_from()
  to current_user;

comment on function public.progression_drawing_entries_from() is
  'Canonical drawing-entry start: 2027-01-01 00:00 America/Chicago (CST, UTC-6). Same instant as DRAWING_ENTRIES_FROM_ISO in src/lib/progression/format.ts. Not granted to anon, authenticated, or service_role.';

comment on table public.progression_drawing_entries is
  'At most one drawing entry per milestone. A milestone whose reached_at is before progression_drawing_entries_from() has none. quarter_key is copied from the milestone at insert. No campaign.';

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

  -- Missing milestones come from the shared helper. An existing milestone is
  -- left alone, including its drawing entry. A milestone this call inserts
  -- gets one drawing entry only when reached_at is on or after
  -- progression_drawing_entries_from().
  for milestone in
    select *
    from public.progression_insert_missing_v1_milestones(redemption.user_id)
  loop
    milestone_json := milestone_json || pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(milestone));

    if milestone.reached_at >= public.progression_drawing_entries_from() then
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
  'Records one verified visit on the v1 progression ledger. Unknown id, a status other than verified, null verified_at, or null user_id returns null and writes nothing, without raising. A second call inserts nothing and returns empty events, milestones, and entries. Returned rows are only the ones this call inserted. Milestones come from progression_insert_missing_v1_milestones. A drawing entry is inserted only for a milestone this call inserts whose reached_at is on or after progression_drawing_entries_from(). An earlier milestone is stored and returned with no entry. reached_at and quarter_key come from the crossing event, not from the call time. Not called by verify_redemption.';
