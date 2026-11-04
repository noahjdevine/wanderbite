-- E05-A1 recipe content and member saves.
-- Not applied to hosted until separately approved.
-- Recipes are curated rows. Members can read published rows and save or unsave
-- their own copies. Saving does not write credits, visits, badges, or offers.

create or replace function public.recipe_ingredients_ok(p_ingredients jsonb)
returns boolean
language sql
immutable
set search_path to pg_catalog
as $$
  select case
    when jsonb_typeof(p_ingredients) is distinct from 'array' then false
    when jsonb_array_length(p_ingredients) not between 1 and 40 then false
    when exists (
      select 1
      from jsonb_array_elements(p_ingredients) as elem
      where jsonb_typeof(elem) is distinct from 'object'
        or nullif(btrim(elem ->> 'name'), '') is null
        or char_length(btrim(elem ->> 'name')) > 80
        or jsonb_typeof(elem -> 'quantity') not in ('string', 'number')
        or nullif(btrim(elem ->> 'quantity'), '') is null
        or char_length(elem ->> 'quantity') > 40
        or jsonb_typeof(elem -> 'unit') is distinct from 'string'
        or nullif(btrim(elem ->> 'unit'), '') is null
        or char_length(btrim(elem ->> 'unit')) > 40
    ) then false
    else true
  end;
$$;

create or replace function public.recipe_steps_ok(p_steps jsonb)
returns boolean
language sql
immutable
set search_path to pg_catalog
as $$
  select case
    when jsonb_typeof(p_steps) is distinct from 'array' then false
    when jsonb_array_length(p_steps) not between 1 and 30 then false
    when exists (
      select 1
      from jsonb_array_elements(p_steps) with ordinality as step(elem, ord)
      where jsonb_typeof(elem) is distinct from 'object'
        or (elem ->> 'order') is null
        or (elem ->> 'order') !~ '^[1-9][0-9]{0,3}$'
        or (elem ->> 'order')::integer <> step.ord::integer
        or nullif(btrim(elem ->> 'text'), '') is null
        or char_length(btrim(elem ->> 'text')) > 500
    ) then false
    else true
  end;
$$;

create or replace function public.recipe_substitutions_ok(p_substitutions jsonb)
returns boolean
language sql
immutable
set search_path to pg_catalog
as $$
  select case
    when jsonb_typeof(p_substitutions) is distinct from 'array' then false
    when jsonb_array_length(p_substitutions) > 20 then false
    when exists (
      select 1
      from jsonb_array_elements(p_substitutions) as elem
      where jsonb_typeof(elem) is distinct from 'object'
        or nullif(btrim(elem ->> 'instead_of'), '') is null
        or char_length(btrim(elem ->> 'instead_of')) > 160
        or nullif(btrim(elem ->> 'use'), '') is null
        or char_length(btrim(elem ->> 'use')) > 160
    ) then false
    else true
  end;
$$;

create or replace function public.recipe_dietary_tags_ok(p_tags text[])
returns boolean
language sql
immutable
set search_path to pg_catalog
as $$
  select p_tags is not null
    and cardinality(p_tags) <= 20
    and not exists (
      select 1
      from unnest(p_tags) as tag
      where tag is null
        or btrim(tag) = ''
        or char_length(tag) > 40
    );
$$;

revoke all on function public.recipe_ingredients_ok(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.recipe_steps_ok(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.recipe_substitutions_ok(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.recipe_dietary_tags_ok(text[]) from public, anon, authenticated, service_role;
grant execute on function public.recipe_ingredients_ok(jsonb) to service_role;
grant execute on function public.recipe_steps_ok(jsonb) to service_role;
grant execute on function public.recipe_substitutions_ok(jsonb) to service_role;
grant execute on function public.recipe_dietary_tags_ok(text[]) to service_role;

create table public.recipes (
  id uuid primary key default uuid_generate_v4(),
  slug text not null,
  title text not null,
  recipe_type text not null,
  restaurant_id uuid references public.restaurants (id) on delete cascade,
  servings integer not null,
  est_minutes integer not null,
  ingredients jsonb not null,
  steps jsonb not null,
  substitutions jsonb not null default '[]'::jsonb,
  dietary_tags text[] not null default '{}'::text[],
  source_url text,
  source_name text,
  rights_basis text,
  visibility text not null default 'draft',
  checked_at timestamptz,
  version integer not null default 1,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipes_slug_key unique (slug),
  constraint recipes_slug_check check (
    char_length(slug) between 1 and 80
    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  constraint recipes_title_check check (char_length(btrim(title)) between 1 and 160),
  constraint recipes_type_check check (
    recipe_type in ('restaurant_approved', 'sourced_published', 'inspired_by')
  ),
  constraint recipes_visibility_check check (
    visibility in ('published', 'draft', 'hidden')
  ),
  constraint recipes_servings_check check (servings between 1 and 100),
  constraint recipes_est_minutes_check check (est_minutes between 1 and 1440),
  constraint recipes_version_check check (version >= 1),
  constraint recipes_source_name_check check (
    source_name is null or char_length(btrim(source_name)) between 1 and 160
  ),
  constraint recipes_rights_length_check check (
    rights_basis is null or char_length(btrim(rights_basis)) between 1 and 80
  ),
  constraint recipes_source_url_check check (
    source_url is null
    or (
      char_length(source_url) <= 500
      and source_url ~ '^https://[^[:space:]]+$'
    )
  ),
  constraint recipes_ingredients_check check (public.recipe_ingredients_ok(ingredients)),
  constraint recipes_steps_check check (public.recipe_steps_ok(steps)),
  constraint recipes_substitutions_check check (public.recipe_substitutions_ok(substitutions)),
  constraint recipes_dietary_tags_check check (public.recipe_dietary_tags_ok(dietary_tags)),
  constraint recipes_rights_check check (
    (
      recipe_type = 'inspired_by'
      and rights_basis = 'original'
    )
    or (
      recipe_type = 'restaurant_approved'
      and restaurant_id is not null
      and source_url is not null
      and btrim(source_url) <> ''
      and rights_basis is not null
      and btrim(rights_basis) <> ''
    )
    or (
      recipe_type = 'sourced_published'
      and source_url is not null
      and btrim(source_url) <> ''
      and rights_basis is not null
      and btrim(rights_basis) <> ''
    )
  )
);

create index recipes_restaurant_id_idx on public.recipes (restaurant_id);

create or replace function public.set_recipes_updated_at()
returns trigger
language plpgsql
set search_path to pg_catalog
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_recipes_updated_at() from public, anon, authenticated, service_role;
grant execute on function public.set_recipes_updated_at() to service_role;

create trigger set_recipes_updated_at_trigger
  before update on public.recipes
  for each row execute function public.set_recipes_updated_at();

alter table public.recipes enable row level security;

revoke all on table public.recipes from public, anon, authenticated, service_role;
grant select on table public.recipes to anon, authenticated;
grant select, insert, update, delete on table public.recipes to service_role;

create policy recipes_select_published
  on public.recipes
  for select
  to anon, authenticated
  using (visibility = 'published');

create policy recipes_service_all
  on public.recipes
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.recipes is
  'Curated recipes. Public read is published rows only. Client roles cannot write. inspired_by rows use rights_basis original and are not the restaurant recipe.';

create table public.saved_recipes (
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  recipe_version integer not null,
  saved_at timestamptz not null default now(),
  primary key (user_id, recipe_id),
  constraint saved_recipes_version_check check (recipe_version >= 1)
);

create or replace function public.saved_recipes_guard()
returns trigger
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
declare
  published_version integer;
begin
  select r.version into published_version
  from public.recipes r
  where r.id = new.recipe_id
    and r.visibility = 'published';
  if published_version is null then
    raise exception 'recipe is not published' using errcode = '42501';
  end if;
  if current_user in ('authenticated', 'anon')
    and new.user_id is distinct from (select auth.uid()) then
    raise exception 'saved_recipes owner mismatch' using errcode = '42501';
  end if;
  new.recipe_version := published_version;
  return new;
end;
$$;

revoke all on function public.saved_recipes_guard() from public, anon, authenticated, service_role;
grant execute on function public.saved_recipes_guard() to authenticated;

create trigger saved_recipes_guard_trigger
  before insert on public.saved_recipes
  for each row execute function public.saved_recipes_guard();

alter table public.saved_recipes enable row level security;

revoke all on table public.saved_recipes from public, anon, authenticated, service_role;
grant select, insert, delete on table public.saved_recipes to authenticated;

create policy saved_recipes_select_own
  on public.saved_recipes
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
  );

create policy saved_recipes_insert_own
  on public.saved_recipes
  for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
  );

create policy saved_recipes_delete_own
  on public.saved_recipes
  for delete
  to authenticated
  using (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
  );

comment on table public.saved_recipes is
  'Owner-only recipe bookmarks. A save does not grant a credit, verified visit, badge, or drawing entry. Account delete cascades these rows.';
