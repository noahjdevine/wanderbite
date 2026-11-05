-- E06-B3 operator review for activity drafts and exceptions.
-- NOT applied to hosted. Forward-only. No drops of tables or rows.
-- Widens source_facts.status with 'reviewed'. Replaces the check; does not rewrite rows.
-- Adds service_role helpers for the existing /admin/content queue.
-- Does not publish a price, allergen, partnership, booking, discount, credit, or offer.
-- Does not insert an activity. Hours edits change hours_note and version only.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.source_facts
  drop constraint source_facts_status_check;

alter table public.source_facts
  add constraint source_facts_status_check
  check (status in ('current', 'superseded', 'pending_review', 'reviewed', 'rejected'));

comment on table public.source_facts is
  'Versioned extracted facts. subject_type is recipe or activity. A newer version supersedes the current row. An activity summary can stay pending_review, be marked reviewed without becoming current, or be rejected. A current activity summary is an operator version and does not write the activity row.';

-- Normalizes operator text and refuses claims. Does not write.
create or replace function public.activity_operator_text(p_text text, p_kind text)
returns text
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
declare
  v_text text;
  v_max integer;
begin
  if p_kind is distinct from 'summary' and p_kind is distinct from 'hours_note' then
    raise exception 'activity text kind is not storable' using errcode = '22023';
  end if;
  v_text := regexp_replace(btrim(coalesce(p_text, '')), '[[:space:]]+', ' ', 'g');
  v_max := case when p_kind = 'summary' then 400 else 240 end;
  if v_text = '' or char_length(v_text) > v_max then
    raise exception 'activity text is not storable' using errcode = '22023';
  end if;
  if v_text ~* '\m(partnerships?|bookings?|discounts?|credits?|offers?)\M'
    or v_text ~* 'ignore[[:space:]]+(all[[:space:]]+|previous[[:space:]]+|prior[[:space:]]+)?instructions'
    or v_text ~* '\mpublish[[:space:]]+all\M'
    or v_text ~* 'restaurant_approved'
    or v_text ~* 'sourced_published'
    or v_text ~* '\mallergen-safe\M'
    or v_text ~* '\mallergy-safe\M'
    or v_text ~* '\msafe[[:space:]]+for\M'
    or v_text ~* 'gluten[-[:space:]]?free'
    or v_text ~* 'dairy[-[:space:]]?free'
    or v_text ~* 'nut[-[:space:]]?free'
    or v_text ~* '\mallergen\M'
    or v_text ~* '\mallergy\M'
    or v_text ~ '\$[[:space:]]?[0-9]'
  then
    raise exception 'activity text cannot state a claim' using errcode = '22023';
  end if;
  if p_kind = 'summary' and (
    v_text ~* '\m(hours|open[[:space:]]+daily|open[[:space:]]+from)\M'
    or v_text ~* '\m[0-9]{1,2}(:[0-9]{2})?[[:space:]]*(a\.m\.|p\.m\.|am|pm)\M'
  ) then
    raise exception 'activity summary cannot state hours' using errcode = '22023';
  end if;
  return v_text;
end;
$$;

comment on function public.activity_operator_text(text, text) is
  'Normalizes operator text for an activity summary or hours note. Refuses claim, price, allergen, and injection wording. A summary also refuses hours. Does not write.';

-- Marks a pending activity summary reviewed or rejected. Does not insert a version and does not update the activity.
create or replace function public.decide_activity_summary_fact(
  p_fact_id uuid,
  p_decision text
) returns uuid
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
declare
  v_fact public.source_facts;
begin
  if p_decision is distinct from 'approve' and p_decision is distinct from 'reject' then
    raise exception 'activity summary decision is not storable' using errcode = '22023';
  end if;
  select * into v_fact
  from public.source_facts
  where id = p_fact_id
  for update;
  if v_fact.id is null then
    raise exception 'fact not found' using errcode = 'P0002';
  end if;
  if v_fact.subject_type is distinct from 'activity'
    or v_fact.field is distinct from 'summary'
    or v_fact.status is distinct from 'pending_review'
  then
    raise exception 'activity summary is not pending review' using errcode = '22023';
  end if;
  if p_decision = 'approve' then
    update public.source_facts
    set status = 'reviewed',
        verified_at = pg_catalog.now()
    where id = v_fact.id;
  else
    update public.source_facts
    set status = 'rejected'
    where id = v_fact.id;
  end if;
  return v_fact.id;
end;
$$;

comment on function public.decide_activity_summary_fact(uuid, text) is
  'Approves a pending activity summary as reviewed, or rejects it. Does not make it current and does not change the activity row.';

-- Operator text becomes a new current summary. Prior pending and current rows stay as superseded.
create or replace function public.publish_activity_summary(
  p_source_id uuid,
  p_activity_id uuid,
  p_text text,
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
  v_text := public.activity_operator_text(p_text, 'summary');
  if p_evidence_excerpt is null
    or char_length(p_evidence_excerpt) < 1
    or char_length(p_evidence_excerpt) > 240
  then
    raise exception 'activity evidence excerpt is not storable' using errcode = '22023';
  end if;
  select * into v_activity
  from public.activities
  where id = p_activity_id
  for update;
  if v_activity.id is null then
    raise exception 'activity not found' using errcode = 'P0002';
  end if;
  select coalesce(max(version), 0) into v_version
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
    and status in ('pending_review', 'current');
  insert into public.source_facts (
    source_id, subject_type, subject_id, field, value, evidence_excerpt,
    version, status, verified_at
  ) values (
    p_source_id,
    'activity',
    p_activity_id,
    'summary',
    jsonb_build_object('text', v_text),
    p_evidence_excerpt,
    v_version + 1,
    'current',
    pg_catalog.now()
  )
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.publish_activity_summary(uuid, uuid, text, text) is
  'Stores operator text as a new current activity summary and keeps prior versions. Does not change the activity row.';

-- Writes hours_note, bumps version, and keeps the previous note as a fact. No other activity column is set.
create or replace function public.publish_activity_hours_note(
  p_source_id uuid,
  p_activity_id uuid,
  p_text text,
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
  v_prior text;
begin
  v_text := public.activity_operator_text(p_text, 'hours_note');
  if p_evidence_excerpt is null
    or char_length(p_evidence_excerpt) < 1
    or char_length(p_evidence_excerpt) > 240
  then
    raise exception 'activity evidence excerpt is not storable' using errcode = '22023';
  end if;
  select * into v_activity
  from public.activities
  where id = p_activity_id
  for update;
  if v_activity.id is null then
    raise exception 'activity not found' using errcode = 'P0002';
  end if;
  select coalesce(max(version), 0) into v_version
  from public.source_facts
  where source_id = p_source_id
    and subject_type = 'activity'
    and subject_id = p_activity_id
    and field = 'hours_note';
  update public.source_facts
  set status = 'superseded'
  where source_id = p_source_id
    and subject_type = 'activity'
    and subject_id = p_activity_id
    and field = 'hours_note'
    and status = 'current';
  v_prior := nullif(btrim(v_activity.hours_note), '');
  if v_prior is not null and v_prior is distinct from v_text and not exists (
    select 1
    from public.source_facts
    where source_id = p_source_id
      and subject_type = 'activity'
      and subject_id = p_activity_id
      and field = 'hours_note'
      and value ->> 'text' = v_prior
  ) then
    v_version := v_version + 1;
    insert into public.source_facts (
      source_id, subject_type, subject_id, field, value, evidence_excerpt,
      version, status
    ) values (
      p_source_id,
      'activity',
      p_activity_id,
      'hours_note',
      jsonb_build_object('text', v_prior),
      case
        when char_length(v_prior) between 1 and 240 then v_prior
        else left(v_prior, 240)
      end,
      v_version,
      'superseded'
    );
  end if;
  v_version := v_version + 1;
  insert into public.source_facts (
    source_id, subject_type, subject_id, field, value, evidence_excerpt,
    version, status, verified_at
  ) values (
    p_source_id,
    'activity',
    p_activity_id,
    'hours_note',
    jsonb_build_object('text', v_text),
    p_evidence_excerpt,
    v_version,
    'current',
    pg_catalog.now()
  )
  returning id into v_id;
  update public.activities
  set hours_note = v_text,
      version = version + 1
  where id = p_activity_id;
  return v_id;
end;
$$;

comment on function public.publish_activity_hours_note(uuid, uuid, text, text) is
  'Sets activities.hours_note to operator text and increments version. Keeps the previous note as a superseded fact. Does not set any other activity column.';

revoke all on function public.activity_operator_text(text, text) from public, anon, authenticated, service_role;
revoke all on function public.decide_activity_summary_fact(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.publish_activity_summary(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.publish_activity_hours_note(uuid, uuid, text, text) from public, anon, authenticated, service_role;

grant execute on function public.activity_operator_text(text, text) to service_role;
grant execute on function public.decide_activity_summary_fact(uuid, text) to service_role;
grant execute on function public.publish_activity_summary(uuid, uuid, text, text) to service_role;
grant execute on function public.publish_activity_hours_note(uuid, uuid, text, text) to service_role;
