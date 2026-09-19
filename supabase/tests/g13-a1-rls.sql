-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '15s';

do $$
declare
  proc oid;
  tbl regclass;
begin
  foreach tbl in array array[
    'public.ai_price_versions'::regclass,
    'public.ai_price_rates'::regclass,
    'public.ai_budget_config_versions'::regclass,
    'public.ai_bucket_balances'::regclass,
    'public.ai_requests'::regclass,
    'public.ai_guest_transfers'::regclass
  ]
  loop
    if not (select relrowsecurity from pg_class where oid = tbl) then
      raise exception 'FAIL: RLS disabled on %', tbl;
    end if;
    if exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = (select c.relname from pg_class c where c.oid = tbl)
    ) then
      raise exception 'FAIL: client policy exists on %', tbl;
    end if;
    if has_table_privilege('anon', tbl, 'SELECT')
      or has_table_privilege('anon', tbl, 'INSERT')
      or has_table_privilege('anon', tbl, 'UPDATE')
      or has_table_privilege('anon', tbl, 'DELETE')
      or has_table_privilege('authenticated', tbl, 'SELECT')
      or has_table_privilege('authenticated', tbl, 'INSERT')
      or has_table_privilege('authenticated', tbl, 'UPDATE')
      or has_table_privilege('authenticated', tbl, 'DELETE')
      or has_table_privilege('service_role', tbl, 'SELECT')
      or has_table_privilege('service_role', tbl, 'INSERT')
      or has_table_privilege('service_role', tbl, 'UPDATE')
      or has_table_privilege('service_role', tbl, 'DELETE')
    then
      raise exception 'FAIL: table privilege remains on %', tbl;
    end if;
    if exists (
      select 1
      from aclexplode(coalesce(
        (select relacl from pg_class where oid = tbl),
        '{}'::aclitem[]
      )) acl
      where acl.grantee = 0
         or acl.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
    ) then
      raise exception 'FAIL: PUBLIC/client/service_role ACL remains on %', tbl;
    end if;
  end loop;

  foreach proc in array array[
    'public.ai_quote_max_cost(text, uuid, text, jsonb)'::regprocedure,
    'public.ai_current_versions()'::regprocedure,
    'public.ai_reserve(text, uuid, text, text, text, uuid, text, jsonb, timestamptz, text, uuid)'::regprocedure,
    'public.ai_dispatch(uuid)'::regprocedure,
    'public.ai_fail_before_dispatch(uuid)'::regprocedure,
    'public.ai_settle(uuid, jsonb)'::regprocedure,
    'public.ai_mark_assumed_spent(uuid)'::regprocedure,
    'public.ai_release_customer_allowance(uuid)'::regprocedure,
    'public.ai_reconcile(uuid, jsonb)'::regprocedure,
    'public.ai_transfer_guest_to_account(text, uuid)'::regprocedure,
    'public.ai_fair_use_state(timestamptz, text, uuid)'::regprocedure,
    'public.ai_ops_usage_summary(text)'::regprocedure
  ]
  loop
    if has_function_privilege('anon', proc, 'EXECUTE')
      or has_function_privilege('authenticated', proc, 'EXECUTE')
      or not has_function_privilege('service_role', proc, 'EXECUTE')
    then
      raise exception 'FAIL: G13-A1 RPC grants for %', proc;
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

  foreach proc in array array[
    'public.ai_ceil_microdollars(bigint, bigint)'::regprocedure,
    'public.ai_lock_bucket(text, text, text)'::regprocedure,
    'public.ai_apply_bucket_delta(bigint, bigint, text, text, text, bigint, bigint, integer, integer)'::regprocedure
  ]
  loop
    if has_function_privilege('anon', proc, 'EXECUTE')
      or has_function_privilege('authenticated', proc, 'EXECUTE')
      or has_function_privilege('service_role', proc, 'EXECUTE')
    then
      raise exception 'FAIL: helper EXECUTE leaked on %', proc;
    end if;
  end loop;
end $$;

set role anon;
do $$
begin
  begin
    insert into public.ai_requests (
      idempotency_key, status, account_tier, feature_class, provider, model_id,
      price_version_id, config_version_id, period_key, day_key, as_of, bind, usage_units
    ) values (
      'anon-forge', 'reserved', 'paid', 'optional', 'anthropic', 'x',
      'a1000000-0000-4000-8000-00000000ae01',
      'a1000000-0000-4000-8000-00000000ae02',
      '2026-09', '2026-09-19', now(), '{}'::jsonb, '{}'::jsonb
    );
    raise exception 'FAIL: anon inserted ai_requests';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' then
        raise exception 'FAIL: anon insert expected 42501, got % %', sqlstate, sqlerrm;
      end if;
  end;
end $$;
reset role;

set role authenticated;
do $$
begin
  begin
    perform public.ai_reserve(
      'paid',
      'a1000000-0000-4000-8000-00000000ae02',
      'optional',
      'auth-call-xx',
      'claude-haiku-4-5-20251001',
      'a1000000-0000-4000-8000-00000000ae01',
      'anthropic',
      '{"input":1}'::jsonb
    );
    raise exception 'FAIL: authenticated executed ai_reserve';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' then
        raise exception 'FAIL: authenticated execute expected 42501, got % %', sqlstate, sqlerrm;
      end if;
  end;
end $$;
reset role;

set role service_role;
do $$
begin
  begin
    insert into public.ai_price_rates (
      price_version_id, provider, model_id, usage_kind, microdollars_per_million
    ) values (
      'a1000000-0000-4000-8000-00000000ae01', 'anthropic', 'x', 'input', 1
    );
    raise exception 'FAIL: service_role inserted ai_price_rates';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' then
        raise exception 'FAIL: service_role insert expected 42501, got % %', sqlstate, sqlerrm;
      end if;
  end;
end $$;
reset role;

select 'PASS: G13-A1 grants, RLS, adversarial table/function access';
rollback;
