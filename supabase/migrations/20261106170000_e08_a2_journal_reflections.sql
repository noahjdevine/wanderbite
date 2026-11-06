-- E08-A2 owner-only journal reflections.
-- NOT applied to hosted. Do not run supabase db push for this file in this PR.
-- No feature flag. No UI. No AI call. No change to bite_notes.
-- E07_BILL_SCAN_AZURE_ENABLED stays unset. E07_ARRIVAL_SESSIONS_ENABLED stays unset.
-- updated_at is touched on update, matching recipes, activities, and
-- restaurant_briefing_facts. bite_notes has no such trigger and is unchanged.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.journal_reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  redemption_id uuid not null references public.redemptions (id) on delete cascade,
  bite_note_id uuid references public.bite_notes (id) on delete set null,
  favorite_bite text,
  atmosphere text,
  companion_label text,
  unpublished_review_draft text,
  return_interest text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint journal_reflections_redemption_id_key unique (redemption_id),
  constraint journal_reflections_favorite_bite_len
    check (favorite_bite is null or char_length(favorite_bite) <= 120),
  constraint journal_reflections_atmosphere_len
    check (atmosphere is null or char_length(atmosphere) <= 280),
  constraint journal_reflections_companion_label_len
    check (companion_label is null or char_length(companion_label) <= 40),
  constraint journal_reflections_draft_len
    check (unpublished_review_draft is null or char_length(unpublished_review_draft) <= 1500),
  constraint journal_reflections_return_interest_check
    check (return_interest is null or return_interest in ('yes', 'maybe', 'no'))
);

create index journal_reflections_user_id_idx
  on public.journal_reflections (user_id);

create index journal_reflections_bite_note_id_idx
  on public.journal_reflections (bite_note_id);

comment on table public.journal_reflections is
  'Private reflection for one owned redemption. Not a public review. bite_note_id stays null until an explicit publish. Service role only. No rating or sentiment column.';

create or replace function public.set_journal_reflections_updated_at()
returns trigger
language plpgsql
set search_path to pg_catalog
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_journal_reflections_updated_at()
  from public, anon, authenticated, service_role;
grant execute on function public.set_journal_reflections_updated_at() to service_role;

create trigger set_journal_reflections_updated_at_trigger
  before update on public.journal_reflections
  for each row execute function public.set_journal_reflections_updated_at();

alter table public.journal_reflections enable row level security;

revoke all on table public.journal_reflections
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.journal_reflections to service_role;

create or replace function public.journal_reflections_scope()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  owner_id uuid;
  note_user uuid;
  note_redemption uuid;
begin
  select r.user_id
    into owner_id
  from public.redemptions r
  where r.id = new.redemption_id;

  if owner_id is null or owner_id is distinct from new.user_id then
    raise exception 'journal reflection owner mismatch' using errcode = '23514';
  end if;

  if new.bite_note_id is not null then
    select n.user_id, n.redemption_id
      into note_user, note_redemption
    from public.bite_notes n
    where n.id = new.bite_note_id;

    if note_user is null
       or note_user is distinct from new.user_id
       or note_redemption is distinct from new.redemption_id then
      raise exception 'journal reflection note mismatch' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger journal_reflections_scope
  before insert or update on public.journal_reflections
  for each row execute function public.journal_reflections_scope();

revoke all on function public.journal_reflections_scope()
  from public, anon, authenticated, service_role;

comment on function public.journal_reflections_scope() is
  'Checks redemption and bite note ids only. Does not read or return reflection text.';
