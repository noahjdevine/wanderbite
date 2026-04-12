-- Google Places enrichment (place id + photo URL). Apply in Supabase SQL Editor if needed.

ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS google_place_id text;
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS google_photo_url text;
