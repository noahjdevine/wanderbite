-- E06 personal notes on a nearby outing.
-- NOT applied to hosted. Forward-only. Do not rewrite existing activity rows.
-- Widens activities_category_check. Adds kids_oriented. Adds restaurant_activity_notes.
-- Members can read one approved non-sample note. Writes are service_role only.
-- A paused note stays paused. This file does not approve it again.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.activities drop constraint activities_category_check;

alter table public.activities add constraint activities_category_check check (
  category in (
    'museum',
    'walk',
    'class',
    'sports',
    'arts',
    'comedy',
    'theater',
    'live_music',
    'games',
    'landmark',
    'dessert'
  )
);

alter table public.activities
  add column kids_oriented boolean not null default false;

comment on column public.activities.kids_oriented is
  'True when the outing is aimed at children. The personal-note drafter skips these rows. Existing rows stay false.';

create or replace function public.activity_note_sentence_count(p_body text)
returns integer
language sql
immutable
set search_path to pg_catalog
as $$
  select case
    when p_body is null or btrim(p_body) = '' then 0
    when btrim(p_body) !~ '[.!?]$' then 0
    else (
      select count(*)::integer
      from regexp_split_to_table(btrim(p_body), '[.!?]+') as sentence
      where btrim(sentence) <> ''
    )
  end;
$$;

revoke all on function public.activity_note_sentence_count(text) from public, anon, authenticated;
grant execute on function public.activity_note_sentence_count(text) to service_role;

create table public.restaurant_activity_notes (
  id uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  body text not null,
  status text not null default 'draft',
  activity_ids uuid[] not null,
  model text not null,
  prompt_version text not null,
  source_hash text not null,
  reviewed_at timestamptz,
  reviewed_by uuid references public.user_profiles (id) on delete set null,
  is_sample boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_activity_notes_body_check check (
    char_length(btrim(body)) between 40 and 600
    and public.activity_note_sentence_count(body) between 2 and 4
    and body !~* 'https?://'
    and body !~* 'www\.'
    and body !~ '\$'
  ),
  constraint restaurant_activity_notes_status_check check (
    status in ('draft', 'approved', 'rejected', 'paused')
  ),
  constraint restaurant_activity_notes_activity_ids_check check (
    cardinality(activity_ids) between 1 and 2
    and array_position(activity_ids, null) is null
  ),
  constraint restaurant_activity_notes_model_check check (
    char_length(btrim(model)) between 1 and 80
  ),
  constraint restaurant_activity_notes_prompt_version_check check (
    char_length(btrim(prompt_version)) between 1 and 80
  ),
  constraint restaurant_activity_notes_source_hash_check check (
    source_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint restaurant_activity_notes_version_check check (version >= 1)
);

comment on table public.restaurant_activity_notes is
  'Operator-drafted personal note for one restaurant. Members read an approved non-sample row from the server. A note stays hidden when a cited activity is no longer showing. Pausing it does not approve it again.';

comment on column public.restaurant_activity_notes.body is
  'Two to four sentences. No links, prices, or dollar signs. Not a fact box.';

comment on column public.restaurant_activity_notes.activity_ids is
  'One or two activities.id values the note names. They must exist. The member page hides the note when any of them is not showing.';

comment on column public.restaurant_activity_notes.source_hash is
  'sha256 hex of the restaurant and the activities the draft was allowed to name. A repeat apply with the same hash does not insert another row.';

create index restaurant_activity_notes_restaurant_idx
  on public.restaurant_activity_notes (restaurant_id);

create unique index restaurant_activity_notes_one_approved_idx
  on public.restaurant_activity_notes (restaurant_id)
  where status = 'approved';

create unique index restaurant_activity_notes_one_draft_idx
  on public.restaurant_activity_notes (restaurant_id)
  where status = 'draft';

create index restaurant_activity_notes_source_hash_idx
  on public.restaurant_activity_notes (source_hash);

create or replace function public.restaurant_activity_notes_check_activity_ids()
returns trigger
language plpgsql
set search_path to pg_catalog, public
as $$
declare
  cited uuid;
  seen uuid[] := '{}';
begin
  foreach cited in array new.activity_ids loop
    if cited = any (seen) then
      raise exception 'activity_ids must be distinct' using errcode = '23514';
    end if;
    seen := seen || cited;
    if not exists (select 1 from public.activities where id = cited) then
      raise exception 'activity_ids must reference activities' using errcode = '23503';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.restaurant_activity_notes_check_activity_ids() from public, anon, authenticated;
grant execute on function public.restaurant_activity_notes_check_activity_ids() to service_role;

create trigger restaurant_activity_notes_activity_ids_trigger
  before insert or update of activity_ids on public.restaurant_activity_notes
  for each row execute function public.restaurant_activity_notes_check_activity_ids();

create or replace function public.set_restaurant_activity_notes_updated_at()
returns trigger
language plpgsql
set search_path to pg_catalog
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_restaurant_activity_notes_updated_at() from public, anon, authenticated, service_role;
grant execute on function public.set_restaurant_activity_notes_updated_at() to service_role;

create trigger set_restaurant_activity_notes_updated_at_trigger
  before update on public.restaurant_activity_notes
  for each row execute function public.set_restaurant_activity_notes_updated_at();

create or replace function public.pause_stale_activity_notes(p_now timestamptz default pg_catalog.now())
returns integer
language plpgsql
set search_path to pg_catalog, public
as $$
declare
  updated_count integer;
  today date;
begin
  today := (timezone('America/Chicago', p_now))::date;
  update public.restaurant_activity_notes as note
  set status = 'paused',
      reviewed_at = p_now,
      version = note.version + 1
  where note.status = 'approved'
    and exists (
      select 1
      from unnest(note.activity_ids) as cited(id)
      where not exists (
        select 1
        from public.activities as activity
        where activity.id = cited.id
          and activity.status = 'active'
          and activity.is_sample = false
          and activity.source_url ~ '^https://[^[:space:]]+$'
          and (activity.valid_from is null or activity.valid_from <= today)
          and (activity.valid_until is null or activity.valid_until >= today)
          and activity.last_verified_at is not null
          and activity.last_verified_at >= p_now - make_interval(secs => 2592000)
      )
    );
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

comment on function public.pause_stale_activity_notes(timestamptz) is
  'Sets an approved note to paused when a cited activity is not member-visible. Does not approve a paused note again.';

revoke all on function public.pause_stale_activity_notes(timestamptz) from public, anon, authenticated;
grant execute on function public.pause_stale_activity_notes(timestamptz) to service_role;

alter table public.restaurant_activity_notes enable row level security;

revoke all on table public.restaurant_activity_notes from public, anon, authenticated, service_role;
grant select on table public.restaurant_activity_notes to authenticated;
grant select, insert, update, delete on table public.restaurant_activity_notes to service_role;

create policy restaurant_activity_notes_select_approved
  on public.restaurant_activity_notes
  for select
  to authenticated
  using (status = 'approved' and is_sample = false);

create policy restaurant_activity_notes_service_all
  on public.restaurant_activity_notes
  for all
  to service_role
  using (true)
  with check (true);
