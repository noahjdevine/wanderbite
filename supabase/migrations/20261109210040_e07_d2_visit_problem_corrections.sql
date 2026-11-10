-- E07-D2 audited corrections for an open visit-problem case.
-- NOT applied to hosted. Do not run supabase db push for this file in this PR.
-- Reads settlement columns from E07-C2. It does not update redemptions, quotes,
-- arrival sessions, capacity, credits, badges, or subscriptions.
-- It does not mint a boost session or move a quote expires_at.
-- Opening or resolving a case does not insert a correction.
-- This file does not set E07_VISIT_PROBLEMS_ENABLED.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.visit_problem_savings_adjustments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.visit_problem_cases (id) on delete restrict,
  user_id uuid not null references public.user_profiles (id) on delete restrict,
  redemption_id uuid not null unique references public.redemptions (id) on delete restrict,
  quote_id uuid references public.boost_quotes (id) on delete restrict,
  settlement_kind text,
  original_cents integer,
  corrected_cents integer not null,
  actor_user_id uuid not null references public.user_profiles (id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint visit_problem_savings_kind_check
    check (
      settlement_kind is null
      or settlement_kind in ('consume_quote', 'use_sealed_base')
    ),
  constraint visit_problem_savings_amount_check
    check (corrected_cents >= 0 and corrected_cents <= 10000000),
  constraint visit_problem_savings_original_check
    check (original_cents is null or original_cents >= 0),
  constraint visit_problem_savings_reason_check
    check (
      char_length(reason) between 1 and 500
      and reason = btrim(reason)
    ),
  constraint visit_problem_savings_link_check
    check (
      (
        settlement_kind is null
        and quote_id is null
        and original_cents is null
      )
      or (
        settlement_kind = 'use_sealed_base'
        and quote_id is null
      )
      or (
        settlement_kind = 'consume_quote'
        and quote_id is not null
        and original_cents is not null
      )
    )
);

comment on table public.visit_problem_savings_adjustments is
  'One append-only savings correction for an open visit problem. The redemption and its settlement stay as they were. Progress reads corrected_cents.';

create index visit_problem_savings_user_idx
  on public.visit_problem_savings_adjustments (user_id);

create table public.visit_problem_opportunities (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.visit_problem_cases (id) on delete restrict,
  user_id uuid not null references public.user_profiles (id) on delete restrict,
  challenge_item_id uuid not null references public.challenge_items (id) on delete restrict,
  redemption_id uuid references public.redemptions (id) on delete restrict,
  makeup_challenge_item_id uuid unique references public.challenge_items (id) on delete restrict,
  used_redemption_id uuid unique references public.redemptions (id) on delete restrict,
  used_at timestamptz,
  status text not null default 'available',
  actor_user_id uuid not null references public.user_profiles (id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint visit_problem_opportunities_status_check
    check (status in ('available', 'used')),
  constraint visit_problem_opportunities_use_check
    check (
      (
        status = 'available'
        and used_redemption_id is null
        and used_at is null
      )
      or (
        status = 'used'
        and used_redemption_id is not null
        and used_at is not null
        and makeup_challenge_item_id is not null
      )
    ),
  constraint visit_problem_opportunities_reason_check
    check (
      char_length(reason) between 1 and 500
      and reason = btrim(reason)
    )
);

comment on table public.visit_problem_opportunities is
  'One make-up visit granted from an open visit problem. The original visit stays recorded. available becomes used once the member redeems the make-up item through issue_challenge_redemption. Not a credit, a badge, or a boost session.';

create index visit_problem_opportunities_user_idx
  on public.visit_problem_opportunities (user_id);

create or replace function public.visit_problem_corrections_append_only()
returns trigger
language plpgsql
set search_path to pg_catalog
as $$
begin
  raise exception 'visit problem correction is append-only' using errcode = '23514';
end;
$$;

revoke all on function public.visit_problem_corrections_append_only()
  from public, anon, authenticated, service_role;

create trigger visit_problem_savings_append_only
  before update or delete on public.visit_problem_savings_adjustments
  for each row execute function public.visit_problem_corrections_append_only();

create or replace function public.visit_problem_opportunities_seal()
returns trigger
language plpgsql
set search_path to pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'visit problem opportunity is sealed' using errcode = '23514';
  end if;

  if new.id is distinct from old.id
     or new.case_id is distinct from old.case_id
     or new.user_id is distinct from old.user_id
     or new.challenge_item_id is distinct from old.challenge_item_id
     or new.redemption_id is distinct from old.redemption_id
     or new.actor_user_id is distinct from old.actor_user_id
     or new.reason is distinct from old.reason
     or new.created_at is distinct from old.created_at then
    raise exception 'visit problem opportunity is sealed' using errcode = '23514';
  end if;

  if old.makeup_challenge_item_id is not null
     and new.makeup_challenge_item_id is distinct from old.makeup_challenge_item_id then
    raise exception 'visit problem opportunity is sealed' using errcode = '23514';
  end if;

  if old.status = 'used' then
    if new.status is distinct from 'used'
       or new.used_redemption_id is distinct from old.used_redemption_id
       or new.used_at is distinct from old.used_at then
      raise exception 'visit problem opportunity is sealed' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = 'available' and new.status = 'available' then
    if new.used_redemption_id is not null or new.used_at is not null then
      raise exception 'visit problem opportunity is sealed' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = 'available'
     and new.status = 'used'
     and new.used_redemption_id is not null
     and new.used_at is not null
     and new.makeup_challenge_item_id is not null then
    return new;
  end if;

  raise exception 'visit problem opportunity is sealed' using errcode = '23514';
end;
$$;

revoke all on function public.visit_problem_opportunities_seal()
  from public, anon, authenticated, service_role;

create trigger visit_problem_opportunities_seal
  before update or delete on public.visit_problem_opportunities
  for each row execute function public.visit_problem_opportunities_seal();

create or replace function public.visit_problem_savings_adjustments_guard()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  case_row public.visit_problem_cases%rowtype;
  redemption public.redemptions%rowtype;
  actor_role text;
begin
  select * into case_row
  from public.visit_problem_cases
  where id = new.case_id;
  if not found
     or new.user_id is distinct from case_row.user_id
     or case_row.status not in ('submitted', 'under_review')
     or case_row.category not in ('wrong_discount', 'other')
     or (
       case_row.redemption_id is not null
       and new.redemption_id is distinct from case_row.redemption_id
     ) then
    raise exception 'visit problem savings case mismatch' using errcode = '23514';
  end if;

  select role into actor_role
  from public.user_profiles
  where id = new.actor_user_id;
  if actor_role is distinct from 'admin' then
    raise exception 'visit problem savings actor is not admin' using errcode = '23514';
  end if;

  if new.reason is null
     or char_length(new.reason) < 1
     or char_length(new.reason) > 500
     or new.reason is distinct from btrim(new.reason) then
    raise exception 'visit problem savings reason is invalid' using errcode = '23514';
  end if;

  select * into redemption
  from public.redemptions
  where id = new.redemption_id;
  if not found
     or redemption.user_id is distinct from case_row.user_id
     or redemption.challenge_item_id is distinct from case_row.challenge_item_id
     or redemption.status is distinct from 'verified'
     or redemption.verified_at is null
     or new.settlement_kind is distinct from redemption.settlement_kind
     or new.quote_id is distinct from redemption.quote_id then
    raise exception 'visit problem savings redemption mismatch' using errcode = '23514';
  end if;

  if redemption.settlement_kind = 'consume_quote'
     and new.original_cents is distinct from redemption.total_discount_cents then
    raise exception 'visit problem savings settlement mismatch' using errcode = '23514';
  end if;
  if redemption.settlement_kind = 'use_sealed_base'
     and new.original_cents is distinct from redemption.sealed_discount_amount_cents then
    raise exception 'visit problem savings settlement mismatch' using errcode = '23514';
  end if;
  if redemption.settlement_kind is null and new.original_cents is not null then
    raise exception 'visit problem savings settlement mismatch' using errcode = '23514';
  end if;

  if new.corrected_cents is null
     or new.corrected_cents < 0
     or new.corrected_cents > 10000000 then
    raise exception 'visit problem savings amount is invalid' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.visit_problem_savings_adjustments_guard()
  from public, anon, authenticated, service_role;

create trigger visit_problem_savings_adjustments_guard
  before insert on public.visit_problem_savings_adjustments
  for each row execute function public.visit_problem_savings_adjustments_guard();

create or replace function public.visit_problem_opportunities_guard()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  case_row public.visit_problem_cases%rowtype;
  actor_role text;
begin
  select * into case_row
  from public.visit_problem_cases
  where id = new.case_id;
  if not found
     or new.user_id is distinct from case_row.user_id
     or new.challenge_item_id is distinct from case_row.challenge_item_id
     or new.redemption_id is distinct from case_row.redemption_id
     or new.makeup_challenge_item_id is not null
     or new.used_redemption_id is not null
     or new.used_at is not null
     or new.status is distinct from 'available'
     or case_row.status not in ('submitted', 'under_review')
     or case_row.category not in ('offer_refused', 'check_in_code', 'other') then
    raise exception 'visit problem opportunity case mismatch' using errcode = '23514';
  end if;

  select role into actor_role
  from public.user_profiles
  where id = new.actor_user_id;
  if actor_role is distinct from 'admin' then
    raise exception 'visit problem opportunity actor is not admin' using errcode = '23514';
  end if;

  if new.reason is null
     or char_length(new.reason) < 1
     or char_length(new.reason) > 500
     or new.reason is distinct from btrim(new.reason) then
    raise exception 'visit problem opportunity reason is invalid' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.visit_problem_opportunities_guard()
  from public, anon, authenticated, service_role;

create trigger visit_problem_opportunities_guard
  before insert on public.visit_problem_opportunities
  for each row execute function public.visit_problem_opportunities_guard();

alter table public.visit_problem_savings_adjustments enable row level security;
alter table public.visit_problem_opportunities enable row level security;

revoke all on table public.visit_problem_savings_adjustments
  from public, anon, authenticated, service_role;
revoke all on table public.visit_problem_opportunities
  from public, anon, authenticated, service_role;

grant select on table public.visit_problem_savings_adjustments to service_role;
grant select on table public.visit_problem_opportunities to service_role;

create or replace function public.correct_visit_problem_savings(
  p_case_id uuid,
  p_actor_user_id uuid,
  p_corrected_cents integer,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  actor_role text;
  current public.visit_problem_cases%rowtype;
  existing public.visit_problem_savings_adjustments%rowtype;
  redemption public.redemptions%rowtype;
  clean_reason text;
  original_cents integer;
  inserted_id uuid;
begin
  select role into actor_role
  from public.user_profiles
  where id = p_actor_user_id;
  if actor_role is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  clean_reason := btrim(coalesce(p_reason, ''));
  if char_length(clean_reason) < 1 or char_length(clean_reason) > 500 then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;

  if p_corrected_cents is null
     or p_corrected_cents < 0
     or p_corrected_cents > 10000000 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select * into current
  from public.visit_problem_cases
  where id = p_case_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if current.status is distinct from 'submitted'
     and current.status is distinct from 'under_review' then
    return jsonb_build_object('ok', false, 'error', 'terminal');
  end if;
  if current.category is distinct from 'wrong_discount'
     and current.category is distinct from 'other' then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  select * into existing
  from public.visit_problem_savings_adjustments
  where case_id = current.id;
  if found then
    if existing.corrected_cents = p_corrected_cents then
      return jsonb_build_object(
        'ok', true,
        'already_applied', true,
        'adjustment_id', existing.id,
        'redemption_id', existing.redemption_id,
        'corrected_cents', existing.corrected_cents
      );
    end if;
    return jsonb_build_object('ok', false, 'error', 'already_applied');
  end if;

  if current.redemption_id is not null then
    select * into redemption
    from public.redemptions
    where id = current.redemption_id
    for update;
    if not found
       or redemption.user_id is distinct from current.user_id
       or redemption.challenge_item_id is distinct from current.challenge_item_id then
      return jsonb_build_object('ok', false, 'error', 'no_redemption');
    end if;
    if redemption.status is distinct from 'verified' or redemption.verified_at is null then
      return jsonb_build_object('ok', false, 'error', 'not_verified');
    end if;
  else
    select * into redemption
    from public.redemptions
    where user_id = current.user_id
      and challenge_item_id = current.challenge_item_id
      and status = 'verified'
      and verified_at is not null
    order by verified_at desc, id desc
    limit 1
    for update;
    if not found then
      if exists (
        select 1
        from public.redemptions
        where user_id = current.user_id
          and challenge_item_id = current.challenge_item_id
      ) then
        return jsonb_build_object('ok', false, 'error', 'not_verified');
      end if;
      return jsonb_build_object('ok', false, 'error', 'no_redemption');
    end if;
  end if;

  if exists (
    select 1
    from public.visit_problem_savings_adjustments
    where redemption_id = redemption.id
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_applied');
  end if;

  original_cents := case redemption.settlement_kind
    when 'consume_quote' then redemption.total_discount_cents
    when 'use_sealed_base' then redemption.sealed_discount_amount_cents
    else null
  end;

  insert into public.visit_problem_savings_adjustments (
    case_id,
    user_id,
    redemption_id,
    quote_id,
    settlement_kind,
    original_cents,
    corrected_cents,
    actor_user_id,
    reason
  ) values (
    current.id,
    current.user_id,
    redemption.id,
    redemption.quote_id,
    redemption.settlement_kind,
    original_cents,
    p_corrected_cents,
    p_actor_user_id,
    clean_reason
  )
  returning id into inserted_id;

  insert into public.admin_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_user_id,
    'visit_problem.correct_savings',
    'visit_problem_case',
    current.id::text,
    jsonb_build_object(
      'reason', clean_reason,
      'redemption_id', redemption.id,
      'quote_id', redemption.quote_id,
      'original_cents', original_cents,
      'corrected_cents', p_corrected_cents
    )
  );

  return jsonb_build_object(
    'ok', true,
    'already_applied', false,
    'adjustment_id', inserted_id,
    'redemption_id', redemption.id,
    'corrected_cents', p_corrected_cents
  );
end;
$$;

revoke all on function public.correct_visit_problem_savings(uuid, uuid, integer, text)
  from public, anon, authenticated, service_role;

grant execute on function public.correct_visit_problem_savings(uuid, uuid, integer, text)
  to service_role;

comment on function public.correct_visit_problem_savings(uuid, uuid, integer, text) is
  'Admin savings correction for one open visit problem. Requires user_profiles.role = admin. Appends one adjustment and one visit_problem.correct_savings audit row. Does not change the redemption or settlement. A repeat of the same cents returns the existing row.';

create or replace function public.restore_visit_problem_opportunity(
  p_case_id uuid,
  p_actor_user_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  actor_role text;
  current public.visit_problem_cases%rowtype;
  existing public.visit_problem_opportunities%rowtype;
  clean_reason text;
  inserted_id uuid;
begin
  select role into actor_role
  from public.user_profiles
  where id = p_actor_user_id;
  if actor_role is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  clean_reason := btrim(coalesce(p_reason, ''));
  if char_length(clean_reason) < 1 or char_length(clean_reason) > 500 then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;

  select * into current
  from public.visit_problem_cases
  where id = p_case_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if current.status is distinct from 'submitted'
     and current.status is distinct from 'under_review' then
    return jsonb_build_object('ok', false, 'error', 'terminal');
  end if;
  if current.category is distinct from 'offer_refused'
     and current.category is distinct from 'check_in_code'
     and current.category is distinct from 'other' then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  select * into existing
  from public.visit_problem_opportunities
  where case_id = current.id;
  if found then
    return jsonb_build_object(
      'ok', true,
      'already_applied', true,
      'opportunity_id', existing.id
    );
  end if;

  insert into public.visit_problem_opportunities (
    case_id,
    user_id,
    challenge_item_id,
    redemption_id,
    actor_user_id,
    reason
  ) values (
    current.id,
    current.user_id,
    current.challenge_item_id,
    current.redemption_id,
    p_actor_user_id,
    clean_reason
  )
  returning id into inserted_id;

  insert into public.admin_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_user_id,
    'visit_problem.restore_opportunity',
    'visit_problem_case',
    current.id::text,
    jsonb_build_object(
      'reason', clean_reason,
      'opportunity_id', inserted_id,
      'challenge_item_id', current.challenge_item_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'already_applied', false,
    'opportunity_id', inserted_id
  );
end;
$$;

revoke all on function public.restore_visit_problem_opportunity(uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.restore_visit_problem_opportunity(uuid, uuid, text)
  to service_role;

comment on function public.restore_visit_problem_opportunity(uuid, uuid, text) is
  'Admin make-up challenge for one open visit problem. Requires user_profiles.role = admin. Inserts one available opportunity and one visit_problem.restore_opportunity audit row. Does not change the original visit, capacity, credit, badge, or boost session. A repeat returns the existing opportunity. Granting stays blocked after the case is resolved.';

create or replace function public.open_visit_problem_makeup_item(
  p_opportunity_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  current public.visit_problem_opportunities%rowtype;
  source public.challenge_items%rowtype;
  restaurant_status text;
  version public.offer_versions%rowtype;
  free_month date;
  cycle_id uuid;
  item_id uuid;
begin
  if p_opportunity_id is null or p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into current
  from public.visit_problem_opportunities
  where id = p_opportunity_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if current.user_id is distinct from p_user_id then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if current.status = 'used' then
    return jsonb_build_object(
      'ok', false,
      'error', 'already_used',
      'makeup_challenge_item_id', current.makeup_challenge_item_id,
      'used_redemption_id', current.used_redemption_id
    );
  end if;
  if current.makeup_challenge_item_id is not null then
    return jsonb_build_object(
      'ok', true,
      'already_prepared', true,
      'makeup_challenge_item_id', current.makeup_challenge_item_id
    );
  end if;

  select * into source
  from public.challenge_items
  where id = current.challenge_item_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_bookable', 'detail', 'offer');
  end if;

  select r.status into restaurant_status
  from public.restaurants r
  where r.id = source.restaurant_id;
  if restaurant_status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'error', 'not_bookable', 'detail', 'restaurant');
  end if;

  if source.offer_version_id is not null then
    select * into version
    from public.offer_versions
    where id = source.offer_version_id;
    if not found
       or version.withdrawn_from_selection_at is not null
       or version.valid_from > pg_catalog.now()
       or version.valid_until <= pg_catalog.now() then
      return jsonb_build_object('ok', false, 'error', 'not_bookable', 'detail', 'offer');
    end if;
  end if;

  if source.redemption_deadline is not null
     and source.redemption_deadline <= pg_catalog.now() then
    return jsonb_build_object('ok', false, 'error', 'not_bookable', 'detail', 'window');
  end if;

  free_month := date '1800-01-01';
  while exists (
    select 1
    from public.challenge_cycles as existing_cycle
    where existing_cycle.user_id = current.user_id
      and existing_cycle.cycle_month = free_month
  ) loop
    free_month := free_month + 1;
    if free_month >= date '1900-01-01' then
      return jsonb_build_object('ok', false, 'error', 'unavailable');
    end if;
  end loop;

  insert into public.challenge_cycles (user_id, cycle_month, status, swap_count_used)
  values (current.user_id, free_month, 'active', 0)
  returning id into cycle_id;

  insert into public.challenge_items (
    cycle_id,
    restaurant_id,
    slot_number,
    status,
    offer_version_id,
    assigned_at,
    redemption_deadline
  ) values (
    cycle_id,
    source.restaurant_id,
    1,
    'assigned',
    source.offer_version_id,
    source.assigned_at,
    source.redemption_deadline
  )
  returning id into item_id;

  update public.visit_problem_opportunities
  set makeup_challenge_item_id = item_id
  where id = current.id
    and status = 'available'
    and makeup_challenge_item_id is null;

  return jsonb_build_object(
    'ok', true,
    'already_prepared', false,
    'makeup_challenge_item_id', item_id
  );
end;
$$;

revoke all on function public.open_visit_problem_makeup_item(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.open_visit_problem_makeup_item(uuid, uuid)
  to service_role;

comment on function public.open_visit_problem_makeup_item(uuid, uuid) is
  'Prepares one assigned challenge item for a make-up visit at the original restaurant and offer. Copies the original redemption deadline. Does not reserve capacity, issue a credit, or write a quote or boost session. The member then uses issue_challenge_redemption.';

create or replace function public.use_visit_problem_opportunity(
  p_opportunity_id uuid,
  p_user_id uuid,
  p_redemption_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  current public.visit_problem_opportunities%rowtype;
  source public.challenge_items%rowtype;
  makeup public.challenge_items%rowtype;
  redemption public.redemptions%rowtype;
begin
  if p_opportunity_id is null or p_user_id is null or p_redemption_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into current
  from public.visit_problem_opportunities
  where id = p_opportunity_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if current.user_id is distinct from p_user_id then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if current.status = 'used' then
    if current.used_redemption_id = p_redemption_id then
      return jsonb_build_object(
        'ok', true,
        'already_applied', true,
        'used_redemption_id', current.used_redemption_id
      );
    end if;
    return jsonb_build_object('ok', false, 'error', 'already_used');
  end if;

  if current.makeup_challenge_item_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_ready');
  end if;

  select * into source
  from public.challenge_items
  where id = current.challenge_item_id;
  select * into makeup
  from public.challenge_items
  where id = current.makeup_challenge_item_id;
  select * into redemption
  from public.redemptions
  where id = p_redemption_id;

  if source.id is null
     or makeup.id is null
     or redemption.id is null
     or redemption.user_id is distinct from current.user_id
     or redemption.challenge_item_id is distinct from makeup.id
     or redemption.restaurant_id is distinct from source.restaurant_id
     or makeup.restaurant_id is distinct from source.restaurant_id
     or makeup.offer_version_id is distinct from source.offer_version_id
     or makeup.redemption_deadline is distinct from source.redemption_deadline
     or makeup.credit_id is not null
     or makeup.status is distinct from 'redeemed'
     or redemption.status not in ('issued', 'verified') then
    return jsonb_build_object('ok', false, 'error', 'invalid_redemption');
  end if;

  update public.visit_problem_opportunities
  set status = 'used',
      used_redemption_id = redemption.id,
      used_at = pg_catalog.now()
  where id = current.id
    and status = 'available';

  insert into public.admin_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_user_id,
    'visit_problem.make_up_used',
    'visit_problem_case',
    current.case_id::text,
    jsonb_build_object(
      'opportunity_id', current.id,
      'redemption_id', redemption.id,
      'makeup_challenge_item_id', makeup.id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'already_applied', false,
    'used_redemption_id', redemption.id
  );
end;
$$;

revoke all on function public.use_visit_problem_opportunity(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.use_visit_problem_opportunity(uuid, uuid, uuid)
  to service_role;

comment on function public.use_visit_problem_opportunity(uuid, uuid, uuid) is
  'Marks one make-up opportunity used after issue_challenge_redemption. The member must own the spot. A repeat of the same redemption is idempotent. A second redemption is refused. Use still works after the case is resolved. Does not change the redemption clock, the original visit, capacity, credits, badges, quotes, or boost sessions.';
