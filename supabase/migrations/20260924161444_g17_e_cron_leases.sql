-- G17-E: job leases, durable item outcomes, and truthful cron status.
-- Does not rewrite 022, the G8 grants migration, the G9 outbox claim
-- functions, or the G15 reminder claim functions.
-- A lease fences the log. One in-flight side effect may still commit after
-- expiry. The next batch must not start. Item idempotency covers that window.
-- Let the migration runner own the transaction.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.cron_runs
  add column run_key text,
  add column owner_token uuid;

do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  where con.conrelid = 'public.cron_runs'::regclass
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%status%';
  if cname is not null then
    execute format('alter table public.cron_runs drop constraint %I', cname);
  end if;
end $$;

alter table public.cron_runs
  add constraint cron_runs_status_check
  check (status in ('running', 'success', 'failed', 'degraded'));

create unique index cron_runs_one_running_job_key
  on public.cron_runs (job_name, run_key)
  where status = 'running';

comment on column public.cron_runs.run_key is
  'Stable logical key. One running row per (job_name, run_key). Later attempts may reuse the key after the previous row is terminal.';

create table public.cron_job_leases (
  job_name text primary key,
  run_key text,
  owner_token uuid,
  lease_expires_at timestamptz,
  attempt_run_id bigint references public.cron_runs (id),
  checkpoint jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.cron_job_leases is
  'One owner per scheduled job. Expiry is the crash bound. Release clears the owner and does not set success.';

create table public.cron_run_items (
  run_id bigint not null references public.cron_runs (id),
  item_key text not null,
  status text not null check (status in ('pending', 'succeeded', 'skipped', 'failed')),
  detail jsonb,
  error text,
  updated_at timestamptz not null default now(),
  primary key (run_id, item_key)
);

comment on table public.cron_run_items is
  'Durable per-item outcomes. A cursor is not the progress record.';

alter table public.cron_job_leases enable row level security;
alter table public.cron_run_items enable row level security;

revoke all on table public.cron_job_leases
  from public, anon, authenticated, service_role;
revoke all on table public.cron_run_items
  from public, anon, authenticated, service_role;

grant select, insert, update on table public.cron_job_leases to service_role;
grant select, insert, update on table public.cron_run_items to service_role;

create or replace function public.cron_run_item_counts(p_run_id bigint)
returns jsonb
language sql
stable
security invoker
set search_path to public, pg_catalog
as $$
  select jsonb_build_object(
    'succeeded', count(*) filter (where status = 'succeeded'),
    'skipped', count(*) filter (where status = 'skipped'),
    'failed', count(*) filter (where status = 'failed'),
    'pending', count(*) filter (where status = 'pending')
  )
  from public.cron_run_items
  where run_id = p_run_id;
$$;

create or replace function public.acquire_cron_lease(
  p_job_name text,
  p_run_key text,
  p_token uuid,
  p_lease_seconds integer,
  p_checkpoint jsonb,
  p_resume_expired boolean,
  p_allow_new_attempt boolean
) returns jsonb
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
declare
  lease public.cron_job_leases%rowtype;
  run public.cron_runs%rowtype;
  degraded jsonb := '[]'::jsonb;
  counts jsonb;
  new_id bigint;
  lease_seconds integer := greatest(coalesce(p_lease_seconds, 0), 1);
  close_error text;
begin
  if p_token is null or p_job_name is null or btrim(p_job_name) = ''
     or p_run_key is null or btrim(p_run_key) = '' then
    raise exception 'cron lease requires job, run key, and token';
  end if;

  insert into public.cron_job_leases (job_name)
  values (p_job_name)
  on conflict (job_name) do nothing;

  select * into lease
  from public.cron_job_leases
  where job_name = p_job_name
  for update;

  for run in
    select *
    from public.cron_runs
    where job_name = p_job_name
      and status = 'running'
    order by id
    for update
  loop
    if lease.attempt_run_id = run.id
       and lease.owner_token is not null
       and lease.lease_expires_at > now()
       and run.owner_token is not distinct from lease.owner_token
    then
      if run.run_key is distinct from p_run_key
         or run.owner_token is distinct from p_token then
        return jsonb_build_object(
          'acquired', false,
          'reason', 'lease-held',
          'run_id', run.id,
          'run_key', run.run_key,
          'resumed', false,
          'degraded_previous', degraded
        );
      end if;

      update public.cron_job_leases
      set lease_expires_at = now() + make_interval(secs => lease_seconds),
          checkpoint = coalesce(p_checkpoint, checkpoint),
          updated_at = now()
      where job_name = p_job_name;

      return jsonb_build_object(
        'acquired', true,
        'reason', 'acquired',
        'run_id', run.id,
        'run_key', run.run_key,
        'resumed', false,
        'checkpoint', (
          select l.checkpoint from public.cron_job_leases l where l.job_name = p_job_name
        ),
        'degraded_previous', degraded
      );
    end if;

    if run.run_key is not distinct from p_run_key and p_resume_expired then
      update public.cron_runs
      set owner_token = p_token
      where id = run.id;

      update public.cron_job_leases
      set run_key = p_run_key,
          owner_token = p_token,
          lease_expires_at = now() + make_interval(secs => lease_seconds),
          attempt_run_id = run.id,
          checkpoint = coalesce(p_checkpoint, checkpoint),
          updated_at = now()
      where job_name = p_job_name;

      return jsonb_build_object(
        'acquired', true,
        'reason', 'resumed',
        'run_id', run.id,
        'run_key', p_run_key,
        'resumed', true,
        'checkpoint', (
          select l.checkpoint from public.cron_job_leases l where l.job_name = p_job_name
        ),
        'degraded_previous', degraded
      );
    end if;

    close_error := case
      when run.run_key is not distinct from p_run_key then 'lease expired before finalize'
      else 'unfinished at period boundary'
    end;
    counts := public.cron_run_item_counts(run.id);

    update public.cron_runs
    set status = 'degraded',
        finished_at = now(),
        owner_token = null,
        error = close_error,
        result = coalesce(result, '{}'::jsonb) || counts
    where id = run.id
      and status = 'running';

    degraded := degraded || jsonb_build_array(jsonb_build_object(
      'run_id', run.id,
      'run_key', run.run_key,
      'error', close_error
    ));
  end loop;

  if not p_allow_new_attempt then
    select * into run
    from public.cron_runs
    where job_name = p_job_name
      and run_key = p_run_key
      and status in ('success', 'degraded', 'failed')
    order by id desc
    limit 1;

    if found then
      return jsonb_build_object(
        'acquired', false,
        'reason', 'terminal',
        'run_id', run.id,
        'run_key', run.run_key,
        'resumed', false,
        'terminal_status', run.status,
        'terminal_result', run.result,
        'terminal_error', run.error,
        'degraded_previous', degraded
      );
    end if;
  end if;

  insert into public.cron_runs (job_name, status, run_key, owner_token, result)
  values (
    p_job_name,
    'running',
    p_run_key,
    p_token,
    jsonb_build_object('succeeded', 0, 'skipped', 0, 'failed', 0, 'pending', 0)
  )
  returning id into new_id;

  update public.cron_job_leases
  set run_key = p_run_key,
      owner_token = p_token,
      lease_expires_at = now() + make_interval(secs => lease_seconds),
      attempt_run_id = new_id,
      checkpoint = p_checkpoint,
      updated_at = now()
  where job_name = p_job_name;

  return jsonb_build_object(
    'acquired', true,
    'reason', 'acquired',
    'run_id', new_id,
    'run_key', p_run_key,
    'resumed', false,
    'checkpoint', p_checkpoint,
    'degraded_previous', degraded
  );
end;
$$;

create or replace function public.renew_cron_lease(
  p_job_name text,
  p_token uuid,
  p_run_id bigint,
  p_lease_seconds integer,
  p_checkpoint jsonb
) returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
declare
  lease_seconds integer := greatest(coalesce(p_lease_seconds, 0), 1);
begin
  update public.cron_job_leases as l
  set lease_expires_at = now() + make_interval(secs => lease_seconds),
      checkpoint = coalesce(p_checkpoint, l.checkpoint),
      updated_at = now()
  from public.cron_runs as r
  where l.job_name = p_job_name
    and l.owner_token = p_token
    and l.attempt_run_id = p_run_id
    and l.lease_expires_at > now()
    and r.id = p_run_id
    and r.job_name = p_job_name
    and r.status = 'running'
    and r.owner_token = p_token;

  return found;
end;
$$;

create or replace function public.record_cron_run_item(
  p_job_name text,
  p_token uuid,
  p_run_id bigint,
  p_item_key text,
  p_status text,
  p_detail jsonb,
  p_error text
) returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
declare
  counts jsonb;
begin
  if p_item_key is null or btrim(p_item_key) = '' then
    raise exception 'cron item key required';
  end if;
  if p_status not in ('pending', 'succeeded', 'skipped', 'failed') then
    raise exception 'invalid cron item status';
  end if;

  if not exists (
    select 1
    from public.cron_job_leases l
    join public.cron_runs r on r.id = l.attempt_run_id
    where l.job_name = p_job_name
      and l.owner_token = p_token
      and l.attempt_run_id = p_run_id
      and l.lease_expires_at > now()
      and r.status = 'running'
      and r.owner_token = p_token
      and r.job_name = p_job_name
  ) then
    return false;
  end if;

  insert into public.cron_run_items (run_id, item_key, status, detail, error)
  values (p_run_id, p_item_key, p_status, p_detail, p_error)
  on conflict (run_id, item_key) do update
  set status = excluded.status,
      detail = excluded.detail,
      error = excluded.error,
      updated_at = now()
  where public.cron_run_items.status = 'pending'
    and excluded.status in ('succeeded', 'skipped', 'failed');

  counts := public.cron_run_item_counts(p_run_id);
  update public.cron_runs
  set result = coalesce(result, '{}'::jsonb) || counts
  where id = p_run_id
    and status = 'running'
    and owner_token = p_token;

  return true;
end;
$$;

create or replace function public.release_cron_lease(
  p_job_name text,
  p_token uuid,
  p_run_id bigint
) returns boolean
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
begin
  update public.cron_job_leases
  set owner_token = null,
      lease_expires_at = null,
      updated_at = now()
  where job_name = p_job_name
    and owner_token = p_token
    and attempt_run_id = p_run_id
    and exists (
      select 1
      from public.cron_runs r
      where r.id = p_run_id
        and r.status = 'running'
        and r.owner_token = p_token
        and r.job_name = p_job_name
    );

  if not found then
    return false;
  end if;

  update public.cron_runs
  set owner_token = null
  where id = p_run_id
    and status = 'running'
    and owner_token = p_token;

  return true;
end;
$$;

create or replace function public.finalize_cron_lease(
  p_job_name text,
  p_token uuid,
  p_run_id bigint,
  p_status text,
  p_result jsonb,
  p_error text
) returns jsonb
language plpgsql
security invoker
set search_path to public, pg_catalog
as $$
declare
  counts jsonb;
  pending_count integer;
  failed_count integer;
  stored jsonb;
begin
  if p_status not in ('success', 'degraded', 'failed') then
    raise exception 'invalid cron finalize status';
  end if;

  if not exists (
    select 1
    from public.cron_job_leases l
    join public.cron_runs r on r.id = l.attempt_run_id
    where l.job_name = p_job_name
      and l.owner_token = p_token
      and l.attempt_run_id = p_run_id
      and l.lease_expires_at > now()
      and r.status = 'running'
      and r.owner_token = p_token
      and r.job_name = p_job_name
  ) then
    return jsonb_build_object('finalized', false, 'reason', 'lost-lease');
  end if;

  counts := public.cron_run_item_counts(p_run_id);
  pending_count := coalesce((counts ->> 'pending')::integer, 0);
  failed_count := coalesce((counts ->> 'failed')::integer, 0);

  if p_status = 'success' and (pending_count > 0 or failed_count > 0) then
    return jsonb_build_object('finalized', false, 'reason', 'items-not-clear', 'result', counts);
  end if;

  if p_status = 'degraded' then
    if pending_count > 0 and p_error is distinct from 'period boundary crossed during run' then
      return jsonb_build_object('finalized', false, 'reason', 'pending-items', 'result', counts);
    end if;
    if pending_count = 0
       and failed_count = 0
       and p_error is distinct from 'period boundary crossed during run' then
      return jsonb_build_object('finalized', false, 'reason', 'not-degraded', 'result', counts);
    end if;
  end if;

  stored := coalesce(p_result, '{}'::jsonb) || counts;

  update public.cron_runs
  set status = p_status,
      finished_at = now(),
      error = p_error,
      result = stored,
      owner_token = null
  where id = p_run_id
    and status = 'running'
    and owner_token = p_token;

  if not found then
    return jsonb_build_object('finalized', false, 'reason', 'lost-lease');
  end if;

  update public.cron_job_leases
  set owner_token = null,
      lease_expires_at = null,
      updated_at = now()
  where job_name = p_job_name
    and owner_token = p_token
    and attempt_run_id = p_run_id;

  return jsonb_build_object('finalized', true, 'status', p_status, 'result', stored);
end;
$$;

revoke all on function public.cron_run_item_counts(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.acquire_cron_lease(text, text, uuid, integer, jsonb, boolean, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.renew_cron_lease(text, uuid, bigint, integer, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.record_cron_run_item(text, uuid, bigint, text, text, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.release_cron_lease(text, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_cron_lease(text, uuid, bigint, text, jsonb, text)
  from public, anon, authenticated, service_role;

grant execute on function public.cron_run_item_counts(bigint) to service_role;
grant execute on function public.acquire_cron_lease(text, text, uuid, integer, jsonb, boolean, boolean) to service_role;
grant execute on function public.renew_cron_lease(text, uuid, bigint, integer, jsonb) to service_role;
grant execute on function public.record_cron_run_item(text, uuid, bigint, text, text, jsonb, text) to service_role;
grant execute on function public.release_cron_lease(text, uuid, bigint) to service_role;
grant execute on function public.finalize_cron_lease(text, uuid, bigint, text, jsonb, text) to service_role;
