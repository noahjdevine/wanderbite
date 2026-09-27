-- E02 rollover: carry older pending credits one month, and keep active T1 rows for that job.
-- Does not assign restaurants, swap credits, or set workflow_version.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.credit_rollover_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete restrict,
  chicago_month date not null,
  reason text not null,
  linked_uncompleted_count integer not null,
  future_t2_count integer not null,
  created_at timestamptz not null default now(),
  constraint credit_rollover_exceptions_reason_check check (reason = 'carry_cap_exceeded'),
  constraint credit_rollover_exceptions_linked_count_check check (linked_uncompleted_count >= 0),
  constraint credit_rollover_exceptions_future_t2_count_check check (future_t2_count >= 0),
  constraint credit_rollover_exceptions_cap_check check (
    linked_uncompleted_count + future_t2_count > 2
  ),
  constraint credit_rollover_exceptions_user_month_reason_key unique (user_id, chicago_month, reason)
);

alter table public.credit_rollover_exceptions enable row level security;
revoke all on table public.credit_rollover_exceptions from public, anon, authenticated, service_role;
grant select on table public.credit_rollover_exceptions to service_role;

create or replace function public.rollover_credits(p_user_id uuid)
returns table (outcome text, exception_inserted boolean)
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  v_now timestamptz;
  v_month date;
  v_workflow text;
  v_subscription text;
  v_linked integer;
  v_future integer;
  v_additional integer;
  v_changed integer;
  v_rows integer;
  v_inserted integer;
  v_rank integer;
  v_credit_id uuid;
begin
  v_now := now();
  v_month := public.chicago_month_start(v_now);

  select up.workflow_version, up.subscription_status
    into v_workflow, v_subscription
  from public.user_profiles up
  where up.id = p_user_id
  for update;

  if not found or v_workflow is distinct from 'credits' then
    return query select 'legacy_workflow'::text, false;
    return;
  end if;
  if v_subscription is distinct from 'active' then
    return query select 'inactive_subscription'::text, false;
    return;
  end if;

  perform 1
  from public.entitlement_credits ec
  where ec.user_id = p_user_id
    and ec.issue_period < v_month
    and ec.status in ('pending', 'linked')
  order by ec.id
  for update;

  update public.entitlement_credits ec
  set status = 'expired'
  where ec.user_id = p_user_id
    and ec.issue_period < v_month
    and ec.status = 'pending'
    and ec.challenge_item_id is null
    and v_now >= ((ec.issue_period + interval '2 months')::timestamp at time zone 'America/Chicago');
  get diagnostics v_changed = row_count;

  select count(*)::integer into v_future
  from public.entitlement_credits ec
  where ec.user_id = p_user_id
    and ec.issue_period < v_month
    and ec.status = 'pending'
    and ec.challenge_item_id is null
    and ec.expires_at is not distinct from (
      (ec.issue_period + interval '2 months')::timestamp at time zone 'America/Chicago'
    )
    and v_now < ((ec.issue_period + interval '2 months')::timestamp at time zone 'America/Chicago');

  select count(*)::integer into v_linked
  from public.entitlement_credits ec
  where ec.user_id = p_user_id
    and ec.issue_period < v_month
    and ec.status = 'linked'
    and not exists (
      select 1
      from public.redemptions rd
      where rd.challenge_item_id = ec.challenge_item_id
        and rd.status = 'verified'
    );

  if v_linked + v_future > 2 then
    insert into public.credit_rollover_exceptions (
      user_id, chicago_month, reason, linked_uncompleted_count, future_t2_count
    ) values (
      p_user_id, v_month, 'carry_cap_exceeded', v_linked, v_future
    )
    on conflict on constraint credit_rollover_exceptions_user_month_reason_key do nothing;
    get diagnostics v_inserted = row_count;

    update public.entitlement_credits ec
    set status = 'expired'
    where ec.user_id = p_user_id
      and ec.issue_period < v_month
      and ec.status = 'pending'
      and ec.challenge_item_id is null
      and ec.expires_at is not distinct from (
        (ec.issue_period + interval '1 month')::timestamp at time zone 'America/Chicago'
      )
      and v_now >= ((ec.issue_period + interval '1 month')::timestamp at time zone 'America/Chicago')
      and v_now < ((ec.issue_period + interval '2 months')::timestamp at time zone 'America/Chicago');

    return query select 'rolled_with_exception'::text, v_inserted = 1;
    return;
  end if;

  v_additional := 2 - v_linked - v_future;
  v_rank := 0;
  for v_credit_id in
    select ec.id
    from public.entitlement_credits ec
    where ec.user_id = p_user_id
      and ec.issue_period < v_month
      and ec.status = 'pending'
      and ec.challenge_item_id is null
      and ec.expires_at is not distinct from (
        (ec.issue_period + interval '1 month')::timestamp at time zone 'America/Chicago'
      )
      and v_now >= ((ec.issue_period + interval '1 month')::timestamp at time zone 'America/Chicago')
      and v_now < ((ec.issue_period + interval '2 months')::timestamp at time zone 'America/Chicago')
    order by ec.expires_at, ec.issued_at, ec.id
  loop
    v_rank := v_rank + 1;
    if v_rank <= v_additional then
      update public.entitlement_credits ec
      set expires_at = ((ec.issue_period + interval '2 months')::timestamp at time zone 'America/Chicago')
      where ec.id = v_credit_id;
    else
      update public.entitlement_credits ec
      set status = 'expired'
      where ec.id = v_credit_id;
    end if;
    get diagnostics v_rows = row_count;
    v_changed := v_changed + v_rows;
  end loop;

  if v_changed > 0 then
    return query select 'rolled'::text, false;
    return;
  end if;
  return query select 'unchanged'::text, false;
  return;
end;
$$;

create or replace function public.expire_due_pending_credits()
returns integer
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  v_count integer;
begin
  update public.entitlement_credits ec
  set status = 'expired'
  where ec.status = 'pending'
    and ec.challenge_item_id is null
    and ec.expires_at <= now()
    and not (
      exists (
        select 1
        from public.user_profiles up
        where up.id = ec.user_id
          and up.workflow_version = 'credits'
          and up.subscription_status = 'active'
      )
      and ec.expires_at is not distinct from (
        (ec.issue_period + interval '1 month')::timestamp at time zone 'America/Chicago'
      )
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.rollover_credits(uuid) from public, anon, authenticated, service_role;
revoke all on function public.expire_due_pending_credits() from public, anon, authenticated, service_role;
grant execute on function public.rollover_credits(uuid) to service_role;
grant execute on function public.expire_due_pending_credits() to service_role;
