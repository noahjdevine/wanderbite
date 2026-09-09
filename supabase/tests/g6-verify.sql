-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '15s';

do $$
begin
  if has_function_privilege('anon', 'public.verify_redemption(text, uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.verify_redemption(text, uuid)', 'EXECUTE')
  then
    raise exception 'FAIL: client can EXECUTE verify_redemption';
  end if;
  if not has_function_privilege('service_role', 'public.verify_redemption(text, uuid)', 'EXECUTE') then
    raise exception 'FAIL: service_role cannot EXECUTE verify_redemption';
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'redemptions'
      and column_name = 'expires_at'
      and is_nullable = 'YES'
  ) then
    raise exception 'FAIL: redemptions.expires_at is nullable';
  end if;
end $$;

insert into auth.users (id) values
  ('60000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000002');
insert into public.user_profiles (id, is_admin) values
  ('60000000-0000-4000-8000-000000000001', false),
  ('60000000-0000-4000-8000-000000000002', false);
insert into public.restaurants (id, name, status) values
  ('60000000-0000-4000-8000-000000000011', 'G6 Grill', 'active'),
  ('60000000-0000-4000-8000-000000000012', 'G6 Other', 'active');

insert into public.redemptions (
  id, user_id, restaurant_id, token_hash, status, created_at, expires_at
) values
  (
    '60000000-0000-4000-8000-000000000021',
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000011',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'issued',
    now(),
    now() + interval '35 days'
  ),
  (
    '60000000-0000-4000-8000-000000000022',
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000012',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'issued',
    now(),
    now() + interval '35 days'
  ),
  (
    '60000000-0000-4000-8000-000000000023',
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000011',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'issued',
    now() - interval '40 days',
    now() - interval '5 days'
  ),
  (
    '60000000-0000-4000-8000-000000000024',
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000011',
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'expired',
    now(),
    now() + interval '35 days'
  );

do $$
declare
  claimed integer;
  status text;
begin
  select count(*) into claimed
  from public.verify_redemption(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '60000000-0000-4000-8000-000000000011'
  );
  if claimed <> 1 then
    raise exception 'FAIL: happy path did not return one row';
  end if;
  select r.status into status
  from public.redemptions r
  where r.id = '60000000-0000-4000-8000-000000000021';
  if status is distinct from 'verified' then
    raise exception 'FAIL: happy path did not set verified';
  end if;

  select count(*) into claimed
  from public.verify_redemption(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '60000000-0000-4000-8000-000000000011'
  );
  if claimed <> 0 then
    raise exception 'FAIL: second verify returned a row';
  end if;
  select r.status into status
  from public.redemptions r
  where r.id = '60000000-0000-4000-8000-000000000021';
  if status is distinct from 'verified' then
    raise exception 'FAIL: second verify changed status';
  end if;
end $$;

do $$
declare claimed integer;
begin
  select count(*) into claimed
  from public.verify_redemption(
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '60000000-0000-4000-8000-000000000011'
  );
  if claimed <> 0 then
    raise exception 'FAIL: wrong restaurant was verified';
  end if;
  if exists (
    select 1 from public.redemptions
    where id = '60000000-0000-4000-8000-000000000022'
      and status is distinct from 'issued'
  ) then
    raise exception 'FAIL: wrong restaurant row was mutated';
  end if;
end $$;

do $$
declare claimed integer;
begin
  select count(*) into claimed
  from public.verify_redemption(
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    '60000000-0000-4000-8000-000000000011'
  );
  if claimed <> 0 then
    raise exception 'FAIL: expired issued row was verified';
  end if;
end $$;

do $$
declare claimed integer;
begin
  select count(*) into claimed
  from public.verify_redemption(
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    '60000000-0000-4000-8000-000000000011'
  );
  if claimed <> 0 then
    raise exception 'FAIL: expired status row was verified';
  end if;
end $$;

insert into public.redemptions (user_id, restaurant_id, token_hash, status)
values (
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000011',
  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  'issued'
);
do $$
begin
  if not exists (
    select 1 from public.redemptions
    where token_hash = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
      and expires_at is not null
      and expires_at > now() + interval '34 days'
  ) then
    raise exception 'FAIL: insert without expires_at did not receive the 35-day default';
  end if;
end $$;

insert into public.redemptions (
  id, user_id, restaurant_id, token_hash, status, expires_at
) values (
  '60000000-0000-4000-8000-000000000031',
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000011',
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  'issued',
  now() + interval '35 days'
);

do $$
begin
  begin
    insert into public.redemptions (
      id, user_id, restaurant_id, token_hash, status, expires_at
    ) values (
      '60000000-0000-4000-8000-000000000032',
      '60000000-0000-4000-8000-000000000002',
      '60000000-0000-4000-8000-000000000011',
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      'issued',
      now() + interval '35 days'
    );
    raise exception 'FAIL: duplicate token_hash insert succeeded';
  exception when unique_violation then null; end;

  if (
    select count(*) from public.redemptions
    where token_hash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  ) <> 1 then
    raise exception 'FAIL: duplicate token_hash was persisted';
  end if;
end $$;

set local role anon;
do $$
begin
  begin
    perform * from public.verify_redemption(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '60000000-0000-4000-8000-000000000011'
    );
    raise exception 'FAIL: anon executed verify_redemption';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
do $$
begin
  begin
    perform * from public.verify_redemption(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '60000000-0000-4000-8000-000000000011'
    );
    raise exception 'FAIL: authenticated executed verify_redemption';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
select 'PASS: G6 verify_redemption grants, expires_at, single-winner, duplicate abort; fixtures rolled back';
