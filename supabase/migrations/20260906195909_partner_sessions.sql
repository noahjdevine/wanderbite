-- SEC-02 / G3: hashed partner sessions. Service-role only.
-- Do not rewrite historical migrations. Rollback is drop this table, never
-- restore UUID cookies. Let the migration runner own the transaction.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.partner_sessions (
  token_hash text primary key
    check (token_hash ~ '^[0-9a-f]{64}$'),
  restaurant_id uuid not null
    references public.restaurants (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);

create index partner_sessions_restaurant_id_idx
  on public.partner_sessions (restaurant_id);

alter table public.partner_sessions enable row level security;

revoke all on table public.partner_sessions
  from public, anon, authenticated, service_role;

grant select, insert, delete on table public.partner_sessions
  to service_role;
