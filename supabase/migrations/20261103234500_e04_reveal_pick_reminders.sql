-- One "ready to pick" email per member and period. Separate from
-- email_reminder_deliveries so the end-of-month redeem reminder keeps its row.
-- Not applied to hosted.

create table public.reveal_pick_reminders (
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  period_key date not null,
  status text not null default 'pending'
    check (status in (
      'pending',
      'processing',
      'sent',
      'failed',
      'skipped_opt_out',
      'skipped_suppressed',
      'needs_reconciliation'
    )),
  claim_token uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  recipient_email text,
  email_payload jsonb,
  idempotency_key text,
  idempotency_key_used_at timestamptz,
  resend_message_id text,
  reconciliation_reason text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, period_key)
);

comment on table public.reveal_pick_reminders is
  'One reveal-pick reminder per member and period. Claimed like email_reminder_deliveries.';

alter table public.reveal_pick_reminders enable row level security;

revoke all on table public.reveal_pick_reminders
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.reveal_pick_reminders to service_role;

create or replace function public.ensure_reveal_pick_reminder(
  p_user_id uuid,
  p_period_key date
)
returns void
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  insert into public.reveal_pick_reminders (user_id, period_key, status)
  values (p_user_id, p_period_key, 'pending')
  on conflict (user_id, period_key) do nothing;
end;
$$;

create or replace function public.claim_reveal_pick_reminder(
  p_user_id uuid,
  p_period_key date,
  p_token uuid
)
returns table (
  user_id uuid,
  period_key date,
  status text,
  claim_token uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  recipient_email text,
  email_payload jsonb,
  idempotency_key text,
  idempotency_key_used_at timestamptz,
  resend_message_id text,
  reconciliation_reason text,
  last_error text,
  created_at timestamptz,
  updated_at timestamptz,
  previous_status text
)
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
#variable_conflict use_column
begin
  if p_token is null then
    raise exception 'claim token required';
  end if;

  return query
  with picked as (
    select
      d.user_id,
      d.period_key,
      d.status as previous_status
    from public.reveal_pick_reminders d
    where d.user_id = p_user_id
      and d.period_key = p_period_key
      and (
        (d.claim_token is null and d.status in ('pending', 'failed'))
        or (d.status = 'processing' and d.claim_expires_at <= now())
      )
    for update skip locked
  )
  update public.reveal_pick_reminders d
  set status = 'processing',
      claim_token = p_token,
      claimed_at = now(),
      claim_expires_at = now() + interval '10 minutes',
      updated_at = now()
  from picked
  where d.user_id = picked.user_id
    and d.period_key = picked.period_key
  returning
    d.user_id,
    d.period_key,
    d.status,
    d.claim_token,
    d.claimed_at,
    d.claim_expires_at,
    d.recipient_email,
    d.email_payload,
    d.idempotency_key,
    d.idempotency_key_used_at,
    d.resend_message_id,
    d.reconciliation_reason,
    d.last_error,
    d.created_at,
    d.updated_at,
    picked.previous_status;
end;
$$;

create or replace function public.store_reveal_pick_reminder_payload(
  p_user_id uuid,
  p_period_key date,
  p_token uuid,
  p_recipient text,
  p_payload jsonb,
  p_idempotency_key text
)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.reveal_pick_reminders
  set recipient_email = p_recipient,
      email_payload = p_payload,
      idempotency_key = p_idempotency_key,
      idempotency_key_used_at = now(),
      updated_at = now()
  where user_id = p_user_id
    and period_key = p_period_key
    and claim_token = p_token
    and status = 'processing'
    and claim_expires_at > now()
    and email_payload is null;

  return found;
end;
$$;

create or replace function public.complete_reveal_pick_reminder(
  p_user_id uuid,
  p_period_key date,
  p_token uuid,
  p_message_id text
)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.reveal_pick_reminders
  set status = 'sent',
      resend_message_id = p_message_id,
      last_error = null,
      updated_at = now()
  where user_id = p_user_id
    and period_key = p_period_key
    and claim_token = p_token
    and status = 'processing'
    and claim_expires_at > now();

  return found;
end;
$$;

create or replace function public.skip_reveal_pick_reminder(
  p_user_id uuid,
  p_period_key date,
  p_token uuid,
  p_status text
)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  if p_status not in ('skipped_opt_out', 'skipped_suppressed') then
    raise exception 'invalid reminder skip status';
  end if;

  update public.reveal_pick_reminders
  set status = p_status,
      updated_at = now()
  where user_id = p_user_id
    and period_key = p_period_key
    and claim_token = p_token
    and status = 'processing'
    and claim_expires_at > now();

  return found;
end;
$$;

create or replace function public.release_reveal_pick_reminder(
  p_user_id uuid,
  p_period_key date,
  p_token uuid,
  p_error text
)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.reveal_pick_reminders
  set status = 'pending',
      claim_token = null,
      claimed_at = null,
      claim_expires_at = null,
      last_error = public.webhook_error_text(p_error),
      updated_at = now()
  where user_id = p_user_id
    and period_key = p_period_key
    and claim_token = p_token
    and status = 'processing'
    and claim_expires_at > now();

  return found;
end;
$$;

create or replace function public.fail_reveal_pick_reminder(
  p_user_id uuid,
  p_period_key date,
  p_token uuid,
  p_error text
)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.reveal_pick_reminders
  set status = 'failed',
      claim_token = null,
      claimed_at = null,
      claim_expires_at = null,
      last_error = public.webhook_error_text(p_error),
      updated_at = now()
  where user_id = p_user_id
    and period_key = p_period_key
    and claim_token = p_token
    and status = 'processing'
    and claim_expires_at > now();

  return found;
end;
$$;

create or replace function public.reconcile_reveal_pick_reminder(
  p_user_id uuid,
  p_period_key date,
  p_token uuid,
  p_reason text
)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.reveal_pick_reminders
  set status = 'needs_reconciliation',
      reconciliation_reason = public.webhook_error_text(p_reason),
      updated_at = now()
  where user_id = p_user_id
    and period_key = p_period_key
    and claim_token = p_token
    and status = 'processing'
    and claim_expires_at > now();

  return found;
end;
$$;

revoke all on function public.ensure_reveal_pick_reminder(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_reveal_pick_reminder(uuid, date, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.store_reveal_pick_reminder_payload(uuid, date, uuid, text, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_reveal_pick_reminder(uuid, date, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.skip_reveal_pick_reminder(uuid, date, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.release_reveal_pick_reminder(uuid, date, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.fail_reveal_pick_reminder(uuid, date, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reconcile_reveal_pick_reminder(uuid, date, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.ensure_reveal_pick_reminder(uuid, date) to service_role;
grant execute on function public.claim_reveal_pick_reminder(uuid, date, uuid) to service_role;
grant execute on function public.store_reveal_pick_reminder_payload(uuid, date, uuid, text, jsonb, text) to service_role;
grant execute on function public.complete_reveal_pick_reminder(uuid, date, uuid, text) to service_role;
grant execute on function public.skip_reveal_pick_reminder(uuid, date, uuid, text) to service_role;
grant execute on function public.release_reveal_pick_reminder(uuid, date, uuid, text) to service_role;
grant execute on function public.fail_reveal_pick_reminder(uuid, date, uuid, text) to service_role;
grant execute on function public.reconcile_reveal_pick_reminder(uuid, date, uuid, text) to service_role;
