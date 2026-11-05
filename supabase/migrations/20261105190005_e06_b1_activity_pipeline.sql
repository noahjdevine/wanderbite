-- E06-B1 activity subject on the shared content pipeline.
-- NOT applied to hosted. Forward-only. No drops.
-- Widens subject_type so an activity can sit beside a recipe.
-- Does not drop recipe RPCs. Adds activity-only apply, rollback, and expire helpers.
-- Adds activities.content_source_id, a nullable link to an approved source.
-- No credits, offers, bookings, or partnership columns.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.source_facts
  drop constraint source_facts_subject_type_check;

alter table public.source_facts
  add constraint source_facts_subject_type_check
  check (subject_type in ('recipe', 'activity'));

alter table public.content_exceptions
  drop constraint content_exceptions_subject_type_check;

alter table public.content_exceptions
  add constraint content_exceptions_subject_type_check
  check (subject_type is null or subject_type in ('recipe', 'activity'));

comment on table public.source_facts is
  'Versioned extracted facts. subject_type is recipe or activity. A newer version supersedes the current row. An activity fact is an operator draft and does not publish a partnership, booking, discount, credit, or offer.';

alter table public.activities
  add column content_source_id uuid;

alter table public.activities
  add constraint activities_content_source_id_fkey
  foreign key (content_source_id)
  references public.content_sources (id)
  on delete set null;

create index activities_content_source_id_idx
  on public.activities (content_source_id)
  where content_source_id is not null;

comment on column public.activities.content_source_id is
  'Optional link to the approved venue_page or event_page. Null when the activity is matched by https source_url only. Not a partnership, booking, or offer.';

-- Recipe description still refuses here. Activity facts use rollback_activity_field_fact.
create or replace function public.rollback_content_fact(p_fact_id uuid)
returns uuid
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
declare
  v_current public.source_facts;
  v_prev public.source_facts;
  v_next integer;
  v_id uuid;
begin
  select * into v_current
  from public.source_facts
  where id = p_fact_id
  for update;
  if v_current.id is null then
    raise exception 'fact not found' using errcode = 'P0002';
  end if;
  if v_current.subject_type = 'activity' then
    raise exception 'use rollback_activity_field_fact' using errcode = '22023';
  end if;
  if v_current.subject_type = 'recipe' and v_current.field = 'description' then
    raise exception 'use rollback_recipe_to_previous' using errcode = '22023';
  end if;
  if v_current.status is distinct from 'current' then
    select * into v_current
    from public.source_facts
    where source_id = v_current.source_id
      and subject_type = v_current.subject_type
      and subject_id is not distinct from v_current.subject_id
      and field = v_current.field
      and status = 'current'
    order by version desc
    limit 1
    for update;
  end if;
  if v_current.id is null then
    raise exception 'no current fact' using errcode = 'P0002';
  end if;
  select * into v_prev
  from public.source_facts
  where source_id = v_current.source_id
    and subject_type = v_current.subject_type
    and subject_id is not distinct from v_current.subject_id
    and field = v_current.field
    and version < v_current.version
  order by version desc
  limit 1;
  if v_prev.id is null then
    raise exception 'no previous fact version' using errcode = 'P0002';
  end if;
  select coalesce(max(version), 0) + 1 into v_next
  from public.source_facts
  where source_id = v_current.source_id
    and subject_type = v_current.subject_type
    and subject_id is not distinct from v_current.subject_id
    and field = v_current.field;
  update public.source_facts
  set status = 'superseded'
  where id = v_current.id;
  insert into public.source_facts (
    source_id, subject_type, subject_id, field, value, evidence_excerpt,
    version, status, verified_at
  ) values (
    v_current.source_id,
    v_current.subject_type,
    v_current.subject_id,
    v_current.field,
    v_prev.value,
    v_prev.evidence_excerpt,
    v_next,
    'current',
    pg_catalog.now()
  )
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.rollback_content_fact(uuid) is
  'Restores the previous fact value as a new version. Refuses recipe description facts and activity facts.';

-- Drafts a summary fact only. Does not insert an activity and does not update the activity row.
create or replace function public.apply_activity_field_fact(
  p_source_id uuid,
  p_activity_id uuid,
  p_field text,
  p_value jsonb,
  p_evidence_excerpt text
) returns uuid
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
declare
  v_activity public.activities;
  v_text text;
  v_version integer;
  v_id uuid;
begin
  if p_field is distinct from 'summary' then
    raise exception 'activity facts may only draft a summary' using errcode = '22023';
  end if;
  select * into v_activity
  from public.activities
  where id = p_activity_id
  for update;
  if v_activity.id is null then
    raise exception 'activity not found' using errcode = 'P0002';
  end if;
  v_text := btrim(p_value ->> 'text');
  if v_text is null or v_text = '' or char_length(v_text) > 400 then
    raise exception 'activity summary is not storable' using errcode = '22023';
  end if;
  if v_text ~* '\m(partnerships?|bookings?|discounts?|credits?|offers?)\M' then
    raise exception 'activity summary cannot state a partnership, booking, discount, credit, or offer'
      using errcode = '22023';
  end if;
  if p_evidence_excerpt is null or char_length(p_evidence_excerpt) < 1 or char_length(p_evidence_excerpt) > 240 then
    raise exception 'activity evidence excerpt is not storable' using errcode = '22023';
  end if;
  select coalesce(max(version), 0) + 1 into v_version
  from public.source_facts
  where source_id = p_source_id
    and subject_type = 'activity'
    and subject_id = p_activity_id
    and field = 'summary';
  update public.source_facts
  set status = 'superseded'
  where source_id = p_source_id
    and subject_type = 'activity'
    and subject_id = p_activity_id
    and field = 'summary'
    and status = 'pending_review';
  insert into public.source_facts (
    source_id, subject_type, subject_id, field, value, evidence_excerpt,
    version, status
  ) values (
    p_source_id,
    'activity',
    p_activity_id,
    'summary',
    jsonb_build_object('text', v_text),
    p_evidence_excerpt,
    v_version,
    'pending_review'
  )
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.apply_activity_field_fact(uuid, uuid, text, jsonb, text) is
  'Writes one pending_review activity summary fact. Requires an existing activity. Does not insert an activity and does not change the activity row.';

create or replace function public.rollback_activity_field_fact(p_fact_id uuid)
returns uuid
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
declare
  v_current public.source_facts;
  v_prev public.source_facts;
  v_next integer;
  v_id uuid;
begin
  select * into v_current
  from public.source_facts
  where id = p_fact_id
  for update;
  if v_current.id is null then
    raise exception 'fact not found' using errcode = 'P0002';
  end if;
  if v_current.subject_type is distinct from 'activity' then
    raise exception 'not an activity fact' using errcode = '22023';
  end if;
  select * into v_current
  from public.source_facts
  where source_id = v_current.source_id
    and subject_type = 'activity'
    and subject_id is not distinct from v_current.subject_id
    and field = v_current.field
    and status in ('pending_review', 'current')
  order by version desc
  limit 1
  for update;
  if v_current.id is null then
    raise exception 'no activity fact to roll back' using errcode = 'P0002';
  end if;
  select * into v_prev
  from public.source_facts
  where source_id = v_current.source_id
    and subject_type = v_current.subject_type
    and subject_id is not distinct from v_current.subject_id
    and field = v_current.field
    and version < v_current.version
  order by version desc
  limit 1;
  if v_prev.id is null then
    raise exception 'no previous activity fact version' using errcode = 'P0002';
  end if;
  select coalesce(max(version), 0) + 1 into v_next
  from public.source_facts
  where source_id = v_current.source_id
    and subject_type = v_current.subject_type
    and subject_id is not distinct from v_current.subject_id
    and field = v_current.field;
  update public.source_facts
  set status = 'superseded'
  where id = v_current.id;
  insert into public.source_facts (
    source_id, subject_type, subject_id, field, value, evidence_excerpt,
    version, status
  ) values (
    v_current.source_id,
    'activity',
    v_current.subject_id,
    v_current.field,
    v_prev.value,
    v_prev.evidence_excerpt,
    v_next,
    'pending_review'
  )
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.rollback_activity_field_fact(uuid) is
  'Restores the previous activity fact as a new pending_review version. Does not delete history and does not change the activity row.';

-- Marks dated activities expired. Does not delete rows and does not touch dinner tables.
create or replace function public.expire_dated_activities(p_today date)
returns integer
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
declare
  v_count integer;
begin
  if p_today is null then
    raise exception 'chicago date is required' using errcode = '22023';
  end if;
  update public.activities
  set status = 'expired'
  where status = 'active'
    and valid_until is not null
    and valid_until < p_today;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.expire_dated_activities(date) is
  'Sets status=expired when valid_until is before the caller Chicago date. Does not delete rows. Does not write credits, offers, challenges, or redemptions.';

revoke all on function public.apply_activity_field_fact(uuid, uuid, text, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.rollback_activity_field_fact(uuid) from public, anon, authenticated, service_role;
revoke all on function public.expire_dated_activities(date) from public, anon, authenticated, service_role;

grant execute on function public.apply_activity_field_fact(uuid, uuid, text, jsonb, text) to service_role;
grant execute on function public.rollback_activity_field_fact(uuid) to service_role;
grant execute on function public.expire_dated_activities(date) to service_role;
