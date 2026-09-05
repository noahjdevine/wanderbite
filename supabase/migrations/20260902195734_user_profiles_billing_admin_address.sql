-- OPS-03: forward-only reconciliation of user_profiles columns that exist in
-- live metadata and/or application queries but were never added by a migration
-- that actually landed.
--
-- Evidence:
-- - Live has subscription_status, current_period_end, is_admin (no prior migration).
-- - Migration 013 is recorded on live but address_street/city/state/zip are absent
--   there; 013's file currently also lists those columns (likely amended after apply).
-- - App writes/reads the structured address columns (onboarding, update-profile-structured).
--
-- Additive and idempotent. Does not change RLS/grants (SEC-01).

alter table public.user_profiles
  add column if not exists subscription_status text default 'inactive',
  add column if not exists current_period_end timestamp with time zone,
  add column if not exists is_admin boolean not null default false,
  add column if not exists address_street text,
  add column if not exists address_city text,
  add column if not exists address_state text,
  add column if not exists address_zip text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profiles_subscription_status_check'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_subscription_status_check
      check (subscription_status in ('inactive', 'active', 'past_due', 'canceled'));
  end if;
end $$;

comment on column public.user_profiles.subscription_status is
  'Entitlement status written by Stripe webhooks/reconcile. Challenges require active.';
comment on column public.user_profiles.current_period_end is
  'Stripe current period end (timestamptz). Displayed on /billing.';
comment on column public.user_profiles.is_admin is
  'Legacy flag returned by current_user_is_admin(); application admin authorization uses role = admin.';
comment on column public.user_profiles.address_state is '2-letter US state code (e.g. TX).';
comment on column public.user_profiles.address_zip is 'US ZIP code (5-digit or ZIP+4).';

create index if not exists idx_user_profiles_city_state
  on public.user_profiles (address_city, address_state);

-- Live helper used by generated types. App admin checks currently use role = 'admin'.
create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select is_admin from public.user_profiles where id = auth.uid()),
    false
  );
$$;
