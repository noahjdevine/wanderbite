-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '15s';

do $$
declare
  fn regprocedure := 'public.record_legal_attestation(text, boolean, boolean)'::regprocedure;
  args text;
  config text[];
  definer boolean;
  n integer;
begin
  if (select count(*) from public.legal_attestations) <> 0 then
    raise exception 'FAIL: migration inserted attestation rows';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.legal_attestations'::regclass) then
    raise exception 'FAIL: legal_attestations RLS disabled';
  end if;
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.legal_attestations'::regclass
      and polname = 'legal_attestations_select_own'
      and polcmd = 'r'
  ) or exists (
    select 1 from pg_policy
    where polrelid = 'public.legal_attestations'::regclass
      and polcmd <> 'r'
  ) then
    raise exception 'FAIL: legal_attestations policies are not select-own only';
  end if;

  select pg_get_function_identity_arguments(fn) into args;
  if args is distinct from 'p_presented_version text, p_age_21 boolean, p_agree_to_terms boolean' then
    raise exception 'FAIL: record_legal_attestation arguments are %', args;
  end if;
  select prosecdef, proconfig into definer, config
  from pg_proc where oid = fn;
  if not definer or config is distinct from array['search_path=pg_catalog, public'] then
    raise exception 'FAIL: record_legal_attestation definer/search_path % %', definer, config;
  end if;
  if position('53e3148013cc72dd9c0f7856fc2dd2bf6d4b870e89fdcd59fe0ee5073b3de1fb' in pg_get_functiondef(fn)) = 0
    or position('2026-02-22' in pg_get_functiondef(fn)) = 0
  then
    raise exception 'FAIL: function does not pin the version and content id';
  end if;

  if has_function_privilege('anon', fn, 'EXECUTE')
    or has_function_privilege('service_role', fn, 'EXECUTE')
    or not has_function_privilege('authenticated', fn, 'EXECUTE')
    or exists (
      select 1 from aclexplode((select proacl from pg_proc where oid = fn)) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )
  then
    raise exception 'FAIL: record_legal_attestation execute grants';
  end if;

  if not has_table_privilege('authenticated', 'public.legal_attestations', 'SELECT')
    or has_table_privilege('authenticated', 'public.legal_attestations', 'INSERT')
    or has_table_privilege('authenticated', 'public.legal_attestations', 'UPDATE')
    or has_table_privilege('authenticated', 'public.legal_attestations', 'DELETE')
    or has_table_privilege('anon', 'public.legal_attestations', 'SELECT')
    or has_table_privilege('anon', 'public.legal_attestations', 'INSERT')
    or has_table_privilege('service_role', 'public.legal_attestations', 'INSERT')
    or has_table_privilege('service_role', 'public.legal_attestations', 'UPDATE')
    or has_table_privilege('service_role', 'public.legal_attestations', 'DELETE')
    or not has_table_privilege('service_role', 'public.legal_attestations', 'SELECT')
  then
    raise exception 'FAIL: legal_attestations table grants';
  end if;

  if not has_column_privilege('authenticated', 'public.user_profiles', 'wants_cocktail_experience', 'INSERT')
    or not has_column_privilege('authenticated', 'public.user_profiles', 'wants_cocktail_experience', 'UPDATE')
    or has_column_privilege('authenticated', 'public.user_profiles', 'role', 'UPDATE')
    or position('Cannot modify privileged profile columns' in pg_get_functiondef(
      'public.protect_user_profiles_privileged_columns()'::regprocedure
    )) = 0
  then
    raise exception 'FAIL: user_profiles grants or privileged-column trigger changed';
  end if;

  if (select paid_account_ceiling_microdollars from public.ai_budget_config_versions
      where id = 'a1000000-0000-4000-8000-00000000ae02') <> 1000000
    or (select free_account_ceiling_microdollars from public.ai_budget_config_versions
      where id = 'a1000000-0000-4000-8000-00000000ae02') <> 200000
  then
    raise exception 'FAIL: AI ceilings changed';
  end if;

  if (select column_default from information_schema.columns
      where table_schema = 'public'
        and table_name = 'legal_attestations'
        and column_name = 'attested_at')
      not like '%clock_timestamp%'
  then
    raise exception 'FAIL: attested_at is not the database clock';
  end if;

  begin
    insert into public.legal_attestations (user_id, document_version, content_id, age_21)
    values (
      '17000000-0000-4000-8000-000000000001',
      '2026-02-22',
      '53e3148013cc72dd9c0f7856fc2dd2bf6d4b870e89fdcd59fe0ee5073b3de1fb',
      false
    );
    raise exception 'FAIL: false age_21 inserted';
  exception when check_violation then null;
  end;
end $$;

insert into auth.users (id) values
  ('17000000-0000-4000-8000-000000000001'),
  ('17000000-0000-4000-8000-000000000002');

set local role anon;
do $$ begin
  begin
    perform public.record_legal_attestation('2026-02-22', true, true);
    raise exception 'FAIL: anon execute succeeded';
  exception
    when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin
  if (select count(*) from public.legal_attestations) <> 0 then
    raise exception 'FAIL: anon wrote a row';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.record_legal_attestation('2026-02-22', true, true);
    raise exception 'FAIL: null auth.uid() succeeded';
  exception
    when raise_exception then
      if sqlerrm is distinct from 'legal attestation rejected' then
        raise exception 'FAIL: null uid error was %', sqlerrm;
      end if;
  end;
end $$;

reset role;
do $$ begin
  if (select count(*) from public.legal_attestations) <> 0 then
    raise exception 'FAIL: null uid wrote a row';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"17000000-0000-4000-8000-000000000001","is_anonymous":true}',
  true
);
set local role authenticated;
do $$ begin
  begin
    perform public.record_legal_attestation('2026-02-22', true, true);
    raise exception 'FAIL: anonymous auth user succeeded';
  exception
    when raise_exception then
      if sqlerrm is distinct from 'legal attestation rejected' then
        raise exception 'FAIL: anonymous error was %', sqlerrm;
      end if;
  end;
end $$;

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"17000000-0000-4000-8000-000000000001","is_anonymous":false}',
  true
);
set local role authenticated;
do $$ begin
  begin
    perform public.record_legal_attestation('1999-01-01', true, true);
    raise exception 'FAIL: mismatched version succeeded';
  exception
    when raise_exception then
      if sqlerrm is distinct from 'legal attestation rejected' then
        raise exception 'FAIL: version error was %', sqlerrm;
      end if;
  end;
  begin
    perform public.record_legal_attestation('2026-02-22', false, true);
    raise exception 'FAIL: false age succeeded';
  exception
    when raise_exception then
      if sqlerrm is distinct from 'legal attestation rejected' then
        raise exception 'FAIL: false age error was %', sqlerrm;
      end if;
  end;
  begin
    perform public.record_legal_attestation('2026-02-22', true, false);
    raise exception 'FAIL: false terms succeeded';
  exception
    when raise_exception then
      if sqlerrm is distinct from 'legal attestation rejected' then
        raise exception 'FAIL: false terms error was %', sqlerrm;
      end if;
  end;
  begin
    perform public.record_legal_attestation('2026-02-22', null, true);
    raise exception 'FAIL: null age succeeded';
  exception
    when raise_exception then
      if sqlerrm is distinct from 'legal attestation rejected' then
        raise exception 'FAIL: null age error was %', sqlerrm;
      end if;
  end;
  begin
    perform public.record_legal_attestation('2026-02-22', true, null);
    raise exception 'FAIL: null terms succeeded';
  exception
    when raise_exception then
      if sqlerrm is distinct from 'legal attestation rejected' then
        raise exception 'FAIL: null terms error was %', sqlerrm;
      end if;
  end;
end $$;

reset role;
do $$ begin
  if (select count(*) from public.legal_attestations) <> 0 then
    raise exception 'FAIL: rejected calls wrote a row';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"17000000-0000-4000-8000-000000000001","is_anonymous":false}',
  true
);
set local role authenticated;
select public.record_legal_attestation(
  '2026-02-22',
  true,
  true
);
select public.record_legal_attestation(
  '2026-02-22',
  true,
  true
);

reset role;
do $$
declare
  n integer;
  version text;
  content text;
  age boolean;
  at timestamptz;
begin
  select count(*) into n from public.legal_attestations;
  if n <> 1 then
    raise exception 'FAIL: expected one attestation row, found %', n;
  end if;
  select document_version, content_id, age_21, attested_at
    into version, content, age, at
  from public.legal_attestations;
  if version is distinct from '2026-02-22'
    or content is distinct from '53e3148013cc72dd9c0f7856fc2dd2bf6d4b870e89fdcd59fe0ee5073b3de1fb'
    or age is distinct from true
    or at > pg_catalog.clock_timestamp()
    or at < pg_catalog.clock_timestamp() - interval '2 minutes'
  then
    raise exception 'FAIL: stored pair % % % %', version, content, age, at;
  end if;
end $$;

set local role authenticated;
do $$
declare
  n integer;
begin
  select count(*) into n from public.legal_attestations;
  if n <> 1 then
    raise exception 'FAIL: owner could not read the attestation';
  end if;
  begin
    insert into public.legal_attestations (user_id, document_version, content_id, age_21)
    values (
      auth.uid(),
      '2026-02-22',
      '53e3148013cc72dd9c0f7856fc2dd2bf6d4b870e89fdcd59fe0ee5073b3de1fb',
      true
    );
    raise exception 'FAIL: authenticated inserted the table';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.legal_attestations set age_21 = true where user_id = auth.uid();
    raise exception 'FAIL: authenticated updated the table';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.legal_attestations where user_id = auth.uid();
    raise exception 'FAIL: authenticated deleted the table';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000002', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"17000000-0000-4000-8000-000000000002","is_anonymous":false}',
  true
);
set local role authenticated;
do $$ begin
  if (select count(*) from public.legal_attestations) <> 0 then
    raise exception 'FAIL: another member read the attestation';
  end if;
end $$;

reset role;
set local role service_role;
do $$ begin
  begin
    insert into public.legal_attestations (user_id, document_version, content_id, age_21)
    values (
      '17000000-0000-4000-8000-000000000002',
      '2026-02-22',
      '53e3148013cc72dd9c0f7856fc2dd2bf6d4b870e89fdcd59fe0ee5073b3de1fb',
      true
    );
    raise exception 'FAIL: service_role inserted an attestation';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin
  if (select count(*) from public.legal_attestations) <> 1 then
    raise exception 'FAIL: attestation row count changed after denied writes';
  end if;
end $$;

rollback;
select 'PASS: G17-A attestation RPC, grants, and current pair; fixtures rolled back';
