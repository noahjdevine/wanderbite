-- G15: reminder claims, topic opt-out, and provider suppression.
-- Do not rewrite 20260908194148_stripe_events_webhook_outbox.sql.
-- The migration runner owns the transaction. Direct psql replay must use -1 -f.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Widen webhook_outbox status. Claim still selects only pending, failed, and
-- stale processing, so suppressed and needs_reconciliation are not retried.
do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_attribute att
    on att.attrelid = con.conrelid
   and att.attnum = any (con.conkey)
  where con.conrelid = 'public.webhook_outbox'::regclass
    and con.contype = 'c'
    and att.attname = 'status'
    and cardinality(con.conkey) = 1;

  if cname is null then
    raise exception 'webhook_outbox status check not found';
  end if;

  execute format('alter table public.webhook_outbox drop constraint %I', cname);
end $$;

alter table public.webhook_outbox
  add constraint webhook_outbox_status_check
  check (status in (
    'pending',
    'processing',
    'sent',
    'failed',
    'suppressed',
    'needs_reconciliation'
  ));

alter table public.webhook_outbox
  add column recipient_email text,
  add column email_payload jsonb,
  add column idempotency_key_used_at timestamptz,
  add column resend_message_id text,
  add column reconciliation_reason text,
  add column email_attempt_state text;

alter table public.webhook_outbox
  add constraint webhook_outbox_email_attempt_state_check
  check (
    email_attempt_state is null
    or email_attempt_state in ('stored', 'definite_failure')
  );

comment on column public.webhook_outbox.email_payload is
  'Exact confirmation payload from the first send attempt. Retries reuse it.';
comment on column public.webhook_outbox.idempotency_key_used_at is
  'First use of the effect key as a Resend idempotency key. Retries stop after 24 hours.';
comment on column public.webhook_outbox.email_attempt_state is
  'stored: payload saved, outcome unknown. definite_failure: provider rejected before accept.';

create table public.email_reminder_deliveries (
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  cycle_month date not null,
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
  primary key (user_id, cycle_month)
);

comment on table public.email_reminder_deliveries is
  'One adventure-reminder attempt per member and cycle. Claimed separately from webhook_outbox.';
comment on column public.email_reminder_deliveries.email_payload is
  'Exact from, to, subject, html, text, and headers of the first Resend attempt.';
comment on column public.email_reminder_deliveries.claim_expires_at is
  '10-minute lease. Longer than the reminder route maxDuration of 300 seconds.';

create table public.email_topic_preferences (
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  topic text not null check (topic = 'adventure_reminders'),
  opted_out boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, topic)
);

comment on table public.email_topic_preferences is
  'Explicit topic opt-out. No row means the member still receives adventure reminders.';

create table public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  normalized_address text not null,
  event_type text not null
    check (event_type in (
      'email.bounced',
      'email.complained',
      'email.suppressed',
      'synchronous_suppressed'
    )),
  email_id text,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint email_suppressions_address_key unique (normalized_address),
  constraint email_suppressions_event_email_key unique (event_type, email_id),
  constraint email_suppressions_address_shape_check
    check (normalized_address ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

comment on table public.email_suppressions is
  'Provider hard suppression. Members cannot clear it. One row per normalized address.';

create table public.email_webhook_deliveries (
  delivery_id text primary key,
  event_type text not null
    check (event_type in ('email.bounced', 'email.complained', 'email.suppressed')),
  email_id text,
  normalized_address text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint email_webhook_deliveries_address_shape_check
    check (normalized_address ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

comment on table public.email_webhook_deliveries is
  'Verified Resend webhook delivery ids. No raw body and no message contents.';

alter table public.email_reminder_deliveries enable row level security;
alter table public.email_topic_preferences enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.email_webhook_deliveries enable row level security;

revoke all on table public.email_reminder_deliveries
  from public, anon, authenticated, service_role;
revoke all on table public.email_topic_preferences
  from public, anon, authenticated, service_role;
revoke all on table public.email_suppressions
  from public, anon, authenticated, service_role;
revoke all on table public.email_webhook_deliveries
  from public, anon, authenticated, service_role;

grant select, insert, update on table public.email_reminder_deliveries to service_role;
grant select, insert, update on table public.email_topic_preferences to authenticated;
grant select, insert, update on table public.email_topic_preferences to service_role;
grant select, insert on table public.email_suppressions to service_role;
grant select, insert on table public.email_webhook_deliveries to service_role;

create policy "Users can select own email_topic_preferences"
  on public.email_topic_preferences
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own email_topic_preferences"
  on public.email_topic_preferences
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own email_topic_preferences"
  on public.email_topic_preferences
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.ensure_email_reminder_delivery(
  p_user_id uuid,
  p_cycle_month date
)
returns void
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  insert into public.email_reminder_deliveries (user_id, cycle_month, status)
  values (p_user_id, p_cycle_month, 'pending')
  on conflict (user_id, cycle_month) do nothing;
end;
$$;

create or replace function public.claim_email_reminder_delivery(
  p_user_id uuid,
  p_cycle_month date,
  p_token uuid
)
returns table (
  user_id uuid,
  cycle_month date,
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
      d.cycle_month,
      d.status as previous_status
    from public.email_reminder_deliveries d
    where d.user_id = p_user_id
      and d.cycle_month = p_cycle_month
      and (
        (d.claim_token is null and d.status in ('pending', 'failed'))
        or (d.status = 'processing' and d.claim_expires_at <= now())
      )
    for update skip locked
  )
  update public.email_reminder_deliveries d
  set status = 'processing',
      claim_token = p_token,
      claimed_at = now(),
      claim_expires_at = now() + interval '10 minutes',
      updated_at = now()
  from picked
  where d.user_id = picked.user_id
    and d.cycle_month = picked.cycle_month
  returning
    d.user_id,
    d.cycle_month,
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

create or replace function public.store_email_reminder_payload(
  p_user_id uuid,
  p_cycle_month date,
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
  update public.email_reminder_deliveries
  set recipient_email = p_recipient,
      email_payload = p_payload,
      idempotency_key = p_idempotency_key,
      idempotency_key_used_at = now(),
      updated_at = now()
  where user_id = p_user_id
    and cycle_month = p_cycle_month
    and claim_token = p_token
    and status = 'processing'
    and claim_expires_at > now()
    and email_payload is null;

  return found;
end;
$$;

create or replace function public.complete_email_reminder_delivery(
  p_user_id uuid,
  p_cycle_month date,
  p_token uuid,
  p_message_id text
)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.email_reminder_deliveries
  set status = 'sent',
      resend_message_id = p_message_id,
      last_error = null,
      updated_at = now()
  where user_id = p_user_id
    and cycle_month = p_cycle_month
    and claim_token = p_token
    and status = 'processing'
    and claim_expires_at > now();

  return found;
end;
$$;

create or replace function public.skip_email_reminder_delivery(
  p_user_id uuid,
  p_cycle_month date,
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

  update public.email_reminder_deliveries
  set status = p_status,
      updated_at = now()
  where user_id = p_user_id
    and cycle_month = p_cycle_month
    and claim_token = p_token
    and status = 'processing'
    and claim_expires_at > now();

  return found;
end;
$$;

create or replace function public.release_email_reminder_delivery(
  p_user_id uuid,
  p_cycle_month date,
  p_token uuid,
  p_error text
)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.email_reminder_deliveries
  set status = 'pending',
      claim_token = null,
      claimed_at = null,
      claim_expires_at = null,
      last_error = public.webhook_error_text(p_error),
      updated_at = now()
  where user_id = p_user_id
    and cycle_month = p_cycle_month
    and claim_token = p_token
    and status = 'processing'
    and claim_expires_at > now();

  return found;
end;
$$;

create or replace function public.fail_email_reminder_delivery(
  p_user_id uuid,
  p_cycle_month date,
  p_token uuid,
  p_error text
)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.email_reminder_deliveries
  set status = 'failed',
      claim_token = null,
      claimed_at = null,
      claim_expires_at = null,
      last_error = public.webhook_error_text(p_error),
      updated_at = now()
  where user_id = p_user_id
    and cycle_month = p_cycle_month
    and claim_token = p_token
    and status = 'processing'
    and claim_expires_at > now();

  return found;
end;
$$;

create or replace function public.reconcile_email_reminder_delivery(
  p_user_id uuid,
  p_cycle_month date,
  p_token uuid,
  p_reason text
)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.email_reminder_deliveries
  set status = 'needs_reconciliation',
      reconciliation_reason = public.webhook_error_text(p_reason),
      updated_at = now()
  where user_id = p_user_id
    and cycle_month = p_cycle_month
    and claim_token = p_token
    and status = 'processing'
    and claim_expires_at > now();

  return found;
end;
$$;

create or replace function public.store_webhook_outbox_email(
  p_effect_key text,
  p_token uuid,
  p_recipient text,
  p_email_payload jsonb
)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.webhook_outbox
  set recipient_email = p_recipient,
      email_payload = p_email_payload,
      idempotency_key_used_at = now(),
      email_attempt_state = 'stored',
      reconciliation_reason = null
  where effect_key = p_effect_key
    and claim_token = p_token
    and status = 'processing'
    and email_payload is null;

  return found;
end;
$$;

create or replace function public.mark_webhook_outbox_definite_failure(
  p_effect_key text,
  p_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.webhook_outbox
  set email_attempt_state = 'definite_failure'
  where effect_key = p_effect_key
    and claim_token = p_token
    and status = 'processing';

  return found;
end;
$$;

create or replace function public.complete_webhook_outbox_email(
  p_effect_key text,
  p_token uuid,
  p_message_id text
)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.webhook_outbox
  set status = 'sent',
      sent_at = now(),
      last_error = null,
      resend_message_id = p_message_id
  where effect_key = p_effect_key
    and claim_token = p_token
    and status = 'processing';

  return found;
end;
$$;

create or replace function public.suppress_webhook_outbox(
  p_effect_key text,
  p_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.webhook_outbox
  set status = 'suppressed',
      last_error = null
  where effect_key = p_effect_key
    and claim_token = p_token
    and status = 'processing';

  return found;
end;
$$;

create or replace function public.reconcile_webhook_outbox(
  p_effect_key text,
  p_token uuid,
  p_reason text
)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.webhook_outbox
  set status = 'needs_reconciliation',
      reconciliation_reason = public.webhook_error_text(p_reason),
      last_error = null
  where effect_key = p_effect_key
    and claim_token = p_token
    and status = 'processing';

  return found;
end;
$$;

create or replace function public.record_hard_email_suppression(
  p_address text,
  p_reason text,
  p_email_id text
)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  insert into public.email_suppressions (
    normalized_address,
    event_type,
    email_id,
    reason
  ) values (
    p_address,
    'synchronous_suppressed',
    nullif(p_email_id, ''),
    p_reason
  )
  on conflict (normalized_address) do nothing;

  return true;
exception
  when unique_violation then
    return true;
end;
$$;

create or replace function public.apply_resend_webhook_suppression(
  p_delivery_id text,
  p_event_type text,
  p_email_id text,
  p_address text,
  p_reason text
)
returns text
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  if p_delivery_id is null or length(btrim(p_delivery_id)) = 0 then
    raise exception 'delivery id required';
  end if;

  if exists (
    select 1
    from public.email_webhook_deliveries
    where delivery_id = p_delivery_id
  ) then
    return 'duplicate';
  end if;

  begin
    insert into public.email_webhook_deliveries (
      delivery_id,
      event_type,
      email_id,
      normalized_address,
      reason
    ) values (
      p_delivery_id,
      p_event_type,
      nullif(p_email_id, ''),
      p_address,
      p_reason
    );
  exception
    when unique_violation then
      return 'duplicate';
  end;

  begin
    insert into public.email_suppressions (
      normalized_address,
      event_type,
      email_id,
      reason
    ) values (
      p_address,
      p_event_type,
      nullif(p_email_id, ''),
      p_reason
    );
  exception
    when unique_violation then
      null;
  end;

  return 'applied';
end;
$$;

revoke all on function public.ensure_email_reminder_delivery(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_email_reminder_delivery(uuid, date, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.store_email_reminder_payload(uuid, date, uuid, text, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_email_reminder_delivery(uuid, date, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.skip_email_reminder_delivery(uuid, date, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.release_email_reminder_delivery(uuid, date, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.fail_email_reminder_delivery(uuid, date, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reconcile_email_reminder_delivery(uuid, date, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.store_webhook_outbox_email(text, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.mark_webhook_outbox_definite_failure(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_webhook_outbox_email(text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.suppress_webhook_outbox(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.reconcile_webhook_outbox(text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.record_hard_email_suppression(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_resend_webhook_suppression(text, text, text, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.ensure_email_reminder_delivery(uuid, date) to service_role;
grant execute on function public.claim_email_reminder_delivery(uuid, date, uuid) to service_role;
grant execute on function public.store_email_reminder_payload(uuid, date, uuid, text, jsonb, text) to service_role;
grant execute on function public.complete_email_reminder_delivery(uuid, date, uuid, text) to service_role;
grant execute on function public.skip_email_reminder_delivery(uuid, date, uuid, text) to service_role;
grant execute on function public.release_email_reminder_delivery(uuid, date, uuid, text) to service_role;
grant execute on function public.fail_email_reminder_delivery(uuid, date, uuid, text) to service_role;
grant execute on function public.reconcile_email_reminder_delivery(uuid, date, uuid, text) to service_role;
grant execute on function public.store_webhook_outbox_email(text, uuid, text, jsonb) to service_role;
grant execute on function public.mark_webhook_outbox_definite_failure(text, uuid) to service_role;
grant execute on function public.complete_webhook_outbox_email(text, uuid, text) to service_role;
grant execute on function public.suppress_webhook_outbox(text, uuid) to service_role;
grant execute on function public.reconcile_webhook_outbox(text, uuid, text) to service_role;
grant execute on function public.record_hard_email_suppression(text, text, text) to service_role;
grant execute on function public.apply_resend_webhook_suppression(text, text, text, text, text) to service_role;
