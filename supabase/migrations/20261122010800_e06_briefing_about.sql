-- E06 about paragraph.
-- NOT applied to hosted. Forward-only. Noah approves any apply.
-- Allows restaurant_briefing_facts.field = 'about'.
-- About body is 1–600 characters. Every other briefing field stays 1–400.
-- Adds optional internal sources jsonb. Client roles cannot select it.
-- Does not insert rows. Does not change existing RLS policies.
-- Does not write credits, offers, bookings, XP, or partner columns.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.restaurant_briefing_facts
  drop constraint restaurant_briefing_facts_field_check;

alter table public.restaurant_briefing_facts
  add constraint restaurant_briefing_facts_field_check
  check (
    field in (
      'parking',
      'arrival',
      'what_to_expect',
      'duration',
      'attire',
      'accessibility',
      'vibe',
      'known_for',
      'good_for',
      'seating',
      'reservations',
      'about'
    )
  );

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
    'accessibility',
    'vibe',
    'known_for',
    'good_for',
    'seating',
    'reservations',
    'about'
  ) then
    raise exception 'briefing field is not storable' using errcode = '22023';
  end if;
  return p_field;
end;
$$;

comment on function public.briefing_field_name(text) is
  'Returns a stored briefing field name. Accepts the twelve stored fields, including about. Refuses any other field. Does not write.';

revoke all on function public.briefing_field_name(text) from public, anon, authenticated, service_role;
grant execute on function public.briefing_field_name(text) to service_role;

alter table public.restaurant_briefing_facts
  add column sources jsonb;

comment on column public.restaurant_briefing_facts.sources is
  'Optional extra https sources for one fact. Used when an about paragraph has more than source_url. Internal only. Client roles cannot select this column.';

create or replace function public.briefing_fact_sources_ok(p_sources jsonb)
returns boolean
language sql
immutable
security invoker
set search_path to pg_catalog
as $$
  select p_sources is null
    or (
      jsonb_typeof(p_sources) = 'array'
      and jsonb_array_length(p_sources) between 1 and 8
      and not exists (
        select 1
        from jsonb_array_elements_text(p_sources) as extra(url)
        where char_length(url) < 12
          or char_length(url) > 500
          or url !~ '^https://[^[:space:]]+$'
      )
    );
$$;

comment on function public.briefing_fact_sources_ok(jsonb) is
  'True when sources is null or a list of one to eight https URLs. Does not write.';

revoke all on function public.briefing_fact_sources_ok(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.briefing_fact_sources_ok(jsonb) to service_role;

alter table public.restaurant_briefing_facts
  add constraint restaurant_briefing_facts_sources_check
  check (public.briefing_fact_sources_ok(sources));

-- Existing row policies stay. Client roles keep the columns they already read.
-- sources is omitted so a member select cannot return the extra URL list.
revoke select on table public.restaurant_briefing_facts from public, anon, authenticated;

grant select (
  id,
  restaurant_id,
  field,
  body,
  source_url,
  last_verified_at,
  status,
  is_sample,
  version,
  created_at,
  updated_at
) on table public.restaurant_briefing_facts to anon, authenticated;

alter table public.restaurant_briefing_facts
  drop constraint restaurant_briefing_facts_body_check;

alter table public.restaurant_briefing_facts
  add constraint restaurant_briefing_facts_body_check
  check (
    (
      field = 'about'
      and char_length(body) between 1 and 600
      and char_length(btrim(body)) between 1 and 600
    )
    or (
      field is distinct from 'about'
      and char_length(body) between 1 and 400
      and char_length(btrim(body)) between 1 and 400
    )
  );

comment on column public.restaurant_briefing_facts.body is
  'The fact shown to the member. About is 1–600 characters. Every other field is 1–400. Missing facts are omitted by storing no row.';

-- Field-aware length. The one-argument function stays at 400 for existing callers.
create or replace function public.briefing_operator_text(p_text text, p_field text)
returns text
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
declare
  v_text text;
  v_limit integer;
begin
  v_limit := case when p_field = 'about' then 600 else 400 end;
  v_text := regexp_replace(btrim(coalesce(p_text, '')), '[[:space:]]+', ' ', 'g');
  if v_text = '' or char_length(v_text) > v_limit then
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

comment on function public.briefing_operator_text(text, text) is
  'Normalizes operator briefing text. About may be 600 characters. Every other field stays at 400. Refuses claim, price, allergen, and injection wording. Does not write.';

revoke all on function public.briefing_operator_text(text, text) from public, anon, authenticated, service_role;
grant execute on function public.briefing_operator_text(text, text) to service_role;

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
  v_text := public.briefing_operator_text(p_value ->> 'text', v_field);
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
  v_text := public.briefing_operator_text(p_text, v_field);
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
