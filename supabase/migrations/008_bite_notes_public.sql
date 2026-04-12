-- Public bite notes (community reviews). Run manually in Supabase SQL Editor if applying outside CLI.

ALTER TABLE public.bite_notes ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_bite_notes_public ON public.bite_notes(restaurant_id) WHERE is_public = true;

CREATE POLICY "Anyone can view public notes" ON public.bite_notes
  FOR SELECT USING (is_public = true OR auth.uid() = user_id);
