-- Run only through the guarded local harness. All fixture rows are rolled back.
-- Code lifetime is the caller TTL, capped at the visit window. Reissue rotates the same row.
begin;
set local statement_timeout = '30s';

insert into auth.users (id) values ('a1500000-0000-4000-8000-000000000001');
insert into public.user_profiles (id, subscription_status, is_admin)
  values ('a1500000-0000-4000-8000-000000000001', 'active', false);
insert into public.restaurants (id, name, status) values
  ('a1500000-0000-4000-8000-000000000011', 'TTL Grill', 'active'),
  ('a1500000-0000-4000-8000-000000000012', 'TTL Other', 'active');

do $$
declare
  member uuid := 'a1500000-0000-4000-8000-000000000001';
  grill uuid := 'a1500000-0000-4000-8000-000000000011';
  other uuid := 'a1500000-0000-4000-8000-000000000012';
  cap_cycle uuid;
  long_cycle uuid;
  re_cycle uuid;
  closed_cycle uuid;
  exp_cycle uuid;
  bump_cycle uuid;
  cap_item uuid;
  long_item uuid;
  re_item uuid;
  closed_item uuid;
  exp_item uuid;
  bump_item uuid;
  issued record;
  claimed integer;
  v_deadline timestamptz;
  v_ttl timestamptz;
  v_default text;
  old_hash text := repeat('a1', 32);
  new_hash text := repeat('b2', 32);
  closed_hash text := repeat('c3', 32);
  exp_hash text := repeat('d4', 32);
  fresh_hash text := repeat('e5', 32);
  bump_hash text := repeat('f6', 32);
  taken_hash text := repeat('ab', 32);
begin
  select column_default into v_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'redemptions'
    and column_name = 'expires_at';
  if v_default not like '%00:15:00%' and v_default not like '%15 minutes%' then
    raise exception 'FAIL: expires_at default is %', v_default;
  end if;

  insert into public.challenge_cycles (user_id, cycle_month, status)
    values (member, '2026-01-01', 'active') returning id into cap_cycle;
  insert into public.challenge_items (cycle_id, restaurant_id, slot_number, status)
    values (cap_cycle, grill, 1, 'assigned') returning id into cap_item;
  v_deadline := now() + interval '5 minutes';
  update public.challenge_items set redemption_deadline = v_deadline where id = cap_item;
  select * into issued from public.issue_challenge_redemption(
    member, cap_item, repeat('11', 32), 'cipher', 'iviviviviviv', now() + interval '15 minutes'
  );
  if issued.outcome is distinct from 'created'
     or (select expires_at from public.redemptions where challenge_item_id = cap_item) is distinct from v_deadline
     or (select status from public.challenge_items where id = cap_item) is distinct from 'redeemed'
  then
    raise exception 'FAIL: five-minute window was %', issued.outcome;
  end if;

  insert into public.challenge_cycles (user_id, cycle_month, status)
    values (member, '2026-02-01', 'active') returning id into long_cycle;
  insert into public.challenge_items (cycle_id, restaurant_id, slot_number, status)
    values (long_cycle, grill, 1, 'assigned') returning id into long_item;
  v_ttl := now() + interval '15 minutes';
  v_deadline := now() + interval '10 days';
  update public.challenge_items set redemption_deadline = v_deadline where id = long_item;
  select * into issued from public.issue_challenge_redemption(
    member, long_item, repeat('22', 32), 'cipher', 'iviviviviviv', v_ttl
  );
  if issued.outcome is distinct from 'created'
     or (select expires_at from public.redemptions where challenge_item_id = long_item) is distinct from v_ttl
     or (select expires_at from public.redemptions where challenge_item_id = long_item) >= v_deadline
  then
    raise exception 'FAIL: open window stored %', issued.outcome;
  end if;

  insert into public.challenge_cycles (user_id, cycle_month, status)
    values (member, '2026-03-01', 'active') returning id into re_cycle;
  insert into public.challenge_items (cycle_id, restaurant_id, slot_number, status, redemption_deadline)
    values (re_cycle, grill, 1, 'assigned', now() + interval '2 days')
    returning id into re_item;
  select * into issued from public.issue_challenge_redemption(
    member, re_item, old_hash, 'old-cipher', 'iviviviviviv', now() + interval '15 minutes'
  );
  if issued.outcome is distinct from 'created' then
    raise exception 'FAIL: first code was %', issued.outcome;
  end if;
  update public.redemptions
  set expires_at = now() - interval '1 minute'
  where challenge_item_id = re_item;
  select * into issued from public.issue_challenge_redemption(
    member, re_item, new_hash, 'new-cipher', 'iviviviviviv', now() + interval '15 minutes'
  );
  if issued.outcome is distinct from 'reissued'
     or issued.encrypted_code is distinct from 'new-cipher'
     or (select token_hash from public.redemptions where challenge_item_id = re_item) is distinct from new_hash
     or (select status from public.redemptions where challenge_item_id = re_item) is distinct from 'issued'
     or (select count(*) from public.redemptions where challenge_item_id = re_item) is distinct from 1
     or (select status from public.challenge_items where id = re_item) is distinct from 'redeemed'
     or (select expires_at from public.redemptions where challenge_item_id = re_item) <= now()
  then
    raise exception 'FAIL: reissue was %', issued.outcome;
  end if;

  select count(*) into claimed from public.verify_redemption(old_hash, grill);
  if claimed <> 0
     or exists (select 1 from public.redemptions where token_hash = old_hash)
  then
    raise exception 'FAIL: old token still verifies';
  end if;

  select count(*) into claimed from public.verify_redemption(new_hash, grill);
  if claimed <> 1
     or (select status from public.redemptions where challenge_item_id = re_item) is distinct from 'verified'
  then
    raise exception 'FAIL: new token did not verify';
  end if;

  select * into issued from public.issue_challenge_redemption(
    member, re_item, repeat('99', 32), 'nope', 'iviviviviviv', now() + interval '15 minutes'
  );
  if issued.outcome is distinct from 'existing'
     or (select token_hash from public.redemptions where challenge_item_id = re_item) is distinct from new_hash
     or (select status from public.redemptions where challenge_item_id = re_item) is distinct from 'verified'
  then
    raise exception 'FAIL: verified reissue was %', issued.outcome;
  end if;

  insert into public.challenge_cycles (user_id, cycle_month, status)
    values (member, '2026-04-01', 'active') returning id into closed_cycle;
  insert into public.challenge_items (cycle_id, restaurant_id, slot_number, status, redemption_deadline)
    values (closed_cycle, grill, 1, 'redeemed', now() - interval '1 hour')
    returning id into closed_item;
  insert into public.redemptions (
    user_id, restaurant_id, challenge_item_id, token_hash, encrypted_code, code_iv, status, expires_at
  ) values (
    member, grill, closed_item, closed_hash, 'closed', 'iviviviviviv', 'expired', now() - interval '1 hour'
  );
  select * into issued from public.issue_challenge_redemption(
    member, closed_item, repeat('33', 32), 'fresh', 'iviviviviviv', now() + interval '15 minutes'
  );
  if issued.outcome is distinct from 'past_deadline'
     or (select token_hash from public.redemptions where challenge_item_id = closed_item) is distinct from closed_hash
     or (select status from public.challenge_items where id = closed_item) is distinct from 'redeemed'
  then
    raise exception 'FAIL: closed window was %', issued.outcome;
  end if;

  insert into public.challenge_cycles (user_id, cycle_month, status)
    values (member, '2026-05-01', 'active') returning id into exp_cycle;
  insert into public.challenge_items (cycle_id, restaurant_id, slot_number, status, redemption_deadline)
    values (exp_cycle, grill, 1, 'redeemed', now() + interval '1 day')
    returning id into exp_item;
  insert into public.redemptions (
    user_id, restaurant_id, challenge_item_id, token_hash, encrypted_code, code_iv, status, expires_at
  ) values (
    member, grill, exp_item, exp_hash, 'aged', 'iviviviviviv', 'expired', now() - interval '1 minute'
  );
  select * into issued from public.issue_challenge_redemption(
    member, exp_item, fresh_hash, 'fresh-cipher', 'iviviviviviv', now() + interval '15 minutes'
  );
  if issued.outcome is distinct from 'reissued'
     or (select token_hash from public.redemptions where challenge_item_id = exp_item) is distinct from fresh_hash
     or (select status from public.redemptions where challenge_item_id = exp_item) is distinct from 'issued'
     or (select status from public.challenge_items where id = exp_item) is distinct from 'redeemed'
     or (select count(*) from public.entitlement_credits where user_id = member) is distinct from 0
  then
    raise exception 'FAIL: expired-status reissue was %', issued.outcome;
  end if;

  insert into public.challenge_cycles (user_id, cycle_month, status)
    values (member, '2026-06-01', 'active') returning id into bump_cycle;
  insert into public.challenge_items (cycle_id, restaurant_id, slot_number, status, redemption_deadline)
    values (bump_cycle, other, 1, 'redeemed', now() + interval '1 day')
    returning id into bump_item;
  insert into public.redemptions (
    user_id, restaurant_id, challenge_item_id, token_hash, encrypted_code, code_iv, status, expires_at
  ) values (
    member, other, bump_item, bump_hash, 'bump', 'iviviviviviv', 'issued', now() - interval '1 minute'
  );
  insert into public.redemptions (
    user_id, restaurant_id, token_hash, encrypted_code, code_iv, status, expires_at
  ) values (
    member, other, taken_hash, 'taken', 'iviviviviviv', 'issued', now() + interval '1 day'
  );
  select * into issued from public.issue_challenge_redemption(
    member, bump_item, taken_hash, 'collide', 'iviviviviviv', now() + interval '15 minutes'
  );
  if issued.outcome is distinct from 'token_collision'
     or (select token_hash from public.redemptions where challenge_item_id = bump_item) is distinct from bump_hash
     or (select status from public.redemptions where challenge_item_id = bump_item) is distinct from 'issued'
  then
    raise exception 'FAIL: reissue collision was %', issued.outcome;
  end if;
end $$;

select 'PASS: redemption code cap, same-row reissue, old token unusable, verified unchanged';
rollback;
