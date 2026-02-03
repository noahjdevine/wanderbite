-- Add slug, state, country, currency to markets (for multi-market and display)
alter table public.markets
  add column if not exists slug text,
  add column if not exists state text,
  add column if not exists country text default 'US',
  add column if not exists currency text default 'USD';

-- Optional: add unique constraint so slug can be used in URLs
create unique index if not exists idx_markets_slug on public.markets(slug) where slug is not null;
