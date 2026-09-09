-- OPS-02 / G10: transactional generate, swap, and redemption issue.
-- Do not rewrite historical migrations. Rollback is drop these indexes,
-- constraints, and functions; never restore multi-step client writes.
-- Let the migration runner own the transaction. Direct psql replay must use -1 -f.
-- SET LOCAL timeouts apply to this migration only; they are not RPC settings.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  duplicate_current_slots integer;
  duplicate_current_restaurants integer;
  duplicate_swapped_from integer;
  duplicate_challenge_items integer;
  duplicate_token_hashes integer;
  bad_swap_counts integer;
  malformed_successors integer;
begin
  select count(*) into duplicate_current_slots
  from (
    select cycle_id, slot_number
    from public.challenge_items
    where status in ('assigned', 'redeemed')
    group by cycle_id, slot_number
    having count(*) > 1
  ) d;

  select count(*) into duplicate_current_restaurants
  from (
    select cycle_id, restaurant_id
    from public.challenge_items
    where status in ('assigned', 'redeemed')
    group by cycle_id, restaurant_id
    having count(*) > 1
  ) d;

  select count(*) into duplicate_swapped_from
  from (
    select swapped_from_item_id
    from public.challenge_items
    where swapped_from_item_id is not null
    group by swapped_from_item_id
    having count(*) > 1
  ) d;

  select count(*) into duplicate_challenge_items
  from (
    select challenge_item_id
    from public.redemptions
    where challenge_item_id is not null
    group by challenge_item_id
    having count(*) > 1
  ) d;

  select count(*) into duplicate_token_hashes
  from (
    select token_hash
    from public.redemptions
    where token_hash is not null
    group by token_hash
    having count(*) > 1
  ) d;

  select count(*) into bad_swap_counts
  from public.challenge_cycles
  where swap_count_used is null
     or swap_count_used < 0
     or swap_count_used > 1;

  select count(*) into malformed_successors
  from public.challenge_items successor
  left join public.challenge_items source
    on source.id = successor.swapped_from_item_id
  where successor.swapped_from_item_id is not null
    and (
      source.id is null
      or successor.cycle_id is distinct from source.cycle_id
      or successor.slot_number is distinct from source.slot_number
      or (
        successor.status in ('assigned', 'redeemed')
        and source.status is distinct from 'swapped_out'
      )
    );

  if duplicate_current_slots > 0
     or duplicate_current_restaurants > 0
     or duplicate_swapped_from > 0
     or duplicate_challenge_items > 0
     or duplicate_token_hashes > 0
     or bad_swap_counts > 0
     or malformed_successors > 0
  then
    raise exception
      'OPS-02/M7 preflight failed: duplicate_current_slots=%, duplicate_current_restaurants=%, duplicate_swapped_from=%, duplicate_challenge_item_id=%, duplicate_token_hash=%, bad_swap_counts=%, malformed_successors=%',
      duplicate_current_slots,
      duplicate_current_restaurants,
      duplicate_swapped_from,
      duplicate_challenge_items,
      duplicate_token_hashes,
      bad_swap_counts,
      malformed_successors;
  end if;
end $$;

alter table public.challenge_cycles
  alter column swap_count_used set default 0,
  alter column swap_count_used set not null;

alter table public.challenge_cycles
  drop constraint if exists challenge_cycles_swap_count_used_check;

alter table public.challenge_cycles
  add constraint challenge_cycles_swap_count_used_check
  check (swap_count_used >= 0 and swap_count_used <= 1);

create unique index challenge_items_current_slot_uidx
  on public.challenge_items (cycle_id, slot_number)
  where status in ('assigned', 'redeemed');

create unique index challenge_items_current_restaurant_uidx
  on public.challenge_items (cycle_id, restaurant_id)
  where status in ('assigned', 'redeemed');

create unique index challenge_items_swapped_from_uidx
  on public.challenge_items (swapped_from_item_id)
  where swapped_from_item_id is not null;

alter table public.redemptions
  add constraint redemptions_challenge_item_id_key unique (challenge_item_id);

alter table public.redemptions
  add constraint redemptions_token_hash_key unique (token_hash);

drop index if exists public.idx_redemptions_token_hash;

create or replace function public.generate_challenge_cycle(
  p_user_id uuid,
  p_cycle_month date,
  p_market_id uuid,
  p_restaurant_ids uuid[]
)
returns table (outcome text, cycle_id uuid)
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
declare
  profile_status text;
  inserted_cycle_id uuid;
  existing_cycle_id uuid;
  n integer;
  rest_id uuid;
  rest_status text;
  rest_market uuid;
  offer_id uuid;
begin
  if p_user_id is null then
    return query select 'inactive_subscription'::text, null::uuid;
    return;
  end if;

  select up.subscription_status
    into profile_status
  from public.user_profiles as up
  where up.id = p_user_id
  for update;

  get diagnostics n = row_count;
  if n is distinct from 1 or profile_status is distinct from 'active' then
    return query select 'inactive_subscription'::text, null::uuid;
    return;
  end if;

  if p_cycle_month is null
     or p_market_id is null
     or p_restaurant_ids is null
     or cardinality(p_restaurant_ids) is distinct from 2
     or exists (
       select 1 from unnest(p_restaurant_ids) as u(rid) where u.rid is null
     )
     or (
       select count(distinct u.rid) from unnest(p_restaurant_ids) as u(rid)
     ) is distinct from 2
  then
    return query select 'invalid_restaurants'::text, null::uuid;
    return;
  end if;

  for rest_id in
    select u.rid
    from unnest(p_restaurant_ids) with ordinality as u(rid, ord)
    order by u.ord
  loop
    select r.status, r.market_id
      into rest_status, rest_market
    from public.restaurants as r
    where r.id = rest_id
    for share;

    get diagnostics n = row_count;
    if n is distinct from 1
       or rest_status is distinct from 'active'
       or rest_market is distinct from p_market_id
    then
      return query select 'invalid_restaurants'::text, null::uuid;
      return;
    end if;

    select o.id
      into offer_id
    from public.restaurant_offers as o
    where o.restaurant_id = rest_id
      and o.active = true
    limit 1
    for share;

    get diagnostics n = row_count;
    if n is distinct from 1 then
      return query select 'invalid_restaurants'::text, null::uuid;
      return;
    end if;
  end loop;

  insert into public.challenge_cycles (user_id, cycle_month, status, swap_count_used)
  values (p_user_id, p_cycle_month, 'active', 0)
  on conflict (user_id, cycle_month) do nothing
  returning public.challenge_cycles.id into inserted_cycle_id;

  if inserted_cycle_id is not null then
    insert into public.challenge_items (cycle_id, restaurant_id, slot_number, status)
    select inserted_cycle_id, u.rid, u.ord::integer, 'assigned'
    from unnest(p_restaurant_ids) with ordinality as u(rid, ord);

    get diagnostics n = row_count;
    if n is distinct from 2 then
      raise exception 'OPS-02: generate item insert expected 2 rows, got %', n;
    end if;

    return query select 'created'::text, inserted_cycle_id;
    return;
  end if;

  select cc.id
    into existing_cycle_id
  from public.challenge_cycles as cc
  where cc.user_id = p_user_id
    and cc.cycle_month = p_cycle_month
  for update;

  get diagnostics n = row_count;
  if n is distinct from 1 then
    raise exception 'OPS-02: generate conflict did not find the existing cycle';
  end if;

  if (
    select count(*) = 2
       and count(*) filter (where ci.slot_number = 1) = 1
       and count(*) filter (where ci.slot_number = 2) = 1
       and count(distinct ci.restaurant_id) = 2
    from public.challenge_items as ci
    where ci.cycle_id = existing_cycle_id
      and ci.status in ('assigned', 'redeemed')
  ) then
    return query select 'existing'::text, existing_cycle_id;
    return;
  end if;

  return query select 'incomplete_cycle'::text, existing_cycle_id;
end;
$$;

create or replace function public.swap_challenge_item(
  p_user_id uuid,
  p_item_id uuid,
  p_replacement_restaurant_id uuid
)
returns table (
  outcome text,
  source_item_id uuid,
  replacement_item_id uuid,
  restaurant_id uuid
)
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
declare
  n integer;
  source public.challenge_items%rowtype;
  cycle public.challenge_cycles%rowtype;
  successor public.challenge_items%rowtype;
  source_market uuid;
  replacement_status text;
  replacement_market uuid;
  offer_id uuid;
  updated_item_id uuid;
  new_item_id uuid;
  current_conflict uuid;
begin
  if p_user_id is null or p_item_id is null then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  select ci.*
    into source
  from public.challenge_items as ci
  where ci.id = p_item_id;

  get diagnostics n = row_count;
  if n is distinct from 1 then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  select cc.*
    into cycle
  from public.challenge_cycles as cc
  where cc.id = source.cycle_id
  for update;

  get diagnostics n = row_count;
  if n is distinct from 1 then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  if cycle.user_id is distinct from p_user_id then
    return query select 'forbidden'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  select ci.*
    into source
  from public.challenge_items as ci
  where ci.id = p_item_id
  for update;

  get diagnostics n = row_count;
  if n is distinct from 1 then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  successor := null;
  begin
    select ci.*
      into strict successor
    from public.challenge_items as ci
    where ci.swapped_from_item_id = p_item_id;
  exception
    when no_data_found then
      successor := null;
    when too_many_rows then
      return query select 'malformed_lineage'::text, p_item_id, null::uuid, null::uuid;
      return;
  end;

  if source.status = 'swapped_out' or successor is not null then
    if successor is null
       or successor.swapped_from_item_id is distinct from p_item_id
       or successor.cycle_id is distinct from cycle.id
       or successor.slot_number is distinct from source.slot_number
       or successor.status not in ('assigned', 'redeemed')
       or source.status is distinct from 'swapped_out'
    then
      return query select 'malformed_lineage'::text, p_item_id, null::uuid, null::uuid;
      return;
    end if;

    return query select
      'existing'::text,
      p_item_id,
      successor.id,
      successor.restaurant_id;
    return;
  end if;

  if cycle.swap_count_used >= 1 then
    return query select 'swap_exhausted'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  if source.status is distinct from 'assigned' then
    return query select 'not_found'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  if p_replacement_restaurant_id is null
     or p_replacement_restaurant_id is not distinct from source.restaurant_id
  then
    return query select 'invalid_restaurants'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  select ci.id
    into current_conflict
  from public.challenge_items as ci
  where ci.cycle_id = cycle.id
    and ci.restaurant_id = p_replacement_restaurant_id
    and ci.status in ('assigned', 'redeemed')
  limit 1;

  if current_conflict is not null then
    return query select 'invalid_restaurants'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  select r.market_id
    into source_market
  from public.restaurants as r
  where r.id = source.restaurant_id;

  select r.status, r.market_id
    into replacement_status, replacement_market
  from public.restaurants as r
  where r.id = p_replacement_restaurant_id
  for share;

  get diagnostics n = row_count;
  if n is distinct from 1
     or replacement_status is distinct from 'active'
     or replacement_market is null
     or replacement_market is distinct from source_market
  then
    return query select 'invalid_restaurants'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  select o.id
    into offer_id
  from public.restaurant_offers as o
  where o.restaurant_id = p_replacement_restaurant_id
    and o.active = true
  limit 1
  for share;

  get diagnostics n = row_count;
  if n is distinct from 1 then
    return query select 'invalid_restaurants'::text, p_item_id, null::uuid, null::uuid;
    return;
  end if;

  update public.challenge_items as ci
  set status = 'swapped_out'
  where ci.id = p_item_id
    and ci.status = 'assigned'
  returning ci.id into updated_item_id;

  get diagnostics n = row_count;
  if n is distinct from 1 then
    raise exception 'OPS-02: swap source update expected 1 row, got %', n;
  end if;

  insert into public.challenge_items (
    cycle_id,
    restaurant_id,
    slot_number,
    status,
    swapped_from_item_id
  ) values (
    cycle.id,
    p_replacement_restaurant_id,
    source.slot_number,
    'assigned',
    p_item_id
  )
  returning public.challenge_items.id into new_item_id;

  get diagnostics n = row_count;
  if n is distinct from 1 then
    raise exception 'OPS-02: swap replacement insert expected 1 row, got %', n;
  end if;

  update public.challenge_cycles as cc
  set swap_count_used = cc.swap_count_used + 1
  where cc.id = cycle.id
    and cc.swap_count_used = 0
    and cc.user_id = p_user_id;

  get diagnostics n = row_count;
  if n is distinct from 1 then
    raise exception 'OPS-02: swap count update expected 1 row, got %', n;
  end if;

  return query select
    'created'::text,
    p_item_id,
    new_item_id,
    p_replacement_restaurant_id;
end;
$$;

create or replace function public.issue_challenge_redemption(
  p_user_id uuid,
  p_item_id uuid,
  p_token_hash text,
  p_encrypted_code text,
  p_code_iv text,
  p_expires_at timestamptz
)
returns table (
  outcome text,
  redemption_id uuid,
  challenge_item_id uuid,
  encrypted_code text,
  code_iv text,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path to pg_catalog, public
as $$
declare
  n integer;
  source public.challenge_items%rowtype;
  cycle public.challenge_cycles%rowtype;
  issued public.redemptions%rowtype;
  constraint_name text;
begin
  if p_user_id is null or p_item_id is null then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  select ci.*
    into source
  from public.challenge_items as ci
  where ci.id = p_item_id;

  get diagnostics n = row_count;
  if n is distinct from 1 then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  select cc.*
    into cycle
  from public.challenge_cycles as cc
  where cc.id = source.cycle_id
  for update;

  get diagnostics n = row_count;
  if n is distinct from 1 then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  if cycle.user_id is distinct from p_user_id then
    return query select 'forbidden'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  select ci.*
    into source
  from public.challenge_items as ci
  where ci.id = p_item_id
  for update;

  get diagnostics n = row_count;
  if n is distinct from 1 then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  if source.status = 'redeemed' then
    select rd.*
      into issued
    from public.redemptions as rd
    where rd.challenge_item_id = p_item_id;

    get diagnostics n = row_count;
    if n is distinct from 1
       or issued.encrypted_code is null
       or issued.code_iv is null
    then
      return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
      return;
    end if;

    return query select
      'existing'::text,
      issued.id,
      issued.challenge_item_id,
      issued.encrypted_code,
      issued.code_iv,
      issued.created_at;
    return;
  end if;

  if source.status is distinct from 'assigned' then
    return query select 'not_assigned'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  if p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_encrypted_code is null
     or length(p_encrypted_code) = 0
     or p_code_iv is null
     or length(p_code_iv) = 0
     or p_expires_at is null
     or p_expires_at <= now()
  then
    raise exception 'OPS-02: invalid redemption token payload';
  end if;

  begin
    insert into public.redemptions (
      user_id,
      restaurant_id,
      challenge_item_id,
      token_hash,
      encrypted_code,
      code_iv,
      status,
      expires_at
    ) values (
      p_user_id,
      source.restaurant_id,
      p_item_id,
      p_token_hash,
      p_encrypted_code,
      p_code_iv,
      'issued',
      p_expires_at
    )
    returning * into issued;

    get diagnostics n = row_count;
    if n is distinct from 1 then
      raise exception 'OPS-02: redemption insert expected 1 row, got %', n;
    end if;
  exception
    when unique_violation then
      get stacked diagnostics constraint_name = constraint_name;
      if constraint_name = 'redemptions_token_hash_key' then
        return query select 'token_collision'::text, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
        return;
      elsif constraint_name = 'redemptions_challenge_item_id_key' then
        select rd.*
          into issued
        from public.redemptions as rd
        where rd.challenge_item_id = p_item_id;

        get diagnostics n = row_count;
        if n is distinct from 1 then
          raise;
        end if;

        update public.challenge_items as ci
        set status = 'redeemed'
        where ci.id = p_item_id
          and ci.status = 'assigned';

        get diagnostics n = row_count;
        if n not in (0, 1) then
          raise exception 'OPS-02: redemption item repair update expected 0 or 1 row, got %', n;
        end if;

        return query select
          'existing'::text,
          issued.id,
          issued.challenge_item_id,
          issued.encrypted_code,
          issued.code_iv,
          issued.created_at;
        return;
      else
        raise;
      end if;
  end;

  update public.challenge_items as ci
  set status = 'redeemed'
  where ci.id = p_item_id
    and ci.status = 'assigned'
  returning ci.id into source.id;

  get diagnostics n = row_count;
  if n is distinct from 1 then
    raise exception 'OPS-02: redemption item update expected 1 row, got %', n;
  end if;

  return query select
    'created'::text,
    issued.id,
    issued.challenge_item_id,
    issued.encrypted_code,
    issued.code_iv,
    issued.created_at;
end;
$$;

comment on function public.generate_challenge_cycle(uuid, date, uuid, uuid[]) is
  'Insert one monthly cycle and two current items, or return the existing complete cycle.';

comment on function public.swap_challenge_item(uuid, uuid, uuid) is
  'Swap one assigned item inside a locked cycle. Idempotent for a valid successor lineage.';

comment on function public.issue_challenge_redemption(uuid, uuid, text, text, text, timestamptz) is
  'Issue one redemption per challenge item. token_hash collisions are distinct from already-applied issues.';

revoke all on function public.generate_challenge_cycle(uuid, date, uuid, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.swap_challenge_item(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.issue_challenge_redemption(uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function public.generate_challenge_cycle(uuid, date, uuid, uuid[])
  to service_role;
grant execute on function public.swap_challenge_item(uuid, uuid, uuid)
  to service_role;
grant execute on function public.issue_challenge_redemption(uuid, uuid, text, text, text, timestamptz)
  to service_role;
