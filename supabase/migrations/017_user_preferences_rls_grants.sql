-- Ensure user_preferences is readable/writable by authenticated users (RLS + table grants).
-- Safe to re-run. Fixes environments where 015 policies were skipped or grants were missing.

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

grant select, insert, update, delete on table public.user_preferences to authenticated;
grant all on table public.user_preferences to service_role;
