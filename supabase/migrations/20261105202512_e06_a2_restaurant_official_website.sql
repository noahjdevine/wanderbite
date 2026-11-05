-- E06-A2 official website for first-visit research.
-- NOT applied to hosted. Forward-only. Noah approves any apply.
-- Nullable https URL. Client roles do not receive this column.
-- service_role already has table privileges and can read and update it.
-- This is the operator-accepted restaurant URL, not a Places response cache.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.restaurants
  add column official_website text;

alter table public.restaurants
  add constraint restaurants_official_website_https_check check (
    official_website is null
    or (
      char_length(official_website) between 12 and 500
      and official_website ~ '^https://[^[:space:]]+$'
    )
  );

comment on column public.restaurants.official_website is
  'Operator-accepted https website for first-visit research. Null until a human reviews a proposal. Not a Google Places cache.';

revoke select (official_website) on table public.restaurants from public, anon, authenticated;
