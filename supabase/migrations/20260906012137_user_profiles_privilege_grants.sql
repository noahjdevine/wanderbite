-- SEC-01 / G2: customers may create and edit only everyday profile fields.
-- Do not rewrite 001. Rollback is GRANT of a missing preference column only —
-- never GRANT INSERT or UPDATE on the whole table to anon or authenticated.
-- Let the migration runner own the transaction so the schema change and its
-- migration-history entry commit together. Direct psql replay must use -1 -f.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

revoke insert, update on table public.user_profiles from anon, authenticated;

grant insert (
  id,
  email,
  dietary_flags,
  allergy_flags,
  distance_band,
  distance_preference,
  wants_cocktail_experience,
  full_name,
  username,
  phone_number,
  address,
  address_street,
  address_city,
  address_state,
  address_zip
) on table public.user_profiles to authenticated;

grant update (
  email,
  dietary_flags,
  allergy_flags,
  distance_band,
  distance_preference,
  wants_cocktail_experience,
  full_name,
  username,
  phone_number,
  address,
  address_street,
  address_city,
  address_state,
  address_zip
) on table public.user_profiles to authenticated;

alter policy "Users can insert own profile" on public.user_profiles
  with check (
    auth.uid() = id
    and role is not distinct from 'subscriber'
    and is_admin is not distinct from false
    and subscription_status is not distinct from 'inactive'
    and stripe_customer_id is null
    and current_period_end is null
  );

alter policy "Users can update own profile" on public.user_profiles
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.protect_user_profiles_privileged_columns()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role is distinct from 'subscriber'
      or new.is_admin is distinct from false
      or new.subscription_status is distinct from 'inactive'
      or new.stripe_customer_id is not null
      or new.current_period_end is not null
    then
      raise exception 'Cannot modify privileged profile columns'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role
    or new.is_admin is distinct from old.is_admin
    or new.subscription_status is distinct from old.subscription_status
    or new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.current_period_end is distinct from old.current_period_end
  then
    raise exception 'Cannot modify privileged profile columns'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_user_profiles_privileged_columns on public.user_profiles;
create trigger protect_user_profiles_privileged_columns
  before insert or update on public.user_profiles
  for each row
  execute function public.protect_user_profiles_privileged_columns();

revoke all on function public.protect_user_profiles_privileged_columns() from public;
grant execute on function public.protect_user_profiles_privileged_columns() to anon, authenticated, service_role;
