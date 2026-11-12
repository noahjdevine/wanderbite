-- Covering index for the E09-B5 composite foreign key that no existing index leads with.
-- drawing_selection_winners_selection_campaign_fkey is
-- (selection_id, campaign_id) -> drawing_selections (id, campaign_id).
-- Unique (selection_id, prize_id, unit_index), (selection_id, user_id), and
-- (selection_id, entry_id) lead with selection_id and then a different column.
-- drawing_selection_winners_campaign_id_idx leads with campaign_id.
-- The hosted performance advisor still flags that composite foreign key.
-- A parent update or delete of drawing_selections needs the child columns
-- in that order so the check is an index lookup.
-- Other drawing foreign keys already have a leading index:
-- drawing_campaign_prizes.campaign_id: unique (campaign_id, position)
-- drawing_selections.campaign_id: unique (campaign_id)
-- drawing_selection_winners.prize_id: drawing_selection_winners_prize_id_idx
-- drawing_fulfillments.winner_id: unique (winner_id)
-- drawing_fulfillments.selection_id: drawing_fulfillments_selection_id_idx
-- drawing_fulfillments.campaign_id: drawing_fulfillments_campaign_id_created_at_idx
-- drawing_fulfillments.prize_id: drawing_fulfillments_prize_id_idx
-- drawing_fulfillment_events.fulfillment_id: drawing_fulfillment_events_fulfillment_id_idx
-- drawing_campaigns has no foreign key. B4 adds activated_at and closed_at only.
-- CREATE INDEX does not update rows, so the append-only triggers stay as they are.
-- Not applied to hosted. Do not run supabase db push for this file in this PR.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index if not exists drawing_selection_winners_selection_campaign_idx
  on public.drawing_selection_winners (selection_id, campaign_id);
