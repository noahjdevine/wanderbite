-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '15s';

do $$
declare
  proc oid;
begin
  foreach proc in array array[
    'public.generate_challenge_cycle(uuid, date, uuid, uuid[])'::regprocedure,
    'public.swap_challenge_item(uuid, uuid, uuid)'::regprocedure,
    'public.issue_challenge_redemption(uuid, uuid, text, text, text, timestamptz)'::regprocedure
  ]
  loop
    if has_function_privilege('anon', proc, 'EXECUTE')
      or has_function_privilege('authenticated', proc, 'EXECUTE')
      or not has_function_privilege('service_role', proc, 'EXECUTE')
    then
      raise exception 'FAIL: G10 RPC grants for %', proc;
    end if;

    if exists (
      select 1
      from aclexplode(coalesce(
        (select p.proacl from pg_proc p where p.oid = proc),
        acldefault('f', (select p.proowner from pg_proc p where p.oid = proc))
      )) as acl
      where acl.privilege_type = 'EXECUTE'
        and (acl.grantee = 0
          or acl.grantee in ('anon'::regrole, 'authenticated'::regrole))
    ) then
      raise exception 'FAIL: PUBLIC/anon/authenticated EXECUTE remains on %', proc;
    end if;
  end loop;

  if exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'idx_redemptions_token_hash'
  ) then
    raise exception 'FAIL: non-unique idx_redemptions_token_hash still exists';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.redemptions'::regclass
      and conname = 'redemptions_token_hash_key'
  ) then
    raise exception 'FAIL: unique token_hash constraint missing';
  end if;
end $$;

insert into auth.users (id) values
  ('a1000000-0000-4000-8000-000000000001'),
  ('a1000000-0000-4000-8000-000000000002');
insert into public.user_profiles (id, subscription_status, is_admin) values
  ('a1000000-0000-4000-8000-000000000001', 'active', false),
  ('a1000000-0000-4000-8000-000000000002', 'inactive', false);
insert into public.markets (id, name, slug)
  values ('a1000000-0000-4000-8000-000000000010', 'G10 Market', 'g10-market');
insert into public.restaurants (id, name, status, market_id) values
  ('a1000000-0000-4000-8000-000000000021', 'G10 One', 'active', 'a1000000-0000-4000-8000-000000000010'),
  ('a1000000-0000-4000-8000-000000000022', 'G10 Two', 'active', 'a1000000-0000-4000-8000-000000000010'),
  ('a1000000-0000-4000-8000-000000000023', 'G10 Three', 'active', 'a1000000-0000-4000-8000-000000000010'),
  ('a1000000-0000-4000-8000-000000000024', 'G10 Other Market', 'active', null);
insert into public.restaurant_offers (restaurant_id, active) values
  ('a1000000-0000-4000-8000-000000000021', true),
  ('a1000000-0000-4000-8000-000000000022', true),
  ('a1000000-0000-4000-8000-000000000023', true);

do $$
declare
  gen record;
  swapped record;
  issued record;
  v_cycle uuid;
  v_item1 uuid;
  v_item2 uuid;
  v_successor uuid;
  v_n integer;
  v_malformed uuid;
begin
  select * into gen
  from public.generate_challenge_cycle(
    null,
    '2026-09-01',
    'a1000000-0000-4000-8000-000000000010',
    array['a1000000-0000-4000-8000-000000000021'::uuid, 'a1000000-0000-4000-8000-000000000022'::uuid]
  );
  if gen.outcome is distinct from 'inactive_subscription' then
    raise exception 'FAIL: null user generated a cycle';
  end if;

  select * into gen
  from public.generate_challenge_cycle(
    'a1000000-0000-4000-8000-000000000002',
    '2026-09-01',
    'a1000000-0000-4000-8000-000000000010',
    array['a1000000-0000-4000-8000-000000000021'::uuid, 'a1000000-0000-4000-8000-000000000022'::uuid]
  );
  if gen.outcome is distinct from 'inactive_subscription' then
    raise exception 'FAIL: inactive user generated a cycle';
  end if;

  select * into gen
  from public.generate_challenge_cycle(
    'a1000000-0000-4000-8000-000000000001',
    '2026-09-01',
    'a1000000-0000-4000-8000-000000000010',
    array['a1000000-0000-4000-8000-000000000021'::uuid]
  );
  if gen.outcome is distinct from 'invalid_restaurants' then
    raise exception 'FAIL: cardinality-1 array was accepted';
  end if;

  select * into gen
  from public.generate_challenge_cycle(
    'a1000000-0000-4000-8000-000000000001',
    '2026-09-01',
    'a1000000-0000-4000-8000-000000000010',
    array['a1000000-0000-4000-8000-000000000021'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid]
  );
  if gen.outcome is distinct from 'invalid_restaurants' then
    raise exception 'FAIL: duplicate restaurant ids were accepted';
  end if;

  select * into gen
  from public.generate_challenge_cycle(
    'a1000000-0000-4000-8000-000000000001',
    '2026-09-01',
    'a1000000-0000-4000-8000-000000000010',
    array['a1000000-0000-4000-8000-000000000021'::uuid, 'a1000000-0000-4000-8000-000000000024'::uuid]
  );
  if gen.outcome is distinct from 'invalid_restaurants' then
    raise exception 'FAIL: other-market restaurant was accepted';
  end if;

  select * into gen
  from public.generate_challenge_cycle(
    'a1000000-0000-4000-8000-000000000001',
    '2026-09-01',
    'a1000000-0000-4000-8000-000000000010',
    array['a1000000-0000-4000-8000-000000000021'::uuid, 'a1000000-0000-4000-8000-000000000022'::uuid]
  );
  if gen.outcome is distinct from 'created' or gen.cycle_id is null then
    raise exception 'FAIL: expected created cycle, got %', gen.outcome;
  end if;
  v_cycle := gen.cycle_id;

  if (
    select count(*) filter (where ci.status in ('assigned', 'redeemed'))
    from public.challenge_items as ci
    where ci.cycle_id = v_cycle
  ) <> 2 then
    raise exception 'FAIL: created cycle does not have two current items';
  end if;

  select * into gen
  from public.generate_challenge_cycle(
    'a1000000-0000-4000-8000-000000000001',
    '2026-09-01',
    'a1000000-0000-4000-8000-000000000010',
    array['a1000000-0000-4000-8000-000000000021'::uuid, 'a1000000-0000-4000-8000-000000000023'::uuid]
  );
  if gen.outcome is distinct from 'existing' or gen.cycle_id is distinct from v_cycle then
    raise exception 'FAIL: second generate did not return existing cycle';
  end if;
  if exists (
    select 1 from public.challenge_items as ci
    where ci.cycle_id = v_cycle
      and ci.restaurant_id = 'a1000000-0000-4000-8000-000000000023'
  ) then
    raise exception 'FAIL: existing generate mixed in the loser restaurant';
  end if;

  insert into public.challenge_cycles (user_id, cycle_month, status)
    values ('a1000000-0000-4000-8000-000000000001', '2026-08-01', 'active')
    returning id into v_cycle;
  select * into gen
  from public.generate_challenge_cycle(
    'a1000000-0000-4000-8000-000000000001',
    '2026-08-01',
    'a1000000-0000-4000-8000-000000000010',
    array['a1000000-0000-4000-8000-000000000021'::uuid, 'a1000000-0000-4000-8000-000000000022'::uuid]
  );
  if gen.outcome is distinct from 'incomplete_cycle' then
    raise exception 'FAIL: incomplete cycle was not fail-closed, got %', gen.outcome;
  end if;
  if (
    select count(*) from public.challenge_items as ci where ci.cycle_id = v_cycle
  ) <> 0 then
    raise exception 'FAIL: generate repaired an incomplete cycle';
  end if;

  select cc.id into v_cycle
  from public.challenge_cycles cc
  where cc.user_id = 'a1000000-0000-4000-8000-000000000001'
    and cc.cycle_month = '2026-09-01';
  select ci.id into v_item1
  from public.challenge_items ci
  where ci.cycle_id = v_cycle and ci.slot_number = 1 and ci.status = 'assigned';
  select ci.id into v_item2
  from public.challenge_items ci
  where ci.cycle_id = v_cycle and ci.slot_number = 2 and ci.status = 'assigned';

  select * into swapped
  from public.swap_challenge_item(
    'a1000000-0000-4000-8000-000000000002',
    v_item1,
    'a1000000-0000-4000-8000-000000000023'
  );
  if swapped.outcome is distinct from 'forbidden' then
    raise exception 'FAIL: stolen user swapped, got %', swapped.outcome;
  end if;

  select * into swapped
  from public.swap_challenge_item(
    'a1000000-0000-4000-8000-000000000001',
    v_item1,
    v_item2
  );
  if swapped.outcome is distinct from 'invalid_restaurants' then
    raise exception 'FAIL: replacement UUID that is an item id was not rejected via restaurant checks';
  end if;

  select * into swapped
  from public.swap_challenge_item(
    'a1000000-0000-4000-8000-000000000001',
    v_item1,
    (select ci.restaurant_id from public.challenge_items ci where ci.id = v_item2)
  );
  if swapped.outcome is distinct from 'invalid_restaurants' then
    raise exception 'FAIL: currently assigned restaurant was accepted as a replacement';
  end if;
  if (
    select ci.status from public.challenge_items ci where ci.id = v_item1
  ) is distinct from 'assigned'
     or (
       select cc.swap_count_used from public.challenge_cycles cc where cc.id = v_cycle
     ) is distinct from 0
  then
    raise exception 'FAIL: rejected replacement still mutated swap state';
  end if;

  create table public.g10_test_force_swap_fail (id int primary key);
  insert into public.g10_test_force_swap_fail values (1);
  create function public.g10_test_fail_swap_insert()
  returns trigger
  language plpgsql
  as $t$
  begin
    if new.swapped_from_item_id is not null
       and exists (select 1 from public.g10_test_force_swap_fail)
    then
      raise exception 'G10_TEST_FORCE_SWAP_ROLLBACK';
    end if;
    return new;
  end;
  $t$;
  create trigger g10_test_fail_swap_insert_trg
    before insert on public.challenge_items
    for each row execute function public.g10_test_fail_swap_insert();

  begin
    perform public.swap_challenge_item(
      'a1000000-0000-4000-8000-000000000001',
      v_item1,
      'a1000000-0000-4000-8000-000000000023'
    );
    raise exception 'FAIL: forced swap insert failure did not raise';
  exception
    when others then
      if sqlerrm not like '%G10_TEST_FORCE_SWAP_ROLLBACK%' then
        raise;
      end if;
  end;

  if (
    select ci.status from public.challenge_items ci where ci.id = v_item1
  ) is distinct from 'assigned'
     or exists (
       select 1 from public.challenge_items ci
       where ci.swapped_from_item_id = v_item1
     )
     or (
       select cc.swap_count_used from public.challenge_cycles cc where cc.id = v_cycle
     ) is distinct from 0
  then
    raise exception 'FAIL: forced swap failure did not roll back source/replacement/count';
  end if;

  drop trigger g10_test_fail_swap_insert_trg on public.challenge_items;
  drop function public.g10_test_fail_swap_insert();
  drop table public.g10_test_force_swap_fail;

  select * into swapped
  from public.swap_challenge_item(
    'a1000000-0000-4000-8000-000000000001',
    v_item1,
    'a1000000-0000-4000-8000-000000000023'
  );
  if swapped.outcome is distinct from 'created' then
    raise exception 'FAIL: swap create got %', swapped.outcome;
  end if;
  v_successor := swapped.replacement_item_id;

  select * into swapped
  from public.swap_challenge_item(
    'a1000000-0000-4000-8000-000000000001',
    v_item1,
    'a1000000-0000-4000-8000-000000000022'
  );
  if swapped.outcome is distinct from 'existing'
     or swapped.replacement_item_id is distinct from v_successor
  then
    raise exception 'FAIL: swap retry did not return the same successor';
  end if;

  select * into swapped
  from public.swap_challenge_item(
    'a1000000-0000-4000-8000-000000000001',
    v_item2,
    'a1000000-0000-4000-8000-000000000021'
  );
  if swapped.outcome is distinct from 'swap_exhausted' then
    raise exception 'FAIL: second slot swap was not exhausted, got %', swapped.outcome;
  end if;
  if (
    select ci.status from public.challenge_items ci where ci.id = v_item2
  ) is distinct from 'assigned' then
    raise exception 'FAIL: exhausted swap mutated the other slot';
  end if;

  insert into public.challenge_cycles (user_id, cycle_month, status)
    values ('a1000000-0000-4000-8000-000000000001', '2026-07-01', 'active')
    returning id into v_cycle;
  insert into public.challenge_items (cycle_id, restaurant_id, slot_number, status)
    values (v_cycle, 'a1000000-0000-4000-8000-000000000021', 1, 'assigned')
    returning id into v_malformed;
  update public.challenge_items set status = 'swapped_out' where id = v_malformed;
  select * into swapped
  from public.swap_challenge_item(
    'a1000000-0000-4000-8000-000000000001',
    v_malformed,
    'a1000000-0000-4000-8000-000000000023'
  );
  if swapped.outcome is distinct from 'malformed_lineage' then
    raise exception 'FAIL: swapped_out without successor got %', swapped.outcome;
  end if;

  select cc.id into v_cycle
  from public.challenge_cycles cc
  where cc.user_id = 'a1000000-0000-4000-8000-000000000001'
    and cc.cycle_month = '2026-09-01';

  select * into issued
  from public.issue_challenge_redemption(
    'a1000000-0000-4000-8000-000000000002',
    v_item2,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'cipher',
    'iviviviviviv',
    now() + interval '1 day'
  );
  if issued.outcome is distinct from 'forbidden' then
    raise exception 'FAIL: stolen user issued a redemption';
  end if;

  insert into public.redemptions (
    user_id, restaurant_id, challenge_item_id, token_hash, encrypted_code, code_iv, status, expires_at
  ) values (
    'a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000023',
    v_successor,
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'other',
    'iviviviviviv',
    'issued',
    now() + interval '1 day'
  );
  update public.challenge_items set status = 'redeemed' where id = v_successor;

  select * into issued
  from public.issue_challenge_redemption(
    'a1000000-0000-4000-8000-000000000001',
    v_item2,
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'cipher',
    'iviviviviviv',
    now() + interval '1 day'
  );
  if issued.outcome is distinct from 'token_collision' then
    raise exception 'FAIL: token collision got %', issued.outcome;
  end if;
  if (
    select ci.status from public.challenge_items ci where ci.id = v_item2
  ) is distinct from 'assigned' then
    raise exception 'FAIL: token collision marked the item redeemed';
  end if;
  if exists (
    select 1 from public.redemptions rd where rd.challenge_item_id = v_item2
  ) then
    raise exception 'FAIL: token collision left a redemption on the assigned item';
  end if;

  select * into issued
  from public.issue_challenge_redemption(
    'a1000000-0000-4000-8000-000000000001',
    v_item2,
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'cipher-two',
    'iviviviviviv',
    now() + interval '1 day'
  );
  if issued.outcome is distinct from 'created' then
    raise exception 'FAIL: issue after collision got %', issued.outcome;
  end if;

  select * into issued
  from public.issue_challenge_redemption(
    'a1000000-0000-4000-8000-000000000001',
    v_item2,
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'cipher-three',
    'iviviviviviv',
    now() + interval '1 day'
  );
  if issued.outcome is distinct from 'existing'
     or issued.encrypted_code is distinct from 'cipher-two'
  then
    raise exception 'FAIL: issue retry did not return the existing encrypted code';
  end if;

  v_n := (
    select count(*) from public.redemptions rd where rd.challenge_item_id = v_item2
  );
  if v_n <> 1 then
    raise exception 'FAIL: expected one redemption, got %', v_n;
  end if;
end $$;
reset role;

select 'PASS: G10 challenge RPCs, layout, lineage, token collision, forced swap rollback, grants';
rollback;
