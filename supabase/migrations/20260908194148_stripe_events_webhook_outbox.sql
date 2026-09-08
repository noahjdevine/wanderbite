-- OPS-01 / G9: Stripe event ledger, claimed webhook outbox, fail-closed statuses.
-- Do not rewrite historical migrations. Rollback is drop these objects; never
-- restore fail-open status mapping or inline email from the webhook. Let the
-- migration runner own the transaction. Direct psql replay must use -1 -f.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.user_profiles
  add column if not exists stripe_subscription_id text;

comment on column public.user_profiles.stripe_subscription_id is
  'Current Stripe subscription id. Events for a superseded subscription are ignored.';

alter table public.user_profiles
  drop constraint if exists user_profiles_subscription_status_check;

alter table public.user_profiles
  add constraint user_profiles_subscription_status_check
  check (subscription_status in (
    'inactive',
    'active',
    'past_due',
    'canceled',
    'trialing',
    'paused',
    'incomplete'
  ));

alter policy "Users can insert own profile" on public.user_profiles
  with check (
    auth.uid() = id
    and role is not distinct from 'subscriber'
    and is_admin is not distinct from false
    and subscription_status is not distinct from 'inactive'
    and stripe_customer_id is null
    and stripe_subscription_id is null
    and current_period_end is null
  );

create or replace function public.protect_user_profiles_privileged_columns()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role is distinct from 'subscriber'
      or new.is_admin is distinct from false
      or new.subscription_status is distinct from 'inactive'
      or new.stripe_customer_id is not null
      or new.stripe_subscription_id is not null
      or new.current_period_end is not null
    then
      raise exception 'Cannot modify privileged profile columns'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role
    or new.is_admin is distinct from old.is_admin
    or new.subscription_status is distinct from old.subscription_status
    or new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.stripe_subscription_id is distinct from old.stripe_subscription_id
    or new.current_period_end is distinct from old.current_period_end
  then
    raise exception 'Cannot modify privileged profile columns'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create table public.stripe_events (
  event_id text primary key,
  event_type text not null,
  object_id text,
  livemode boolean not null,
  api_version text,
  stripe_created timestamptz not null,
  payload jsonb not null,
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'failed')),
  attempts integer not null default 0
    check (attempts >= 0),
  last_error text,
  received_at timestamptz not null default now(),
  claimed_at timestamptz,
  claim_token uuid,
  processed_at timestamptz,
  available_at timestamptz not null default now()
);

comment on table public.stripe_events is
  'Verified Stripe webhook events. payload is service-role-only replay JSON; nulled 90 days after processed_at.';
comment on column public.stripe_events.payload is
  'Verified Stripe Event after signature check. Not copied onto webhook_outbox rows.';

create index stripe_events_status_available_at_idx
  on public.stripe_events (status, available_at);

create table public.webhook_outbox (
  effect_key text primary key,
  effect_type text not null
    check (effect_type in (
      'subscription_confirmation_email',
      'subscription_started',
      'subscription_canceled'
    )),
  source_event_id text not null
    references public.stripe_events (event_id),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0
    check (attempts >= 0),
  last_error text,
  claimed_at timestamptz,
  claim_token uuid,
  available_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

comment on table public.webhook_outbox is
  'Idempotent side effects keyed by business effect_key, not Stripe event id.';
comment on column public.webhook_outbox.payload is
  'Effect-only data (userId, to, subscriptionId, customerId). Not the full Stripe event.';

create index webhook_outbox_status_available_at_idx
  on public.webhook_outbox (status, available_at);

alter table public.stripe_events enable row level security;
alter table public.webhook_outbox enable row level security;

revoke all on table public.stripe_events
  from public, anon, authenticated, service_role;
revoke all on table public.webhook_outbox
  from public, anon, authenticated, service_role;

grant select, insert, update on table public.stripe_events to service_role;
grant select, insert, update on table public.webhook_outbox to service_role;

create or replace function public.webhook_error_text(p_error text)
returns text
language sql
immutable
parallel safe
set search_path to public, pg_catalog
as $$
  select left(
    regexp_replace(coalesce(p_error, 'unknown'), E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]', '', 'g'),
    500
  );
$$;

create or replace function public.insert_stripe_event(
  p_event_id text,
  p_event_type text,
  p_object_id text,
  p_livemode boolean,
  p_api_version text,
  p_stripe_created timestamptz,
  p_payload jsonb
)
returns public.stripe_events
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
declare
  result public.stripe_events;
begin
  insert into public.stripe_events (
    event_id,
    event_type,
    object_id,
    livemode,
    api_version,
    stripe_created,
    payload,
    status
  ) values (
    p_event_id,
    p_event_type,
    p_object_id,
    p_livemode,
    p_api_version,
    p_stripe_created,
    p_payload,
    'received'
  )
  on conflict (event_id) do nothing;

  select * into strict result
  from public.stripe_events
  where event_id = p_event_id;

  return result;
end;
$$;

create or replace function public.claim_stripe_event(p_event_id text, p_token uuid)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  if p_token is null then
    raise exception 'claim token required';
  end if;

  update public.stripe_events
  set status = 'processing',
      claimed_at = now(),
      claim_token = p_token,
      attempts = attempts + 1
  where event_id = p_event_id
    and (
      status in ('received', 'failed')
      or (status = 'processing' and claimed_at < now() - interval '5 minutes')
    );

  return found;
end;
$$;

create or replace function public.complete_stripe_event(p_event_id text, p_token uuid)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.stripe_events
  set status = 'processed',
      processed_at = now(),
      last_error = null
  where event_id = p_event_id
    and claim_token = p_token
    and status = 'processing';

  return found;
end;
$$;

create or replace function public.fail_stripe_event(p_event_id text, p_token uuid, p_error text)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.stripe_events
  set status = 'failed',
      last_error = public.webhook_error_text(p_error),
      available_at = now() + least(
        interval '1 hour',
        interval '15 seconds' * (2 ^ least(attempts, 8))::double precision
      )
  where event_id = p_event_id
    and claim_token = p_token
    and status = 'processing';

  return found;
end;
$$;

create or replace function public.claim_stripe_events_batch(p_limit integer, p_token uuid)
returns setof public.stripe_events
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  if p_token is null then
    raise exception 'claim token required';
  end if;

  return query
  with picked as (
    select e.event_id
    from public.stripe_events e
    where e.available_at <= now()
      and (
        e.status = 'failed'
        or (e.status = 'processing' and e.claimed_at < now() - interval '5 minutes')
        or (e.status = 'received' and e.received_at < now() - interval '10 minutes')
      )
    order by e.available_at
    limit greatest(coalesce(p_limit, 0), 0)
    for update skip locked
  )
  update public.stripe_events e
  set status = 'processing',
      claimed_at = now(),
      claim_token = p_token,
      attempts = e.attempts + 1
  from picked
  where e.event_id = picked.event_id
  returning e.*;
end;
$$;

create or replace function public.enqueue_webhook_outbox(
  p_effect_key text,
  p_effect_type text,
  p_source_event_id text,
  p_payload jsonb
)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  insert into public.webhook_outbox (
    effect_key,
    effect_type,
    source_event_id,
    payload,
    status
  ) values (
    p_effect_key,
    p_effect_type,
    p_source_event_id,
    coalesce(p_payload, '{}'::jsonb),
    'pending'
  )
  on conflict (effect_key) do nothing;

  return found;
end;
$$;

create or replace function public.claim_webhook_outbox_batch(p_limit integer, p_token uuid)
returns setof public.webhook_outbox
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  if p_token is null then
    raise exception 'claim token required';
  end if;

  return query
  with picked as (
    select o.effect_key
    from public.webhook_outbox o
    where o.available_at <= now()
      and (
        o.status in ('pending', 'failed')
        or (o.status = 'processing' and o.claimed_at < now() - interval '5 minutes')
      )
    order by o.available_at
    limit greatest(coalesce(p_limit, 0), 0)
    for update skip locked
  )
  update public.webhook_outbox o
  set status = 'processing',
      claimed_at = now(),
      claim_token = p_token,
      attempts = o.attempts + 1
  from picked
  where o.effect_key = picked.effect_key
  returning o.*;
end;
$$;

create or replace function public.complete_webhook_outbox(p_effect_key text, p_token uuid)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.webhook_outbox
  set status = 'sent',
      sent_at = now(),
      last_error = null
  where effect_key = p_effect_key
    and claim_token = p_token
    and status = 'processing';

  return found;
end;
$$;

create or replace function public.fail_webhook_outbox(p_effect_key text, p_token uuid, p_error text)
returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.webhook_outbox
  set status = 'failed',
      last_error = public.webhook_error_text(p_error),
      available_at = case
        when created_at < now() - interval '14 days' then now() + interval '100 years'
        else now() + least(
          interval '1 hour',
          interval '15 seconds' * (2 ^ least(attempts, 8))::double precision
        )
      end
  where effect_key = p_effect_key
    and claim_token = p_token
    and status = 'processing';

  return found;
end;
$$;

create or replace function public.purge_stripe_event_payloads()
returns integer
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
declare
  changed integer;
begin
  update public.stripe_events
  set payload = '{}'::jsonb
  where processed_at is not null
    and processed_at < now() - interval '90 days'
    and payload <> '{}'::jsonb;

  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.webhook_error_text(text)
  from public, anon, authenticated, service_role;
revoke all on function public.insert_stripe_event(text, text, text, boolean, text, timestamptz, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_stripe_event(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_stripe_event(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.fail_stripe_event(text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_stripe_events_batch(integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.enqueue_webhook_outbox(text, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_webhook_outbox_batch(integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_webhook_outbox(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.fail_webhook_outbox(text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.purge_stripe_event_payloads()
  from public, anon, authenticated, service_role;

grant execute on function public.webhook_error_text(text) to service_role;
grant execute on function public.insert_stripe_event(text, text, text, boolean, text, timestamptz, jsonb) to service_role;
grant execute on function public.claim_stripe_event(text, uuid) to service_role;
grant execute on function public.complete_stripe_event(text, uuid) to service_role;
grant execute on function public.fail_stripe_event(text, uuid, text) to service_role;
grant execute on function public.claim_stripe_events_batch(integer, uuid) to service_role;
grant execute on function public.enqueue_webhook_outbox(text, text, text, jsonb) to service_role;
grant execute on function public.claim_webhook_outbox_batch(integer, uuid) to service_role;
grant execute on function public.complete_webhook_outbox(text, uuid) to service_role;
grant execute on function public.fail_webhook_outbox(text, uuid, text) to service_role;
grant execute on function public.purge_stripe_event_payloads() to service_role;
