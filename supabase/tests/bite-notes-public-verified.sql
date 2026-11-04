-- Run only through the guarded local harness. All fixture rows are rolled back.
-- Public bite_notes SELECT: non-owners see a row only when is_public
-- and the redemption is verified with verified_at set.
begin;
set local statement_timeout = '15s';

do $$
declare
  fn oid := 'public.redemption_is_verified(uuid)'::regprocedure;
  config text[];
  result_type text;
  owner_bypass boolean;
  redemption_policies integer;
  note_policies integer;
  public_roles name[];
  public_cmd text;
  public_qual text;
  owner_cmd text;
  owner_qual text;
  owner_check text;
begin
  select p.proconfig, pg_get_function_result(p.oid), r.rolbypassrls
    into config, result_type, owner_bypass
  from pg_proc p
  join pg_roles r on r.oid = p.proowner
  where p.oid = fn;

  if result_type is distinct from 'boolean'
     or (select proretset from pg_proc where oid = fn)
     or not (select prosecdef from pg_proc where oid = fn)
     or (select provolatile from pg_proc where oid = fn) is distinct from 's'
     or not owner_bypass then
    raise exception
      'FAIL: redemption_is_verified shape result=% setof=% definer=% volatile=% owner_bypass=%',
      result_type,
      (select proretset from pg_proc where oid = fn),
      (select prosecdef from pg_proc where oid = fn),
      (select provolatile from pg_proc where oid = fn),
      owner_bypass;
  end if;

  if config is distinct from array['search_path=']
     and config is distinct from array['search_path=""'] then
    raise exception 'FAIL: redemption_is_verified search_path %', config;
  end if;

  if position('token_hash' in (select prosrc from pg_proc where oid = fn)) > 0
     or position('user_id' in (select prosrc from pg_proc where oid = fn)) > 0
     or position('encrypted_code' in (select prosrc from pg_proc where oid = fn)) > 0
     or position('verified_at is not null' in (select prosrc from pg_proc where oid = fn)) = 0
     or position('status = ''verified''' in (select prosrc from pg_proc where oid = fn)) = 0 then
    raise exception 'FAIL: redemption_is_verified body is not a boolean verified check';
  end if;

  if has_function_privilege('public', fn, 'EXECUTE')
     or not has_function_privilege('anon', fn, 'EXECUTE')
     or not has_function_privilege('authenticated', fn, 'EXECUTE')
     or has_function_privilege('service_role', fn, 'EXECUTE') then
    raise exception 'FAIL: redemption_is_verified execute grants';
  end if;

  if exists (
    select 1
    from aclexplode((select proacl from pg_proc where oid = fn)) as acl
    where acl.privilege_type = 'EXECUTE'
      and (
        acl.grantee = 0
        or acl.grantee = 'service_role'::regrole
        or acl.grantee not in (
          'anon'::regrole,
          'authenticated'::regrole,
          (select proowner from pg_proc where oid = fn)
        )
      )
  ) then
    raise exception 'FAIL: redemption_is_verified ACL is not anon and authenticated only';
  end if;

  select count(*) into redemption_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'redemptions';
  if redemption_policies is distinct from 1 then
    raise exception 'FAIL: redemptions policy count %', redemption_policies;
  end if;
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'redemptions'
      and (
        policyname is distinct from 'Users view own redemptions'
        or cmd is distinct from 'SELECT'
        or roles is distinct from '{public}'::name[]
        or qual not like '%auth.uid()%'
        or qual not like '%user_id%'
      )
  ) then
    raise exception 'FAIL: redemptions SELECT is not owner-only';
  end if;
  if exists (
    select 1
    from pg_class
    where oid = 'public.redemptions'::regclass
      and (not relrowsecurity or relforcerowsecurity)
  ) or exists (
    select 1 from pg_roles
    where rolname in ('anon', 'authenticated') and rolbypassrls
  ) then
    raise exception 'FAIL: redemptions RLS would not hide rows from anon or other members';
  end if;

  select count(*) into note_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'bite_notes';
  if note_policies is distinct from 2 then
    raise exception 'FAIL: bite_notes policy count %', note_policies;
  end if;

  select roles, cmd, qual
    into public_roles, public_cmd, public_qual
  from pg_policies
  where schemaname = 'public'
    and tablename = 'bite_notes'
    and policyname = 'Anyone can view public notes';
  if public_roles is distinct from '{public}'::name[]
     or public_cmd is distinct from 'SELECT'
     or public_qual not like '%is_public%'
     or public_qual not like '%redemption_is_verified%'
     or public_qual like '%auth.uid()%' then
    raise exception 'FAIL: public notes policy roles=% cmd=% qual=%',
      public_roles, public_cmd, public_qual;
  end if;

  select cmd, qual, with_check
    into owner_cmd, owner_qual, owner_check
  from pg_policies
  where schemaname = 'public'
    and tablename = 'bite_notes'
    and policyname = 'Users manage own notes';
  if owner_cmd is distinct from 'ALL'
     or owner_qual not like '%auth.uid()%'
     or owner_qual not like '%user_id%'
     or owner_check not like '%auth.uid()%'
     or owner_check not like '%user_id%' then
    raise exception 'FAIL: owner notes policy changed cmd=% qual=% check=%',
      owner_cmd, owner_qual, owner_check;
  end if;
end $$;

insert into auth.users (id) values
  ('b1e70000-0000-4000-8000-000000000001'),
  ('b1e70000-0000-4000-8000-000000000002');
insert into public.user_profiles (id, is_admin) values
  ('b1e70000-0000-4000-8000-000000000001', false),
  ('b1e70000-0000-4000-8000-000000000002', false);
insert into public.restaurants (id, name, status) values
  ('b1e70000-0000-4000-8000-000000000010', 'Public Note Grill', 'active');

insert into public.redemptions (
  id, user_id, restaurant_id, token_hash, status, verified_at, expires_at
) values
  (
    'b1e70000-0000-4000-8000-000000000021',
    'b1e70000-0000-4000-8000-000000000001',
    'b1e70000-0000-4000-8000-000000000010',
    'b1e70000-verified',
    'verified',
    '2026-11-01T15:00:00Z',
    now() + interval '15 minutes'
  ),
  (
    'b1e70000-0000-4000-8000-000000000022',
    'b1e70000-0000-4000-8000-000000000001',
    'b1e70000-0000-4000-8000-000000000010',
    'b1e70000-issued',
    'issued',
    null,
    now() + interval '15 minutes'
  ),
  (
    'b1e70000-0000-4000-8000-000000000023',
    'b1e70000-0000-4000-8000-000000000001',
    'b1e70000-0000-4000-8000-000000000010',
    'b1e70000-expired',
    'expired',
    null,
    now() - interval '1 minute'
  ),
  (
    'b1e70000-0000-4000-8000-000000000024',
    'b1e70000-0000-4000-8000-000000000001',
    'b1e70000-0000-4000-8000-000000000010',
    'b1e70000-verified-null',
    'verified',
    null,
    now() + interval '15 minutes'
  ),
  (
    'b1e70000-0000-4000-8000-000000000025',
    'b1e70000-0000-4000-8000-000000000001',
    'b1e70000-0000-4000-8000-000000000010',
    'b1e70000-private',
    'verified',
    '2026-11-01T15:00:00Z',
    now() + interval '15 minutes'
  ),
  (
    'b1e70000-0000-4000-8000-000000000026',
    'b1e70000-0000-4000-8000-000000000001',
    'b1e70000-0000-4000-8000-000000000010',
    'b1e70000-owner-extra',
    'issued',
    null,
    now() + interval '15 minutes'
  );

insert into public.bite_notes (
  id, user_id, redemption_id, restaurant_id, note, rating, is_public
) values
  (
    'b1e70000-0000-4000-8000-000000000031',
    'b1e70000-0000-4000-8000-000000000001',
    'b1e70000-0000-4000-8000-000000000021',
    'b1e70000-0000-4000-8000-000000000010',
    'shared verified review',
    5,
    true
  ),
  (
    'b1e70000-0000-4000-8000-000000000032',
    'b1e70000-0000-4000-8000-000000000001',
    'b1e70000-0000-4000-8000-000000000022',
    'b1e70000-0000-4000-8000-000000000010',
    'issued secret',
    4,
    true
  ),
  (
    'b1e70000-0000-4000-8000-000000000033',
    'b1e70000-0000-4000-8000-000000000001',
    'b1e70000-0000-4000-8000-000000000023',
    'b1e70000-0000-4000-8000-000000000010',
    'expired secret',
    3,
    true
  ),
  (
    'b1e70000-0000-4000-8000-000000000034',
    'b1e70000-0000-4000-8000-000000000001',
    'b1e70000-0000-4000-8000-000000000024',
    'b1e70000-0000-4000-8000-000000000010',
    'null verified_at secret',
    2,
    true
  ),
  (
    'b1e70000-0000-4000-8000-000000000035',
    'b1e70000-0000-4000-8000-000000000001',
    'b1e70000-0000-4000-8000-000000000025',
    'b1e70000-0000-4000-8000-000000000010',
    'private secret',
    5,
    false
  );

-- A caller-scoped read of redemptions is empty for these rows, while the helper is not.
select set_config('request.jwt.claim.sub', 'b1e70000-0000-4000-8000-000000000002', true);
set local role authenticated;
do $$
begin
  if exists (
    select 1 from public.redemptions
    where user_id = 'b1e70000-0000-4000-8000-000000000001'
  ) then
    raise exception 'FAIL: other member can read the owner redemption';
  end if;
  if exists (
    select 1
    from public.redemptions
    where id = 'b1e70000-0000-4000-8000-000000000021'
      and status = 'verified'
      and verified_at is not null
  ) then
    raise exception 'FAIL: plain redemption EXISTS would succeed for another member';
  end if;
  if public.redemption_is_verified('b1e70000-0000-4000-8000-000000000021') is distinct from true
     or public.redemption_is_verified('b1e70000-0000-4000-8000-000000000022') is distinct from false
     or public.redemption_is_verified('b1e70000-0000-4000-8000-000000000023') is distinct from false
     or public.redemption_is_verified('b1e70000-0000-4000-8000-000000000024') is distinct from false
     or public.redemption_is_verified('b1e70000-0000-4000-8000-000000000099') is distinct from false then
    raise exception 'FAIL: helper boolean does not match verified redemption';
  end if;
  if (select count(*) from public.bite_notes) is distinct from 1
     or (select note from public.bite_notes where id = 'b1e70000-0000-4000-8000-000000000031')
        is distinct from 'shared verified review'
     or exists (
       select 1 from public.bite_notes
       where id in (
         'b1e70000-0000-4000-8000-000000000032',
         'b1e70000-0000-4000-8000-000000000033',
         'b1e70000-0000-4000-8000-000000000034',
         'b1e70000-0000-4000-8000-000000000035'
       )
     ) then
    raise exception 'FAIL: other member bite_notes visibility';
  end if;
end $$;

do $$
declare changed integer;
begin
  update public.bite_notes
  set note = 'other edit'
  where id = 'b1e70000-0000-4000-8000-000000000031';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'FAIL: other member updated a public note';
  end if;
  delete from public.bite_notes
  where id = 'b1e70000-0000-4000-8000-000000000031';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'FAIL: other member deleted a public note';
  end if;
  begin
    insert into public.bite_notes (
      id, user_id, redemption_id, restaurant_id, note, rating, is_public
    ) values (
      'b1e70000-0000-4000-8000-000000000036',
      'b1e70000-0000-4000-8000-000000000001',
      'b1e70000-0000-4000-8000-000000000026',
      'b1e70000-0000-4000-8000-000000000010',
      'forged note',
      1,
      true
    );
    raise exception 'FAIL: other member inserted a note for the owner';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
begin
  if exists (select 1 from public.redemptions) then
    raise exception 'FAIL: anon can read redemptions';
  end if;
  if public.redemption_is_verified('b1e70000-0000-4000-8000-000000000021') is distinct from true
     or public.redemption_is_verified('b1e70000-0000-4000-8000-000000000024') is distinct from false then
    raise exception 'FAIL: anon helper boolean';
  end if;
  if (select count(*) from public.bite_notes) is distinct from 1
     or (select note from public.bite_notes where id = 'b1e70000-0000-4000-8000-000000000031')
        is distinct from 'shared verified review'
     or exists (
       select 1 from public.bite_notes
       where note in (
         'issued secret',
         'expired secret',
         'null verified_at secret',
         'private secret'
       )
     ) then
    raise exception 'FAIL: anon bite_notes visibility';
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', 'b1e70000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
declare changed integer;
begin
  if (select count(*) from public.bite_notes) is distinct from 5
     or not exists (
       select 1 from public.bite_notes
       where note = 'issued secret' and is_public
     )
     or not exists (
       select 1 from public.bite_notes
       where note = 'private secret' and not is_public
     )
     or not exists (
       select 1 from public.bite_notes where note = 'null verified_at secret'
     ) then
    raise exception 'FAIL: owner cannot read every own note';
  end if;

  update public.bite_notes
  set note = 'private edited'
  where id = 'b1e70000-0000-4000-8000-000000000035';
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'FAIL: owner update changed % rows', changed;
  end if;

  insert into public.bite_notes (
    id, user_id, redemption_id, restaurant_id, note, rating, is_public
  ) values (
    'b1e70000-0000-4000-8000-000000000036',
    auth.uid(),
    'b1e70000-0000-4000-8000-000000000026',
    'b1e70000-0000-4000-8000-000000000010',
    'owner insert',
    4,
    true
  );
  update public.bite_notes
  set is_public = true, note = 'owner public unverified'
  where id = 'b1e70000-0000-4000-8000-000000000036';
  get diagnostics changed = row_count;
  if changed <> 1
     or not exists (
       select 1 from public.bite_notes
       where id = 'b1e70000-0000-4000-8000-000000000036'
         and is_public
         and note = 'owner public unverified'
     ) then
    raise exception 'FAIL: owner cannot publish an unverified note';
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', 'b1e70000-0000-4000-8000-000000000002', true);
set local role authenticated;
do $$
begin
  if exists (
    select 1 from public.bite_notes
    where id = 'b1e70000-0000-4000-8000-000000000036'
       or note = 'owner public unverified'
  ) then
    raise exception 'FAIL: unverified public note is visible to another member';
  end if;
  if (select count(*) from public.bite_notes) is distinct from 1 then
    raise exception 'FAIL: other member saw more than the verified public note';
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
begin
  if exists (
    select 1 from public.bite_notes
    where id = 'b1e70000-0000-4000-8000-000000000036'
  ) or (select count(*) from public.bite_notes) is distinct from 1 then
    raise exception 'FAIL: anon saw an unverified public note';
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', 'b1e70000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
declare changed integer;
begin
  delete from public.bite_notes
  where id = 'b1e70000-0000-4000-8000-000000000036';
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'FAIL: owner delete changed % rows', changed;
  end if;
  if (select note from public.bite_notes where id = 'b1e70000-0000-4000-8000-000000000035')
     is distinct from 'private edited'
     or (select count(*) from public.bite_notes) is distinct from 5 then
    raise exception 'FAIL: owner delete changed another note';
  end if;
end $$;

reset role;
rollback;
select 'PASS: public bite notes require a verified redemption; fixtures rolled back';
