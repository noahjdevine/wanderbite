-- Public storage bucket for cached restaurant photos.
-- Populated by /api/cron/refresh-restaurant-photos (weekly Sunday) and read
-- directly by /api/restaurant-image/[id] via a 302 redirect to the public URL.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'restaurant-photos',
  'restaurant-photos',
  true,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- RLS: anyone can read (public bucket). Only service role can write.
drop policy if exists "public read of restaurant-photos" on storage.objects;
create policy "public read of restaurant-photos"
  on storage.objects for select
  to public
  using (bucket_id = 'restaurant-photos');

drop policy if exists "service role write to restaurant-photos" on storage.objects;
create policy "service role write to restaurant-photos"
  on storage.objects for insert
  to service_role
  with check (bucket_id = 'restaurant-photos');

drop policy if exists "service role update restaurant-photos" on storage.objects;
create policy "service role update restaurant-photos"
  on storage.objects for update
  to service_role
  using (bucket_id = 'restaurant-photos')
  with check (bucket_id = 'restaurant-photos');

-- Track last update for photo-refresh cron ordering (oldest refreshed first).
alter table public.restaurants
  add column if not exists updated_at timestamp with time zone default now();

update public.restaurants
set updated_at = coalesce(created_at, now())
where updated_at is null;

create or replace function public.set_restaurants_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_restaurants_updated_at_trigger on public.restaurants;
create trigger set_restaurants_updated_at_trigger
  before update on public.restaurants
  for each row execute function public.set_restaurants_updated_at();
