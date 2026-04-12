-- Private post-visit notes tied to a redemption (one note per redemption).

create table public.bite_notes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  redemption_id uuid not null references public.redemptions(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id),
  note text,
  rating int check (rating between 1 and 5),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.bite_notes enable row level security;

create policy "Users manage own notes" on public.bite_notes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create unique index idx_bite_notes_redemption on public.bite_notes(redemption_id);
