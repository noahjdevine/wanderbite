-- OPS-03: Journey renders badges.icon as text, not as a Lucide component name.
-- Forward correction also works where the earlier G1 seed already ran.
-- Preserve custom icons, badge IDs, descriptions, and all existing awards.
update public.badges as b
set icon = replacements.glyph
from (values
  ('first_bite', 'utensils', '🍴'),
  ('hat_trick', 'sparkles', '✨'),
  ('wanderer', 'compass', '🧭'),
  ('high_five', 'hand', '✋')
) as replacements(id, old_icon, glyph)
where b.id = replacements.id and b.icon = replacements.old_icon;
