-- E06-B5 change summaries and pending-draft dedup.
-- NOT applied to hosted. Forward-only. No new tables or columns. No drops.
-- Replaces apply_briefing_field_fact and apply_activity_field_fact in place.
-- Signatures stay the same. source_facts.value may include change_summary.
-- An open pending_review row with the same subject and normalized text is returned as-is.
-- History is not deleted and that open row is not superseded.
-- Does not write credits, offers, challenges, redemptions, bookings, or partnerships.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.apply_briefing_field_fact(
  p_source_id uuid,
  p_restaurant_id uuid,
  p_field text,
  p_value jsonb,
  p_evidence_excerpt text
) returns uuid
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
declare
  v_source public.content_sources;
  v_fact public.restaurant_briefing_facts;
  v_field text;
  v_text text;
  v_before text;
  v_summary text;
  v_version integer;
  v_id uuid;
  v_open uuid;
  v_evidence text;
begin
  v_field := public.briefing_field_name(p_field);
  v_text := public.briefing_operator_text(p_value ->> 'text');
  v_evidence := btrim(coalesce(p_evidence_excerpt, ''));
  if v_evidence = '' or char_length(v_evidence) > 240 then
    raise exception 'briefing evidence excerpt is not storable' using errcode = '22023';
  end if;
  select * into v_source
  from public.content_sources
  where id = p_source_id
  for update;
  if v_source.id is null then
    raise exception 'content source not found' using errcode = 'P0002';
  end if;
  if v_source.kind is distinct from 'restaurant_page' then
    raise exception 'briefing facts require a restaurant_page source' using errcode = '22023';
  end if;
  if v_source.restaurant_id is distinct from p_restaurant_id then
    raise exception 'briefing source restaurant does not match' using errcode = '22023';
  end if;
  select * into v_fact
  from public.restaurant_briefing_facts
  where restaurant_id = p_restaurant_id
    and field = v_field
  for update;
  v_before := nullif(btrim(coalesce(p_value ->> 'before', '')), '');
  if v_fact.id is not null and v_fact.status = 'active' and v_fact.body is distinct from v_text then
    if not exists (
      select 1
      from public.content_exceptions
      where source_id = p_source_id
        and subject_type = 'briefing'
        and subject_id = p_restaurant_id
        and field = v_field
        and reason = 'conflict'
        and status = 'open'
    ) then
      insert into public.content_exceptions (
        source_id, subject_type, subject_id, field, reason, before, after, evidence_excerpt, status
      ) values (
        p_source_id,
        'briefing',
        p_restaurant_id,
        v_field,
        'conflict',
        jsonb_build_object('text', v_fact.body),
        jsonb_build_object('text', v_text),
        v_evidence,
        'open'
      );
    end if;
    return null;
  end if;
  if v_fact.id is not null and v_fact.body is not distinct from v_text then
    return null;
  end if;
  select id into v_open
  from public.source_facts
  where subject_type = 'briefing'
    and subject_id = p_restaurant_id
    and field = v_field
    and status = 'pending_review'
    and regexp_replace(btrim(coalesce(value ->> 'text', '')), '[[:space:]]+', ' ', 'g') = v_text
  order by version desc
  limit 1
  for update;
  if v_open is not null then
    return v_open;
  end if;
  v_summary := nullif(btrim(regexp_replace(coalesce(p_value ->> 'change_summary', ''), '[[:space:]]+', ' ', 'g')), '');
  if v_summary is not null and char_length(v_summary) > 160 then
    v_summary := rtrim(pg_catalog.left(v_summary, 159)) || '…';
  end if;
  select coalesce(max(version), 0) + 1 into v_version
  from public.source_facts
  where source_id = p_source_id
    and subject_type = 'briefing'
    and subject_id = p_restaurant_id
    and field = v_field;
  update public.source_facts
  set status = 'superseded'
  where source_id = p_source_id
    and subject_type = 'briefing'
    and subject_id = p_restaurant_id
    and field = v_field
    and status = 'pending_review';
  insert into public.source_facts (
    source_id, subject_type, subject_id, field, value, evidence_excerpt, version, status
  ) values (
    p_source_id,
    'briefing',
    p_restaurant_id,
    v_field,
    jsonb_strip_nulls(jsonb_build_object(
      'text', v_text,
      'before', coalesce(v_before, v_fact.body),
      'change_summary', v_summary
    )),
    v_evidence,
    v_version,
    'pending_review'
  )
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.apply_briefing_field_fact(uuid, uuid, text, jsonb, text) is
  'Writes one pending_review briefing draft, including change_summary when supplied. Skips a second row when an open draft already has the same normalized text. Does not insert or update restaurant_briefing_facts. An active row with different text opens a conflict and is left unchanged.';

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
  v_norm text;
  v_summary text;
  v_version integer;
  v_id uuid;
  v_open uuid;
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
  v_norm := regexp_replace(v_text, '[[:space:]]+', ' ', 'g');
  select id into v_open
  from public.source_facts
  where subject_type = 'activity'
    and subject_id = p_activity_id
    and field = 'summary'
    and status = 'pending_review'
    and regexp_replace(btrim(coalesce(value ->> 'text', '')), '[[:space:]]+', ' ', 'g') = v_norm
  order by version desc
  limit 1
  for update;
  if v_open is not null then
    return v_open;
  end if;
  v_summary := nullif(btrim(regexp_replace(coalesce(p_value ->> 'change_summary', ''), '[[:space:]]+', ' ', 'g')), '');
  if v_summary is not null and char_length(v_summary) > 160 then
    v_summary := rtrim(pg_catalog.left(v_summary, 159)) || '…';
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
    jsonb_strip_nulls(jsonb_build_object('text', v_text, 'change_summary', v_summary)),
    p_evidence_excerpt,
    v_version,
    'pending_review'
  )
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.apply_activity_field_fact(uuid, uuid, text, jsonb, text) is
  'Writes one pending_review activity summary fact, including change_summary when supplied. Skips a second row when an open draft already has the same normalized text. Requires an existing activity. Does not insert an activity and does not change the activity row.';

revoke all on function public.apply_briefing_field_fact(uuid, uuid, text, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.apply_activity_field_fact(uuid, uuid, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.apply_briefing_field_fact(uuid, uuid, text, jsonb, text) to service_role;
grant execute on function public.apply_activity_field_fact(uuid, uuid, text, jsonb, text) to service_role;
