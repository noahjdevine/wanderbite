-- Legacy cleanup: merge user_profiles.cuisine_opt_out → user_preferences.excluded_cuisines, then drop column.

create table if not exists public.user_preferences (
  user_id uuid primary key references public.user_profiles (id) on delete cascade,
  excluded_cuisines text[] not null default '{}'::text[]
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_profiles'
      and column_name = 'cuisine_opt_out'
  ) then
    insert into public.user_preferences (user_id, excluded_cuisines)
    select p.id, coalesce(p.cuisine_opt_out, '{}'::text[])
    from public.user_profiles p
    where p.cuisine_opt_out is not null
      and cardinality(p.cuisine_opt_out) > 0
    on conflict (user_id) do update
    set excluded_cuisines = case
      when cardinality(user_preferences.excluded_cuisines) = 0
      then excluded.excluded_cuisines
      else user_preferences.excluded_cuisines
    end;
  end if;
end $$;

alter table public.user_preferences
  alter column excluded_cuisines set default '{}'::text[];

update public.user_preferences
set excluded_cuisines = '{}'::text[]
where excluded_cuisines is null;

alter table public.user_profiles drop column if exists cuisine_opt_out;
