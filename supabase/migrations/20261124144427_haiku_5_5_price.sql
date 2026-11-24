-- Haiku 5.5 list price for prompts up to 100,000 tokens.
-- Our prompts are far smaller than that threshold, so these are the rates we quote.
-- Above 100,000 input tokens Anthropic charges a higher tier. This row does not model that tier.
-- Units match the Haiku 4.5 rows: microdollars per million tokens.
--   input            $0.10  -> 100000
--   output           $0.50  -> 500000
--   cache_write_5m   $0.125 -> 125000
--   cache_write_1h   $0.20  -> 200000
--   cache_read       $0.01  -> 10000
-- ai_current_versions() is the newest price version, so this version copies
-- every current rate forward and adds claude-haiku-5-5. The Haiku 4.5 rows stay.
-- Published rows are not updated. Safe to re-run.

insert into public.ai_price_versions (id, notes, published_at)
select
  'a1000000-0000-4000-8000-00000000ae04',
  'Copy current rates. Add anthropic claude-haiku-5-5 at the under-100k-token list price.',
  (select max(published_at) + interval '1 second' from public.ai_price_versions)
where not exists (
  select 1
  from public.ai_price_versions
  where id = 'a1000000-0000-4000-8000-00000000ae04'
);

insert into public.ai_price_rates (
  price_version_id,
  provider,
  model_id,
  usage_kind,
  microdollars_per_million
)
select
  'a1000000-0000-4000-8000-00000000ae04',
  r.provider,
  r.model_id,
  r.usage_kind,
  r.microdollars_per_million
from public.ai_price_rates r
where r.price_version_id = (
  select p.id
  from public.ai_price_versions p
  where p.id <> 'a1000000-0000-4000-8000-00000000ae04'
  order by p.published_at desc, p.id desc
  limit 1
)
on conflict on constraint ai_price_rates_unique do nothing;

insert into public.ai_price_rates (
  price_version_id,
  provider,
  model_id,
  usage_kind,
  microdollars_per_million
) values
  ('a1000000-0000-4000-8000-00000000ae04', 'anthropic', 'claude-haiku-5-5', 'input', 100000),
  ('a1000000-0000-4000-8000-00000000ae04', 'anthropic', 'claude-haiku-5-5', 'output', 500000),
  ('a1000000-0000-4000-8000-00000000ae04', 'anthropic', 'claude-haiku-5-5', 'cache_write_5m', 125000),
  ('a1000000-0000-4000-8000-00000000ae04', 'anthropic', 'claude-haiku-5-5', 'cache_write_1h', 200000),
  ('a1000000-0000-4000-8000-00000000ae04', 'anthropic', 'claude-haiku-5-5', 'cache_read', 10000)
on conflict on constraint ai_price_rates_unique do nothing;
