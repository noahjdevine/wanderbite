-- Public bite notes are readable by a non-owner only when the redemption is verified.
-- NOT applied to hosted. Forward-only. No data rewrite.
--
-- redemptions has one SELECT policy, "Users view own redemptions"
-- (001_initial_schema.sql): auth.uid() = user_id. No later migration adds another.
-- A plain EXISTS in this policy would run as the caller, so anon and other members
-- would see no redemption and every public note would disappear. The helper is
-- SECURITY DEFINER, owned by the table owner, and returns only a boolean.
-- "Users manage own notes" (007_bite_notes.sql) stays as-is and already covers
-- the owner's SELECT, INSERT, UPDATE, and DELETE.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.redemption_is_verified(p_redemption_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.redemptions as r
    where r.id = p_redemption_id
      and r.status = 'verified'
      and r.verified_at is not null
  );
$$;

comment on function public.redemption_is_verified(uuid) is
  'True only when that redemption has status verified and verified_at set. Returns a boolean and no other redemption column. SECURITY DEFINER so a non-owner SELECT policy can apply the check without reading redemptions under the caller RLS.';

revoke all on function public.redemption_is_verified(uuid) from public, anon, authenticated, service_role;
grant execute on function public.redemption_is_verified(uuid) to anon, authenticated;

drop policy if exists "Anyone can view public notes" on public.bite_notes;

create policy "Anyone can view public notes"
  on public.bite_notes
  for select
  using (
    is_public = true
    and public.redemption_is_verified(bite_notes.redemption_id)
  );

comment on policy "Anyone can view public notes" on public.bite_notes is
  'Non-owners can read a note only when it is public and its redemption is verified with verified_at set. Owners use "Users manage own notes".';
