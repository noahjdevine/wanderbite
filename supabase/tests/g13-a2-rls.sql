-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '15s';

do $$
declare
  proc oid;
begin
  foreach proc in array array[
    'public.ai_recover_stale_requests(timestamptz, integer)'::regprocedure,
    'public.ai_store_result_payload(uuid, jsonb)'::regprocedure,
    'public.ai_load_result_payload(uuid)'::regprocedure,
    'public.ai_fair_use_state(timestamptz, text, uuid, text)'::regprocedure,
    'public.ai_ops_headroom(timestamptz)'::regprocedure,
    'public.ai_transfer_guest_to_account(text, uuid)'::regprocedure
  ]
  loop
    if has_function_privilege('anon', proc, 'EXECUTE')
      or has_function_privilege('authenticated', proc, 'EXECUTE')
      or not has_function_privilege('service_role', proc, 'EXECUTE')
    then
      raise exception 'FAIL: G13-A2 RPC grants for %', proc;
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

  proc := 'public.ai_map_guest_targets_to_account(jsonb, uuid, text, bigint)'::regprocedure;
  if has_function_privilege('anon', proc, 'EXECUTE')
    or has_function_privilege('authenticated', proc, 'EXECUTE')
    or has_function_privilege('service_role', proc, 'EXECUTE')
  then
    raise exception 'FAIL: helper EXECUTE leaked on ai_map_guest_targets_to_account';
  end if;
end $$;

select 'PASS: G13-A2 RPC grants';
rollback;
