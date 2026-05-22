-- Query performance: indexes on frequently filtered/joined columns.

CREATE INDEX IF NOT EXISTS idx_redemptions_user_id ON public.redemptions (user_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_restaurant_id ON public.redemptions (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_status ON public.redemptions (status);
CREATE INDEX IF NOT EXISTS idx_challenge_items_status ON public.challenge_items (status);
CREATE INDEX IF NOT EXISTS idx_bite_notes_restaurant_id ON public.bite_notes (restaurant_id);
