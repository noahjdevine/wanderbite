-- Add profile fields for onboarding and profile edit
alter table public.user_profiles add column if not exists full_name text;
alter table public.user_profiles add column if not exists username text;
alter table public.user_profiles add column if not exists phone_number text;
alter table public.user_profiles add column if not exists address text;
alter table public.user_profiles add column if not exists distance_preference text default '10 miles';

create unique index if not exists idx_user_profiles_username
  on public.user_profiles (lower(username))
  where username is not null and trim(username) <> '';

comment on column public.user_profiles.distance_preference is 'e.g. 5 miles, 10 miles, 15 miles; default 10 miles';
