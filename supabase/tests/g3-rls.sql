-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '15s';

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.partner_sessions'::regclass) then
    raise exception 'FAIL: partner_sessions RLS disabled';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'partner_sessions') then
    raise exception 'FAIL: partner_sessions client policy exists';
  end if;
  if exists (
    select 1
    from aclexplode(coalesce((
      select relacl from pg_class where oid = 'public.partner_sessions'::regclass
    ), '{}'::aclitem[])) acl
    where acl.grantee = 0
       or acl.grantee in ('anon'::regrole, 'authenticated'::regrole)
  ) then
    raise exception 'FAIL: public, anon, or authenticated privileges remain on partner_sessions';
  end if;
  if has_table_privilege('anon', 'public.partner_sessions', 'SELECT')
    or has_table_privilege('anon', 'public.partner_sessions', 'INSERT')
    or has_table_privilege('anon', 'public.partner_sessions', 'UPDATE')
    or has_table_privilege('anon', 'public.partner_sessions', 'DELETE')
    or has_table_privilege('authenticated', 'public.partner_sessions', 'SELECT')
    or has_table_privilege('authenticated', 'public.partner_sessions', 'INSERT')
    or has_table_privilege('authenticated', 'public.partner_sessions', 'UPDATE')
    or has_table_privilege('authenticated', 'public.partner_sessions', 'DELETE')
  then
    raise exception 'FAIL: client table privileges remain on partner_sessions';
  end if;
  if not has_table_privilege('service_role', 'public.partner_sessions', 'SELECT')
    or not has_table_privilege('service_role', 'public.partner_sessions', 'INSERT')
    or not has_table_privilege('service_role', 'public.partner_sessions', 'DELETE')
    or has_table_privilege('service_role', 'public.partner_sessions', 'UPDATE')
  then
    raise exception 'FAIL: service_role must have SELECT, INSERT, DELETE only on partner_sessions';
  end if;
end $$;

insert into public.restaurants (id, name, status) values
  ('50000000-0000-4000-8000-000000000001', 'G3 Active Grill', 'active'),
  ('50000000-0000-4000-8000-000000000002', 'G3 Paused Pub', 'paused');

do $$ begin
  begin
    insert into public.partner_sessions (token_hash, restaurant_id, expires_at)
      values ('not-a-hash', '50000000-0000-4000-8000-000000000001', now() + interval '1 day');
    raise exception 'FAIL: malformed token_hash accepted';
  exception when check_violation then null; end;

  begin
    insert into public.partner_sessions (token_hash, restaurant_id, created_at, expires_at)
      values (
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '50000000-0000-4000-8000-000000000001',
        now() + interval '1 day',
        now()
      );
    raise exception 'FAIL: expires_at before created_at accepted';
  exception when check_violation then null; end;

  begin
    insert into public.partner_sessions (token_hash, restaurant_id, expires_at)
      values (
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '50000000-0000-4000-8000-000000000099',
        now() + interval '1 day'
      );
    raise exception 'FAIL: missing restaurant FK accepted';
  exception when foreign_key_violation then null; end;
end $$;

insert into public.partner_sessions (token_hash, restaurant_id, expires_at)
  values (
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    '50000000-0000-4000-8000-000000000001',
    now() + interval '1 day'
  );

set local role authenticated;
do $$ begin
  begin
    insert into public.partner_sessions (token_hash, restaurant_id, expires_at)
      values (
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        '50000000-0000-4000-8000-000000000001',
        now() + interval '1 day'
      );
    raise exception 'FAIL: authenticated insert on partner_sessions';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.partner_sessions;
    raise exception 'FAIL: authenticated select on partner_sessions';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role anon;
do $$ begin
  begin
    delete from public.partner_sessions;
    raise exception 'FAIL: anon delete on partner_sessions';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role service_role;
insert into public.partner_sessions (token_hash, restaurant_id, expires_at)
  values (
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    '50000000-0000-4000-8000-000000000001',
    now() + interval '1 day'
  );
do $$
declare changed integer;
begin
  begin
    update public.partner_sessions
      set expires_at = now() + interval '2 days'
      where token_hash = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    get diagnostics changed = row_count;
    if changed <> 0 then
      raise exception 'FAIL: service_role can UPDATE partner_sessions';
    end if;
  exception when insufficient_privilege then null; end;
end $$;

delete from public.partner_sessions
  where token_hash = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
reset role;

delete from public.restaurants where id = '50000000-0000-4000-8000-000000000001';
do $$ begin
  if exists (
    select 1 from public.partner_sessions
    where token_hash = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  ) then
    raise exception 'FAIL: restaurant delete did not cascade sessions';
  end if;
end $$;

rollback;
select 'PASS: G3 partner_sessions grants, RLS, constraints, cascade; fixtures rolled back';
