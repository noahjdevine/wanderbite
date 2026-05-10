-- Move excluded_cuisines from user_profiles to user_preferences (one row per user).

create table if not exists public.user_preferences (
  user_id uuid primary key references public.user_profiles (id) on delete cascade,
  excluded_cuisines text[] not null default '{}'::text[]
);

comment on table public.user_preferences is 'User preference extensions (cuisine exclusions).';
comment on column public.user_preferences.excluded_cuisines is
  'Hard exclusions: cuisine IDs the user never wants recommended (challenges + roulette).';

-- Migrate existing data when 014 was applied
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_profiles'
      and column_name = 'excluded_cuisines'
  ) then
    insert into public.user_preferences (user_id, excluded_cuisines)
    select id, excluded_cuisines
    from public.user_profiles
    on conflict (user_id) do update
      set excluded_cuisines = EXCLUDED.excluded_cuisines;
  end if;
end $$;

alter table public.user_profiles drop column if exists excluded_cuisines;

alter table public.user_preferences enable row level security;

drop policy if exists "Users can select own user_preferences" on public.user_preferences;
drop policy if exists "Users can insert own user_preferences" on public.user_preferences;
drop policy if exists "Users can update own user_preferences" on public.user_preferences;

create policy "Users can select own user_preferences"
  on public.user_preferences for select
  using (auth.uid() = user_id);

create policy "Users can insert own user_preferences"
  on public.user_preferences for insert
  with check (auth.uid() = user_id);

create policy "Users can update own user_preferences"
  on public.user_preferences for update
  using (auth.uid() = user_id);
