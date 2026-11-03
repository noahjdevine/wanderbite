-- E03 voice: price OpenAI gpt-transcribe without rewriting published rows.
-- ai_current_versions() returns the newest price version, so this version
-- copies the Haiku 4.5 rates forward and adds one audio duration rate.
-- No new table. Existing RLS, grants, and immutability triggers still apply.
-- Published rows are not updated.
--
-- Official price checked 2026-11-03:
-- https://developers.openai.com/api/docs/models/gpt-transcribe
-- https://developers.openai.com/api/docs/pricing
-- gpt-transcribe is $0.0045 per minute = 75 microdollars per second.
-- Registry unit: microdollars per million audio_seconds = 75_000_000.
-- 30 seconds quote = 2250 microdollars ($0.00225).

insert into public.ai_price_versions (id, notes, published_at)
values (
  'a1000000-0000-4000-8000-00000000ae03',
  'Copy claude-haiku-4-5-20251001 rates. Add openai gpt-transcribe audio_seconds at $0.0045 per minute.',
  (select max(published_at) + interval '1 second' from public.ai_price_versions)
);

insert into public.ai_price_rates (
  price_version_id,
  provider,
  model_id,
  usage_kind,
  microdollars_per_million
)
select
  'a1000000-0000-4000-8000-00000000ae03',
  provider,
  model_id,
  usage_kind,
  microdollars_per_million
from public.ai_price_rates
where price_version_id = 'a1000000-0000-4000-8000-00000000ae01';

insert into public.ai_price_rates (
  price_version_id,
  provider,
  model_id,
  usage_kind,
  microdollars_per_million
)
values (
  'a1000000-0000-4000-8000-00000000ae03',
  'openai',
  'gpt-transcribe',
  'audio_seconds',
  75000000
);
