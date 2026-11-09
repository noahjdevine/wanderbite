-- E07-D1 member visit-problem cases.
-- NOT applied to hosted. Do not run supabase db push for this file in this PR.
-- Records a case and an admin review only. It does not change visits, quotes,
-- savings, credits, badges, or subscriptions.
-- E07_VISIT_PROBLEMS_ENABLED stays unset. E08_JOURNAL_REFLECTIONS_ENABLED is untouched.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.visit_problem_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete restrict,
  challenge_item_id uuid not null references public.challenge_items (id) on delete restrict,
  redemption_id uuid references public.redemptions (id) on delete restrict,
  category text not null,
  explanation text not null,
  status text not null default 'submitted',
  member_response text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visit_problem_cases_category_check
    check (category in ('wrong_discount', 'offer_refused', 'check_in_code', 'other')),
  constraint visit_problem_cases_explanation_len
    check (
      char_length(explanation) between 1 and 500
      and char_length(btrim(explanation)) >= 1
    ),
  constraint visit_problem_cases_status_check
    check (status in ('submitted', 'under_review', 'resolved')),
  constraint visit_problem_cases_response_len
    check (
      member_response is null
      or (
        char_length(member_response) between 1 and 500
        and char_length(btrim(member_response)) >= 1
      )
    ),
  constraint visit_problem_cases_resolution_check
    check (
      status <> 'resolved'
      or (
        member_response is not null
        and char_length(btrim(member_response)) >= 1
        and resolved_at is not null
      )
    )
);

comment on table public.visit_problem_cases is
  'Member-owned visit problem. One open case per challenge item. Original explanation is sealed. Admin review does not change the visit. Service role insert and select; review runs as the function owner. No reason column.';

create unique index visit_problem_cases_one_open_idx
  on public.visit_problem_cases (challenge_item_id)
  where status in ('submitted', 'under_review');

create index visit_problem_cases_item_created_idx
  on public.visit_problem_cases (challenge_item_id, created_at desc);

create index visit_problem_cases_user_id_idx
  on public.visit_problem_cases (user_id);

create index visit_problem_cases_redemption_id_idx
  on public.visit_problem_cases (redemption_id);

create index visit_problem_cases_status_created_idx
  on public.visit_problem_cases (status, created_at);

create or replace function public.set_visit_problem_cases_updated_at()
returns trigger
language plpgsql
set search_path to pg_catalog
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_visit_problem_cases_updated_at()
  from public, anon, authenticated, service_role;

create trigger set_visit_problem_cases_updated_at_trigger
  before update on public.visit_problem_cases
  for each row execute function public.set_visit_problem_cases_updated_at();

create or replace function public.visit_problem_cases_guard()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  owner_id uuid;
  item_status text;
  redemption_user uuid;
  redemption_item uuid;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.user_id is distinct from old.user_id
       or new.challenge_item_id is distinct from old.challenge_item_id
       or new.redemption_id is distinct from old.redemption_id
       or new.category is distinct from old.category
       or new.explanation is distinct from old.explanation
       or new.created_at is distinct from old.created_at then
      raise exception 'visit problem submission is sealed' using errcode = '23514';
    end if;
    if old.status = 'resolved'
       and (
         new.status is distinct from old.status
         or new.member_response is distinct from old.member_response
         or new.resolved_at is distinct from old.resolved_at
       ) then
      raise exception 'visit problem resolution is sealed' using errcode = '23514';
    end if;
    if new.status = 'submitted' and old.status is distinct from 'submitted' then
      raise exception 'visit problem cannot return to submitted' using errcode = '23514';
    end if;
    if new.status = 'resolved'
       and (
         new.member_response is null
         or char_length(btrim(new.member_response)) < 1
         or new.resolved_at is null
       ) then
      raise exception 'visit problem resolution needs an explanation' using errcode = '23514';
    end if;
    return new;
  end if;

  select c.user_id, i.status
    into owner_id, item_status
  from public.challenge_items i
  join public.challenge_cycles c on c.id = i.cycle_id
  where i.id = new.challenge_item_id;

  if owner_id is null or owner_id is distinct from new.user_id then
    raise exception 'visit problem owner mismatch' using errcode = '23514';
  end if;
  if item_status is null or item_status not in ('assigned', 'redeemed', 'expired') then
    raise exception 'visit problem item is not reportable' using errcode = '23514';
  end if;

  if new.redemption_id is not null then
    select r.user_id, r.challenge_item_id
      into redemption_user, redemption_item
    from public.redemptions r
    where r.id = new.redemption_id;
    if redemption_user is null
       or redemption_user is distinct from new.user_id
       or redemption_item is distinct from new.challenge_item_id then
      raise exception 'visit problem redemption mismatch' using errcode = '23514';
    end if;
  end if;

  if new.status is distinct from 'submitted'
     or new.member_response is not null
     or new.resolved_at is not null then
    raise exception 'visit problem starts submitted' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.visit_problem_cases_guard()
  from public, anon, authenticated, service_role;

comment on function public.visit_problem_cases_guard() is
  'Checks the owner, the visit, and a linked redemption. Does not read explanation text back to the caller.';

create trigger visit_problem_cases_guard
  before insert or update on public.visit_problem_cases
  for each row execute function public.visit_problem_cases_guard();

alter table public.visit_problem_cases enable row level security;

revoke all on table public.visit_problem_cases
  from public, anon, authenticated, service_role;

grant select, insert on table public.visit_problem_cases to service_role;

create or replace function public.review_visit_problem_case(
  p_case_id uuid,
  p_actor_user_id uuid,
  p_status text,
  p_member_response text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  actor_role text;
  current public.visit_problem_cases%rowtype;
  next_status text;
  next_response text;
  clean_reason text;
  action_name text;
begin
  select role into actor_role
  from public.user_profiles
  where id = p_actor_user_id;
  if actor_role is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  select * into current
  from public.visit_problem_cases
  where id = p_case_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if current.status = 'resolved' then
    return jsonb_build_object('ok', false, 'error', 'terminal');
  end if;

  clean_reason := btrim(coalesce(p_reason, ''));
  if char_length(clean_reason) < 1 or char_length(clean_reason) > 500 then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;

  next_status := p_status;
  if next_status not in ('submitted', 'under_review', 'resolved')
     or (next_status = 'submitted' and current.status is distinct from 'submitted') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  if p_member_response is null or btrim(p_member_response) = '' then
    next_response := current.member_response;
  else
    next_response := btrim(p_member_response);
    if char_length(next_response) < 1 or char_length(next_response) > 500 then
      return jsonb_build_object('ok', false, 'error', 'invalid_response');
    end if;
  end if;

  if next_status = 'resolved'
     and (next_response is null or char_length(btrim(next_response)) < 1) then
    return jsonb_build_object('ok', false, 'error', 'explanation_required');
  end if;

  if next_status = current.status and next_response is not distinct from current.member_response then
    return jsonb_build_object('ok', false, 'error', 'unchanged');
  end if;

  update public.visit_problem_cases
  set status = next_status,
      member_response = next_response,
      resolved_at = case
        when next_status = 'resolved' then pg_catalog.now()
        else current.resolved_at
      end
  where id = current.id;

  action_name := case
    when next_status = 'resolved' then 'visit_problem.resolve'
    else 'visit_problem.review'
  end;

  insert into public.admin_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_user_id,
    action_name,
    'visit_problem_case',
    current.id::text,
    jsonb_build_object(
      'reason', clean_reason,
      'from_status', current.status,
      'to_status', next_status
    )
  );

  return jsonb_build_object(
    'ok', true,
    'id', current.id,
    'status', next_status,
    'member_response', next_response
  );
end;
$$;

revoke all on function public.review_visit_problem_case(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.review_visit_problem_case(uuid, uuid, text, text, text)
  to service_role;

comment on function public.review_visit_problem_case(uuid, uuid, text, text, text) is
  'Admin review of one visit problem. Requires user_profiles.role = admin. Writes actor, time, and reason to admin_audit_log. Does not change the visit, quote, credit, or badge. The return value omits the reason.';
