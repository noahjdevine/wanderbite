-- Partner portal URLs: /partner/{slug}
-- Run manually in Supabase SQL Editor if migrations are not auto-applied.

ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS slug text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_slug
  ON public.restaurants (slug)
  WHERE slug IS NOT NULL;
