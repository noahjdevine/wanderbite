-- E09-QA: Wanderer is still three verified visits. The sentence is the only change.
-- Hat Trick stays "Verified three restaurant visits."
-- This does not change badge ids, names, icons, targets, or awards.
-- Row level security is already enabled. Policy "Anyone can read badges" is unchanged.

alter table public.badges enable row level security;

update public.badges
set description = 'Explored with three verified visits.'
where id = 'wanderer';
