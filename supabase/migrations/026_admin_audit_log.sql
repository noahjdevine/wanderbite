-- Audit log for admin mutations. Written via service role; read by admins via RLS.

create table if not exists public.admin_audit_log (
  id bigserial primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

comment on table public.admin_audit_log is
  'Immutable log of admin actions: who, what, when. Written by /lib/audit. Read by /admin audit log view.';

create index if not exists admin_audit_log_actor_created_idx
  on public.admin_audit_log (actor_user_id, created_at desc);

create index if not exists admin_audit_log_action_idx
  on public.admin_audit_log (action);

create index if not exists admin_audit_log_target_idx
  on public.admin_audit_log (target_type, target_id);

alter table public.admin_audit_log enable row level security;

drop policy if exists "admins can read audit log" on public.admin_audit_log;
create policy "admins can read audit log"
  on public.admin_audit_log
  for select
  to authenticated
  using (
    exists (
      select 1 from public.user_profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- No INSERT/UPDATE/DELETE policies — service role writes only.
