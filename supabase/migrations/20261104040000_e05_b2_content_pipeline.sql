-- E05-B2 shared content-pipeline registry.
-- Operator / service role only. Members cannot read or write these tables.
-- Not applied to hosted until Noah approves. Forward-only.
-- Registry URLs are inserted by scripts/content-refresh.ts, not by this file.
-- E06 can add subject types later. kind already allows venue_page and event_page.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.content_sources (
  id uuid primary key default uuid_generate_v4(),
  kind text not null,
  url text not null,
  restaurant_id uuid references public.restaurants (id) on delete set null,
  approved_at timestamptz not null default now(),
  approved_by uuid,
  status text not null default 'active',
  last_attempted_at timestamptz,
  last_verified_at timestamptz,
  last_content_hash text,
  notes text,
  constraint content_sources_url_key unique (url),
  constraint content_sources_kind_check check (
    kind in ('public_menu', 'venue_page', 'event_page')
  ),
  constraint content_sources_status_check check (
    status in ('active', 'paused', 'retired')
  ),
  constraint content_sources_url_check check (
    char_length(url) between 12 and 500
    and url ~ '^https://[^[:space:]]+$'
  ),
  constraint content_sources_hash_check check (
    last_content_hash is null or last_content_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint content_sources_notes_check check (
    notes is null or char_length(notes) between 1 and 2000
  )
);

create index content_sources_restaurant_id_idx on public.content_sources (restaurant_id);
create index content_sources_status_idx on public.content_sources (status);

comment on table public.content_sources is
  'Approved operator sources for the maintenance pipeline. public_menu is the E05-B2 kind. venue_page and event_page are reserved for E06. No member access.';

create table public.source_fetch_attempts (
  id uuid primary key default uuid_generate_v4(),
  source_id uuid not null references public.content_sources (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  outcome text not null,
  http_status integer,
  content_hash text,
  error_code text,
  constraint source_fetch_attempts_outcome_check check (
    outcome in (
      'ok',
      'unchanged',
      'robots_disallowed',
      'http_error',
      'too_large',
      'timeout',
      'redirect_refused',
      'parse_error'
    )
  ),
  constraint source_fetch_attempts_http_status_check check (
    http_status is null or http_status between 100 and 599
  ),
  constraint source_fetch_attempts_hash_check check (
    content_hash is null or content_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint source_fetch_attempts_error_code_check check (
    error_code is null or char_length(error_code) between 1 and 80
  )
);

create index source_fetch_attempts_source_idx
  on public.source_fetch_attempts (source_id, attempted_at desc);

comment on table public.source_fetch_attempts is
  'One row per fetch check. Page HTML is not stored.';

create table public.source_facts (
  id uuid primary key default uuid_generate_v4(),
  source_id uuid not null references public.content_sources (id) on delete cascade,
  subject_type text not null,
  subject_id uuid,
  field text not null,
  value jsonb not null,
  evidence_excerpt text not null,
  version integer not null,
  status text not null,
  extracted_at timestamptz not null default now(),
  verified_at timestamptz,
  constraint source_facts_subject_type_check check (subject_type = 'recipe'),
  constraint source_facts_status_check check (
    status in ('current', 'superseded', 'pending_review', 'rejected')
  ),
  constraint source_facts_field_check check (char_length(btrim(field)) between 1 and 80),
  constraint source_facts_excerpt_check check (char_length(evidence_excerpt) between 1 and 240),
  constraint source_facts_version_check check (version >= 1)
);

create unique index source_facts_version_uidx
  on public.source_facts (
    source_id,
    subject_type,
    coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid),
    field,
    version
  );

create unique index source_facts_current_uidx
  on public.source_facts (
    source_id,
    subject_type,
    coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid),
    field
  )
  where status = 'current';

create index source_facts_subject_idx
  on public.source_facts (subject_type, subject_id, field, version);

comment on table public.source_facts is
  'Versioned extracted facts. A newer version supersedes the current row. Prior versions stay so a saved recipe_version can still resolve.';

create table public.content_exceptions (
  id uuid primary key default uuid_generate_v4(),
  source_id uuid not null references public.content_sources (id) on delete cascade,
  subject_type text,
  subject_id uuid,
  field text,
  reason text not null,
  before jsonb,
  after jsonb,
  evidence_excerpt text,
  status text not null default 'open',
  resolved_by uuid,
  resolved_at timestamptz,
  constraint content_exceptions_reason_check check (
    reason in (
      'conflict',
      'sensitive',
      'missing_source',
      'validation_failed',
      'injection_suspected'
    )
  ),
  constraint content_exceptions_status_check check (
    status in ('open', 'approved', 'edited', 'rejected')
  ),
  constraint content_exceptions_subject_type_check check (
    subject_type is null or subject_type = 'recipe'
  ),
  constraint content_exceptions_field_check check (
    field is null or char_length(btrim(field)) between 1 and 80
  ),
  constraint content_exceptions_excerpt_check check (
    evidence_excerpt is null or char_length(evidence_excerpt) between 1 and 240
  ),
  constraint content_exceptions_resolved_check check (
    (status = 'open' and resolved_at is null)
    or (status <> 'open' and resolved_at is not null)
  )
);

create unique index content_exceptions_one_open_uidx
  on public.content_exceptions (
    source_id,
    coalesce(subject_type, ''),
    coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(field, ''),
    reason
  )
  where status = 'open';

create index content_exceptions_status_idx
  on public.content_exceptions (status, source_id);

comment on table public.content_exceptions is
  'Operator queue for conflicting, sensitive, missing, invalid, or injection-suspected source changes. Nothing in this queue is published by insert.';

alter table public.content_sources enable row level security;
alter table public.source_fetch_attempts enable row level security;
alter table public.source_facts enable row level security;
alter table public.content_exceptions enable row level security;

revoke all on table public.content_sources from public, anon, authenticated, service_role;
revoke all on table public.source_fetch_attempts from public, anon, authenticated, service_role;
revoke all on table public.source_facts from public, anon, authenticated, service_role;
revoke all on table public.content_exceptions from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.content_sources to service_role;
grant select, insert, update, delete on table public.source_fetch_attempts to service_role;
grant select, insert, update, delete on table public.source_facts to service_role;
grant select, insert, update, delete on table public.content_exceptions to service_role;

create policy content_sources_service_all
  on public.content_sources
  for all
  to service_role
  using (true)
  with check (true);

create policy source_fetch_attempts_service_all
  on public.source_fetch_attempts
  for all
  to service_role
  using (true)
  with check (true);

create policy source_facts_service_all
  on public.source_facts
  for all
  to service_role
  using (true)
  with check (true);

create policy content_exceptions_service_all
  on public.content_exceptions
  for all
  to service_role
  using (true)
  with check (true);

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

create or replace function public.rollback_recipe_to_previous(p_recipe_id uuid)
returns integer
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
declare
  v_recipe public.recipes;
  v_current public.source_facts;
  v_prev public.source_facts;
  v_text text;
  v_version integer;
begin
  select * into v_recipe from public.recipes where id = p_recipe_id for update;
  if v_recipe.id is null then
    raise exception 'recipe not found' using errcode = 'P0002';
  end if;
  select * into v_current
  from public.source_facts
  where subject_type = 'recipe'
    and subject_id = p_recipe_id
    and field = 'description'
    and status = 'current'
  order by version desc
  limit 1
  for update;
  if v_current.id is null then
    raise exception 'no current description fact' using errcode = 'P0002';
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
    raise exception 'no previous description fact' using errcode = 'P0002';
  end if;
  if v_current.version <> v_recipe.version then
    raise exception 'description fact version does not match recipe version' using errcode = '22023';
  end if;
  v_text := btrim(v_prev.value ->> 'text');
  if v_text is null or v_text = '' or char_length(v_text) > 400 then
    raise exception 'previous description is not restorable' using errcode = '22023';
  end if;
  v_version := v_recipe.version + 1;
  update public.source_facts set status = 'superseded' where id = v_current.id;
  insert into public.source_facts (
    source_id, subject_type, subject_id, field, value, evidence_excerpt,
    version, status, verified_at
  ) values (
    v_current.source_id,
    'recipe',
    p_recipe_id,
    'description',
    v_prev.value,
    v_prev.evidence_excerpt,
    v_version,
    'current',
    pg_catalog.now()
  );
  update public.recipes
  set description = v_text,
      version = v_version
  where id = p_recipe_id;
  return v_version;
end;
$$;

create or replace function public.apply_recipe_description_fact(
  p_source_id uuid,
  p_recipe_id uuid,
  p_value jsonb,
  p_evidence_excerpt text,
  p_retrieved_at timestamptz default null,
  p_supersede_fact_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
declare
  v_recipe public.recipes;
  v_fact public.source_facts;
  v_text text;
  v_version integer;
  v_id uuid;
begin
  select * into v_recipe from public.recipes where id = p_recipe_id for update;
  if v_recipe.id is null then
    raise exception 'recipe not found' using errcode = 'P0002';
  end if;
  if v_recipe.recipe_type is distinct from 'inspired_by'
    or v_recipe.source_kind is distinct from 'public_menu' then
    raise exception 'only an inspired_by public_menu recipe can take a description fact'
      using errcode = '22023';
  end if;
  v_text := btrim(p_value ->> 'text');
  if v_text is null or v_text = '' or char_length(v_text) > 400 then
    raise exception 'description text is not storable' using errcode = '22023';
  end if;

  if p_supersede_fact_id is null then
    if exists (
      select 1
      from public.source_facts
      where source_id = p_source_id
        and subject_type = 'recipe'
        and subject_id = p_recipe_id
        and field = 'description'
        and status = 'current'
    ) then
      raise exception 'current description fact already exists' using errcode = '23505';
    end if;
    if v_text is distinct from btrim(v_recipe.description) then
      raise exception 'baseline text must be the current recipe description' using errcode = '22023';
    end if;
    insert into public.source_facts (
      source_id, subject_type, subject_id, field, value, evidence_excerpt,
      version, status, verified_at
    ) values (
      p_source_id,
      'recipe',
      p_recipe_id,
      'description',
      p_value,
      p_evidence_excerpt,
      v_recipe.version,
      'current',
      pg_catalog.now()
    )
    returning id into v_id;
    return v_id;
  end if;

  select * into v_fact
  from public.source_facts
  where id = p_supersede_fact_id
  for update;
  if v_fact.id is null then
    raise exception 'fact not found' using errcode = 'P0002';
  end if;
  if v_fact.status is distinct from 'current'
    or v_fact.field is distinct from 'description'
    or v_fact.subject_type is distinct from 'recipe'
    or v_fact.subject_id is distinct from p_recipe_id
    or v_fact.source_id is distinct from p_source_id then
    raise exception 'supersede fact is not the current description' using errcode = '22023';
  end if;
  if v_fact.version <> v_recipe.version then
    raise exception 'description fact version does not match recipe version' using errcode = '22023';
  end if;
  v_version := v_recipe.version + 1;
  update public.source_facts set status = 'superseded' where id = v_fact.id;
  insert into public.source_facts (
    source_id, subject_type, subject_id, field, value, evidence_excerpt,
    version, status, verified_at
  ) values (
    p_source_id,
    'recipe',
    p_recipe_id,
    'description',
    p_value,
    p_evidence_excerpt,
    v_version,
    'current',
    pg_catalog.now()
  )
  returning id into v_id;
  update public.recipes
  set description = v_text,
      version = v_version,
      retrieved_at = coalesce(p_retrieved_at, retrieved_at)
  where id = p_recipe_id;
  return v_id;
end;
$$;

create or replace function public.resolve_saved_recipe_description(
  p_user_id uuid,
  p_recipe_id uuid
)
returns text
language sql
stable
security invoker
set search_path to pg_catalog, public
as $$
  select f.value ->> 'text'
  from public.saved_recipes s
  join public.source_facts f
    on f.subject_id = s.recipe_id
   and f.subject_type = 'recipe'
   and f.field = 'description'
   and f.version = s.recipe_version
  where s.user_id = p_user_id
    and s.recipe_id = p_recipe_id
  order by f.extracted_at desc
  limit 1;
$$;

revoke all on function public.rollback_content_fact(uuid) from public, anon, authenticated, service_role;
revoke all on function public.rollback_recipe_to_previous(uuid) from public, anon, authenticated, service_role;
revoke all on function public.apply_recipe_description_fact(uuid, uuid, jsonb, text, timestamptz, uuid) from public, anon, authenticated, service_role;
revoke all on function public.resolve_saved_recipe_description(uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function public.rollback_content_fact(uuid) to service_role;
grant execute on function public.rollback_recipe_to_previous(uuid) to service_role;
grant execute on function public.apply_recipe_description_fact(uuid, uuid, jsonb, text, timestamptz, uuid) to service_role;
grant execute on function public.resolve_saved_recipe_description(uuid, uuid) to service_role;

comment on function public.rollback_content_fact(uuid) is
  'Restores the previous fact value as a new version. Refuses recipe description facts; use rollback_recipe_to_previous so the recipe version stays coupled.';

comment on function public.apply_recipe_description_fact(uuid, uuid, jsonb, text, timestamptz, uuid) is
  'Writes one description fact. A null supersede id baselines at recipes.version and does not change the recipe. Otherwise supersedes, inserts the next version, and bumps the recipe in this same call.';

comment on function public.rollback_recipe_to_previous(uuid) is
  'Restores the previous description onto the recipe as recipes.version + 1 and records a new fact version. Does not delete history or rewrite saved_recipes.';

comment on function public.resolve_saved_recipe_description(uuid, uuid) is
  'Returns the description fact whose version equals saved_recipes.recipe_version.';
