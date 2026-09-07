-- SEC-04 / G6: atomic issued → verified with expires_at.
-- Do not rewrite historical migrations. Rollback is keep this column/function;
-- never restore select-then-update by id. Let the migration runner own the
-- transaction. Direct psql replay must use -1 -f.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if exists (
    select 1
    from public.redemptions
    where created_at is null
  ) then
    raise exception 'SEC-04/M4: redemptions.created_at contains nulls; refuse backfill';
  end if;
end $$;

alter table public.redemptions
  add column expires_at timestamptz;

update public.redemptions
set expires_at = created_at + interval '35 days';

alter table public.redemptions
  alter column expires_at set default (now() + interval '35 days'),
  alter column expires_at set not null;

comment on column public.redemptions.expires_at is
  'Issue TTL (created_at + 35 days). Verify requires expires_at > now(); nulls are not allowed.';

create index idx_redemptions_token_hash
  on public.redemptions (token_hash);

create or replace function public.verify_redemption(
  p_token_hash text,
  p_restaurant_id uuid
)
returns setof public.redemptions
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
declare
  claimed public.redemptions[];
begin
  with updated as (
    update public.redemptions
    set status = 'verified',
        verified_at = now()
    where token_hash = p_token_hash
      and restaurant_id = p_restaurant_id
      and status = 'issued'
      and expires_at > now()
    returning *
  )
  select coalesce(array_agg(updated), '{}')
    into claimed
  from updated;

  if cardinality(claimed) > 1 then
    raise exception 'duplicate issued redemptions for token_hash'
      using errcode = '23514';
  end if;

  if cardinality(claimed) = 1 then
    return next claimed[1];
  end if;

  return;
end;
$$;

comment on function public.verify_redemption(text, uuid) is
  'Atomic issued → verified for one unexpired hash at one restaurant. Duplicate matches abort and roll back.';

revoke all on function public.verify_redemption(text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.verify_redemption(text, uuid)
  to service_role;
