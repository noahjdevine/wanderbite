-- E06-B4 targeted briefing updates on the shared content pipeline.
-- NOT applied to hosted. Forward-only. No drops of tables or rows.
-- Widens content_sources.kind with restaurant_page and subject_type with briefing.
-- Drafts stay pending_review facts. Apply never sets restaurant_briefing_facts.status to active.
-- Operator publish writes the member table: paused unless the row is already active and the operator keeps it active.
-- Does not write credits, offers, challenges, redemptions, bookings, or partnerships.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.content_sources
  drop constraint content_sources_kind_check;

alter table public.content_sources
  add constraint content_sources_kind_check
  check (kind in ('public_menu', 'venue_page', 'event_page', 'restaurant_page'));

alter table public.content_sources
  add constraint content_sources_restaurant_page_restaurant_check
  check (kind is distinct from 'restaurant_page' or restaurant_id is not null);

comment on table public.content_sources is
  'Approved operator sources for the maintenance pipeline. public_menu is the menu kind. venue_page and event_page are activity sources. restaurant_page is an https official site for first-visit refresh and requires restaurant_id. No member access.';

alter table public.source_facts
  drop constraint source_facts_subject_type_check;

alter table public.source_facts
  add constraint source_facts_subject_type_check
  check (subject_type in ('recipe', 'activity', 'briefing'));

alter table public.content_exceptions
  drop constraint content_exceptions_subject_type_check;

alter table public.content_exceptions
  add constraint content_exceptions_subject_type_check
  check (subject_type is null or subject_type in ('recipe', 'activity', 'briefing'));

comment on table public.source_facts is
  'Versioned extracted facts. subject_type is recipe, activity, or briefing. A newer version supersedes the current row. A briefing draft can stay pending_review, be marked reviewed without becoming current, or be rejected. A current briefing fact is an operator version. Apply does not activate restaurant_briefing_facts.';

-- Normalizes operator briefing text and refuses claims. Does not write.
create or replace function public.briefing_operator_text(p_text text)
returns text
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
declare
  v_text text;
begin
  v_text := regexp_replace(btrim(coalesce(p_text, '')), '[[:space:]]+', ' ', 'g');
  if v_text = '' or char_length(v_text) > 400 then
    raise exception 'briefing text is not storable' using errcode = '22023';
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
    raise exception 'briefing text cannot state a claim' using errcode = '22023';
  end if;
  return v_text;
end;
$$;

comment on function public.briefing_operator_text(text) is
  'Normalizes operator text for a first-visit fact. Refuses claim, price, allergen, and injection wording. Does not write.';

create or replace function public.briefing_field_name(p_field text)
returns text
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
begin
  if p_field is null or p_field not in (
    'parking',
    'arrival',
    'what_to_expect',
    'duration',
    'attire',
    'accessibility'
  ) then
    raise exception 'briefing field is not storable' using errcode = '22023';
  end if;
  return p_field;
end;
$$;

comment on function public.briefing_field_name(text) is
  'Returns a first-visit field name. Refuses any other field. Does not write.';

-- Drafts one pending_review briefing fact. Never sets restaurant_briefing_facts to active.
-- A change to an active member-visible row opens a conflict and writes no fact.
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
  v_version integer;
  v_id uuid;
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
    jsonb_strip_nulls(jsonb_build_object('text', v_text, 'before', coalesce(v_before, v_fact.body))),
    v_evidence,
    v_version,
    'pending_review'
  )
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.apply_briefing_field_fact(uuid, uuid, text, jsonb, text) is
  'Writes one pending_review briefing draft. Does not insert or update restaurant_briefing_facts. An active row with different text opens a conflict and is left unchanged.';

create or replace function public.rollback_briefing_field_fact(p_fact_id uuid)
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
  if v_current.subject_type is distinct from 'briefing' then
    raise exception 'not a briefing fact' using errcode = '22023';
  end if;
  select * into v_current
  from public.source_facts
  where source_id = v_current.source_id
    and subject_type = 'briefing'
    and subject_id is not distinct from v_current.subject_id
    and field = v_current.field
    and status in ('pending_review', 'current')
  order by version desc
  limit 1
  for update;
  if v_current.id is null then
    raise exception 'no briefing fact to roll back' using errcode = 'P0002';
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
    raise exception 'no previous briefing fact version' using errcode = 'P0002';
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
    source_id, subject_type, subject_id, field, value, evidence_excerpt, version, status
  ) values (
    v_current.source_id,
    'briefing',
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

comment on function public.rollback_briefing_field_fact(uuid) is
  'Restores the previous briefing fact as a new pending_review version. Does not delete history and does not change restaurant_briefing_facts.';

-- Marks a pending briefing draft reviewed or rejected. Does not write restaurant_briefing_facts.
create or replace function public.decide_briefing_fact(
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
    raise exception 'briefing decision is not storable' using errcode = '22023';
  end if;
  select * into v_fact
  from public.source_facts
  where id = p_fact_id
  for update;
  if v_fact.id is null then
    raise exception 'fact not found' using errcode = 'P0002';
  end if;
  if v_fact.subject_type is distinct from 'briefing'
    or v_fact.status is distinct from 'pending_review'
  then
    raise exception 'briefing fact is not pending review' using errcode = '22023';
  end if;
  perform public.briefing_field_name(v_fact.field);
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

comment on function public.decide_briefing_fact(uuid, text) is
  'Approves a pending briefing draft as reviewed, or rejects it. Does not make it current and does not change restaurant_briefing_facts.';

-- Operator text becomes a new current fact and updates the member row.
-- A missing or paused row stays paused. An active row stays active only when p_keep_active is true.
create or replace function public.publish_briefing_fact(
  p_source_id uuid,
  p_restaurant_id uuid,
  p_field text,
  p_text text,
  p_evidence_excerpt text,
  p_keep_active boolean
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
  v_status text;
  v_version integer;
  v_id uuid;
  v_evidence text;
  v_prior text;
begin
  v_field := public.briefing_field_name(p_field);
  v_text := public.briefing_operator_text(p_text);
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
  if v_source.kind is distinct from 'restaurant_page'
    or v_source.restaurant_id is distinct from p_restaurant_id
    or v_source.url !~ '^https://[^[:space:]]+$'
  then
    raise exception 'briefing source is not an https restaurant page' using errcode = '22023';
  end if;
  select * into v_fact
  from public.restaurant_briefing_facts
  where restaurant_id = p_restaurant_id
    and field = v_field
  for update;
  if v_fact.id is not null and v_fact.status = 'active' and coalesce(p_keep_active, false) then
    v_status := 'active';
  else
    v_status := 'paused';
  end if;
  select coalesce(max(version), 0) into v_version
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
    and status in ('pending_review', 'current');
  v_prior := case when v_fact.id is null then null else v_fact.body end;
  if v_prior is not null and v_prior is distinct from v_text and not exists (
    select 1
    from public.source_facts
    where source_id = p_source_id
      and subject_type = 'briefing'
      and subject_id = p_restaurant_id
      and field = v_field
      and value ->> 'text' = v_prior
  ) then
    v_version := v_version + 1;
    insert into public.source_facts (
      source_id, subject_type, subject_id, field, value, evidence_excerpt, version, status
    ) values (
      p_source_id,
      'briefing',
      p_restaurant_id,
      v_field,
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
    'briefing',
    p_restaurant_id,
    v_field,
    jsonb_build_object('text', v_text),
    v_evidence,
    v_version,
    'current',
    pg_catalog.now()
  )
  returning id into v_id;
  if v_fact.id is null then
    insert into public.restaurant_briefing_facts (
      restaurant_id, field, body, source_url, last_verified_at, status, is_sample, version
    ) values (
      p_restaurant_id,
      v_field,
      v_text,
      v_source.url,
      pg_catalog.now(),
      'paused',
      false,
      1
    );
  else
    update public.restaurant_briefing_facts
    set body = v_text,
        source_url = v_source.url,
        last_verified_at = pg_catalog.now(),
        status = v_status,
        version = version + 1
    where id = v_fact.id;
  end if;
  return v_id;
end;
$$;

comment on function public.publish_briefing_fact(uuid, uuid, text, text, text, boolean) is
  'Stores operator text as a new current briefing fact and keeps prior versions. Writes restaurant_briefing_facts as paused unless the existing row is active and p_keep_active is true.';

-- Recipe description and activity facts still refuse here. Briefing facts use rollback_briefing_field_fact.
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
  if v_current.subject_type = 'briefing' then
    raise exception 'use rollback_briefing_field_fact' using errcode = '22023';
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
  'Restores the previous fact value as a new version. Refuses recipe description facts, activity facts, and briefing facts.';

revoke all on function public.briefing_operator_text(text) from public, anon, authenticated, service_role;
revoke all on function public.briefing_field_name(text) from public, anon, authenticated, service_role;
revoke all on function public.apply_briefing_field_fact(uuid, uuid, text, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.rollback_briefing_field_fact(uuid) from public, anon, authenticated, service_role;
revoke all on function public.decide_briefing_fact(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.publish_briefing_fact(uuid, uuid, text, text, text, boolean) from public, anon, authenticated, service_role;

grant execute on function public.briefing_operator_text(text) to service_role;
grant execute on function public.briefing_field_name(text) to service_role;
grant execute on function public.apply_briefing_field_fact(uuid, uuid, text, jsonb, text) to service_role;
grant execute on function public.rollback_briefing_field_fact(uuid) to service_role;
grant execute on function public.decide_briefing_fact(uuid, text) to service_role;
grant execute on function public.publish_briefing_fact(uuid, uuid, text, text, text, boolean) to service_role;
