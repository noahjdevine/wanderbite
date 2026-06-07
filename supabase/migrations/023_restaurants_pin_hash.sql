-- Documents the pin_hash column added out-of-band via Supabase Studio.
-- bcrypt hash of the partner PIN; supersedes the legacy plaintext `pin` column
-- (which will be dropped in a follow-up migration once all rows are backfilled).

alter table public.restaurants
  add column if not exists pin_hash text;

comment on column public.restaurants.pin_hash is
  'bcrypt hash of the partner PIN. Verified server-side in /lib/partner-pin.ts.
   Replaces the legacy plaintext `pin` column which is being deprecated.';
