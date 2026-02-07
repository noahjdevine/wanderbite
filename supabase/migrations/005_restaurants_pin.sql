-- Partner Portal: restaurant owners log in with a PIN to verify redemption codes.
alter table public.restaurants add column if not exists pin text;

comment on column public.restaurants.pin is 'Partner PIN for /partner portal; optional. Super Admin sets this when adding/editing a restaurant.';

-- Data safety: Partner Portal does not use Supabase auth. Redeem/verify is done via
-- server actions using the service role (bypasses RLS), after validating the partner
-- session (cookie set only after correct restaurant + PIN). Partners can only verify
-- redemptions for their own restaurant_id. No RLS policy change needed for
-- challenge_items or redemptions; updates are performed server-side with service role.
