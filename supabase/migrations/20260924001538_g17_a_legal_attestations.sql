-- G17-A: stored 21+ and terms attestation for the current terms/privacy pair.
-- No backfill. A later text change ships a new migration before the new screen.
-- This function stores only its own version and content id, and only when the
-- presented version matches. Let the migration runner own the transaction.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.legal_attestations (
  user_id uuid not null references auth.users (id) on delete cascade,
  document_version text not null,
  content_id text not null,
  age_21 boolean not null,
  attested_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (user_id, document_version),
  constraint legal_attestations_age_21_true check (age_21),
  constraint legal_attestations_current_pair check (
    document_version = '2026-02-22'
    and content_id = '53e3148013cc72dd9c0f7856fc2dd2bf6d4b870e89fdcd59fe0ee5073b3de1fb'
  )
);

comment on table public.legal_attestations is
  'Explicit 21+ and terms attestation. Absence of the current version is the map. No backfill.';

alter table public.legal_attestations enable row level security;

create policy legal_attestations_select_own
  on public.legal_attestations
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select auth.jwt() ->> 'is_anonymous') is distinct from 'true'
  );

revoke all on table public.legal_attestations
  from public, anon, authenticated, service_role;
grant select on table public.legal_attestations to authenticated, service_role;

create or replace function public.record_legal_attestation(
  p_presented_version text,
  p_age_21 boolean,
  p_agree_to_terms boolean
)
returns void
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_version constant text := '2026-02-22';
  v_content_id constant text := '53e3148013cc72dd9c0f7856fc2dd2bf6d4b870e89fdcd59fe0ee5073b3de1fb';
begin
  if v_uid is null then
    raise exception 'legal attestation rejected';
  end if;
  if (auth.jwt() ->> 'is_anonymous') = 'true'
    or p_presented_version is distinct from v_version
    or p_age_21 is distinct from true
    or p_agree_to_terms is distinct from true
  then
    raise exception 'legal attestation rejected';
  end if;

  insert into public.legal_attestations (
    user_id,
    document_version,
    content_id,
    age_21
  ) values (
    v_uid,
    v_version,
    v_content_id,
    true
  )
  on conflict (user_id, document_version) do nothing;
end;
$$;

comment on function public.record_legal_attestation(text, boolean, boolean) is
  'Records the pinned terms version for auth.uid(). Rejects null and anonymous users. No caller identity, content id, or timestamp.';

revoke all on function public.record_legal_attestation(text, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.record_legal_attestation(text, boolean, boolean)
  to authenticated;
