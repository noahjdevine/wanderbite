-- OPS-03: badges catalog and awards. Live tables and generated types exist;
-- no prior migration created them. App reads/writes via get-user-stats and
-- partner-verify.

create table if not exists public.badges (
  id text primary key,
  name text not null,
  description text not null,
  icon text not null
);

create table if not exists public.user_badges (
  user_id uuid not null references auth.users (id),
  badge_id text not null references public.badges (id),
  awarded_at timestamp with time zone default now(),
  primary key (user_id, badge_id)
);

alter table public.badges enable row level security;
alter table public.user_badges enable row level security;

-- Read policies required for member UI (catalog + own awards).
-- Awards are inserted by service role only (partner-verify).
drop policy if exists "Anyone can read badges" on public.badges;
create policy "Anyone can read badges"
  on public.badges
  for select
  to public
  using (true);

drop policy if exists "Users can view own badges" on public.user_badges;
create policy "Users can view own badges"
  on public.user_badges
  for select
  to public
  using (auth.uid() = user_id);

insert into public.badges (id, name, description, icon)
values
  ('first_bite', 'First Bite', 'Verified your first restaurant visit.', 'utensils'),
  ('hat_trick', 'Hat Trick', 'Verified three restaurant visits.', 'sparkles'),
  ('wanderer', 'The Wanderer', 'Verified three restaurant visits.', 'compass'),
  ('high_five', 'High Five', 'Verified five restaurant visits.', 'hand')
on conflict (id) do nothing;
