-- Structured address fields for onboarding/account.
-- Keep legacy `address` text column for now; do not drop in this migration.
--
-- Also ensure `stripe_customer_id` exists (used by Stripe Customer Portal).

alter table public.user_profiles
  add column if not exists address_street text,
  add column if not exists address_city text,
  add column if not exists address_state text,
  add column if not exists address_zip text,
  add column if not exists stripe_customer_id text;

create index if not exists idx_user_profiles_city_state
  on public.user_profiles (address_city, address_state);

comment on column public.user_profiles.address_state is '2-letter US state code (e.g. TX).';
comment on column public.user_profiles.address_zip is 'US ZIP code (5-digit or ZIP+4).';

-- One-time backfill note:
-- We intentionally do NOT attempt to parse the legacy `address` freeform text into structured fields.
-- For test data, you can leave structured fields NULL and let users re-enter next time.
-- For real users, consider a manual review/backfill process before dropping legacy `address`.

