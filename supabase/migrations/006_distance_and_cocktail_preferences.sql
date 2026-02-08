-- Dallas geography: 4 distance options (5 / 15 / 25 / 40 mi)
-- Drop old constraint first so we can update to new values
alter table public.user_profiles drop constraint if exists user_profiles_distance_band_check;

-- Map old values to new: close -> 5_mi, worth_trip -> 15_mi, adventure -> 25_mi
update public.user_profiles
set distance_band = case distance_band
  when 'close' then '5_mi'
  when 'worth_trip' then '15_mi'
  when 'adventure' then '25_mi'
  else '15_mi'
end
where distance_band is not null and distance_band not in ('5_mi', '15_mi', '25_mi', '40_mi');

-- Ensure any remaining non-matching values get a valid default
update public.user_profiles set distance_band = '15_mi' where distance_band is null or distance_band not in ('5_mi', '15_mi', '25_mi', '40_mi');

alter table public.user_profiles add constraint user_profiles_distance_band_check
  check (distance_band in ('5_mi', '15_mi', '25_mi', '40_mi'));
alter table public.user_profiles alter column distance_band set default '15_mi';

-- Cocktail/bar experience preference: curate 1 high-end cocktail bar per month when true
alter table public.user_profiles add column if not exists wants_cocktail_experience boolean default false;
comment on column public.user_profiles.wants_cocktail_experience is 'When true, monthly challenge includes 1 curated cocktail bar or lounge experience.';
