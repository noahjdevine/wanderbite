-- Add columns for admin-managed restaurant details and partner verification code
alter table public.restaurants
  add column if not exists description text,
  add column if not exists price_range text,
  add column if not exists neighborhood text,
  add column if not exists image_url text,
  add column if not exists verification_code text;
