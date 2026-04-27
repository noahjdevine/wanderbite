-- Add cuisine exclusions to user preferences (stored on user_profiles).
-- We keep existing cuisine_opt_out (previously used to store "vibe") for now.

alter table public.user_profiles
  add column if not exists excluded_cuisines text[] not null default '{}'::text[];

comment on column public.user_profiles.excluded_cuisines is
  'Hard exclusions: cuisine IDs the user never wants recommended (affects challenges + roulette).';

