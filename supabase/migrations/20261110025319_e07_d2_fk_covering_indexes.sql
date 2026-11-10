-- Covering indexes for the E07-D2 foreign keys that no existing index leads with.
-- Unique constraints already cover case_id and redemption_id on
-- visit_problem_savings_adjustments, and case_id, makeup_challenge_item_id,
-- and used_redemption_id on visit_problem_opportunities.
-- user_id already has visit_problem_savings_user_idx and
-- visit_problem_opportunities_user_idx.
-- quote_id and visit_problem_opportunities.redemption_id are nullable.
-- Foreign-key checks and equality joins never match null, so a partial index
-- still covers parent deletes, parent updates, and joins, and it skips null rows.
-- actor_user_id and challenge_item_id are not null, so those indexes are full.
-- CREATE INDEX does not update rows, so the append-only and seal triggers stay as they are.
-- Not applied to hosted. Do not run supabase db push for this file in this PR.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index if not exists visit_problem_savings_adjustments_actor_user_id_idx
  on public.visit_problem_savings_adjustments (actor_user_id);

create index if not exists visit_problem_savings_adjustments_quote_id_idx
  on public.visit_problem_savings_adjustments (quote_id)
  where quote_id is not null;

create index if not exists visit_problem_opportunities_actor_user_id_idx
  on public.visit_problem_opportunities (actor_user_id);

create index if not exists visit_problem_opportunities_challenge_item_id_idx
  on public.visit_problem_opportunities (challenge_item_id);

create index if not exists visit_problem_opportunities_redemption_id_idx
  on public.visit_problem_opportunities (redemption_id)
  where redemption_id is not null;
