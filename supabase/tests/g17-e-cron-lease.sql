-- G17-E lease behavior. Run only through the guarded local harness.
-- All fixture rows are rolled back.
begin;
set local statement_timeout = '15s';

do $$
declare
  token_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  token_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  acquired jsonb;
  renewed boolean;
  recorded boolean;
  released boolean;
  finalized jsonb;
  v_run_id bigint;
  running_count integer;
  v_status text;
  item_status text;
begin
  if has_function_privilege('anon', 'public.acquire_cron_lease(text, text, uuid, integer, jsonb, boolean, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.acquire_cron_lease(text, text, uuid, integer, jsonb, boolean, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finalize_cron_lease(text, uuid, bigint, text, jsonb, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.release_cron_lease(text, uuid, bigint)', 'EXECUTE')
  then
    raise exception 'FAIL: anon or authenticated can execute cron lease functions';
  end if;

  if not has_function_privilege('service_role', 'public.acquire_cron_lease(text, text, uuid, integer, jsonb, boolean, boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.record_cron_run_item(text, uuid, bigint, text, text, jsonb, text)', 'EXECUTE')
  then
    raise exception 'FAIL: service_role cannot execute cron lease functions';
  end if;

  if has_table_privilege('anon', 'public.cron_job_leases', 'SELECT')
     or has_table_privilege('authenticated', 'public.cron_run_items', 'INSERT')
     or has_table_privilege('service_role', 'public.cron_job_leases', 'DELETE')
     or has_table_privilege('service_role', 'public.cron_run_items', 'DELETE')
  then
    raise exception 'FAIL: cron lease table privileges are not service-role DML without delete';
  end if;

  set local role service_role;

  acquired := public.acquire_cron_lease(
    'g17-e-test', 'g17-e-test:2026-08-01', token_a, 600, '{}'::jsonb, true, false
  );
  if acquired ->> 'acquired' <> 'true' then
    raise exception 'FAIL: first acquire did not own the lease';
  end if;
  v_run_id := (acquired ->> 'run_id')::bigint;

  recorded := public.record_cron_run_item(
    'g17-e-test', token_a, v_run_id, 'user-17', 'failed', null, 'item 17'
  );
  if not recorded then
    raise exception 'FAIL: failed item was not recorded';
  end if;
  recorded := public.record_cron_run_item(
    'g17-e-test', token_a, v_run_id, 'user-18', 'succeeded', null, null
  );
  if not recorded then
    raise exception 'FAIL: later item was not recorded';
  end if;

  select count(*) into running_count
  from public.cron_run_items as i
  where i.run_id = v_run_id and i.item_key in ('user-17', 'user-18');
  if running_count <> 2 then
    raise exception 'FAIL: mixed item outcomes were not both durable';
  end if;

  finalized := public.finalize_cron_lease(
    'g17-e-test', token_a, v_run_id, 'success', '{}'::jsonb, null
  );
  if finalized ->> 'finalized' <> 'false' then
    raise exception 'FAIL: success was accepted with a failed item';
  end if;

  finalized := public.finalize_cron_lease(
    'g17-e-test', token_a, v_run_id, 'degraded', '{}'::jsonb, 'item failures'
  );
  if finalized ->> 'finalized' <> 'true' or finalized ->> 'status' <> 'degraded' then
    raise exception 'FAIL: degraded finalize did not stick';
  end if;

  released := public.release_cron_lease('g17-e-test', token_a, v_run_id);
  if released then
    raise exception 'FAIL: release changed a terminal row';
  end if;
  select r.status into v_status from public.cron_runs r where r.id = v_run_id;
  if v_status <> 'degraded' then
    raise exception 'FAIL: release turned a terminal row into something else';
  end if;

  acquired := public.acquire_cron_lease(
    'g17-e-test', 'g17-e-test:2026-08-01', token_b, 600, '{}'::jsonb, true, false
  );
  if acquired ->> 'reason' <> 'terminal' or acquired ->> 'acquired' <> 'false' then
    raise exception 'FAIL: a finished key was reopened';
  end if;

  acquired := public.acquire_cron_lease(
    'g17-e-test', 'g17-e-test:2026-09-01', token_a, 600, '{}'::jsonb, true, false
  );
  v_run_id := (acquired ->> 'run_id')::bigint;
  perform public.record_cron_run_item(
    'g17-e-test', token_a, v_run_id, 'user-1', 'pending', null, null
  );
  update public.cron_job_leases
  set lease_expires_at = now() - interval '1 minute'
  where job_name = 'g17-e-test';

  finalized := public.finalize_cron_lease(
    'g17-e-test', token_a, v_run_id, 'success', '{}'::jsonb, null
  );
  if finalized ->> 'reason' <> 'lost-lease' then
    raise exception 'FAIL: stale token finalized after expiry';
  end if;

  acquired := public.acquire_cron_lease(
    'g17-e-test', 'g17-e-test:2026-09-01', token_b, 600, null, true, false
  );
  if acquired ->> 'resumed' <> 'true' or (acquired ->> 'run_id')::bigint <> v_run_id then
    raise exception 'FAIL: expired same-period lease did not resume the same row';
  end if;

  select i.status into item_status
  from public.cron_run_items i
  where i.run_id = v_run_id and i.item_key = 'user-1';
  if item_status <> 'pending' then
    raise exception 'FAIL: resume did not keep the pending item';
  end if;

  update public.cron_job_leases
  set lease_expires_at = now() - interval '1 minute'
  where job_name = 'g17-e-test';

  acquired := public.acquire_cron_lease(
    'g17-e-test', 'g17-e-test:2026-10-01', token_a, 600, '{}'::jsonb, true, false
  );
  if acquired ->> 'acquired' <> 'true' then
    raise exception 'FAIL: new period did not acquire';
  end if;
  if acquired -> 'degraded_previous' -> 0 ->> 'error' <> 'unfinished at period boundary' then
    raise exception 'FAIL: old period was not degraded at the boundary';
  end if;
  if (acquired ->> 'run_id')::bigint = v_run_id then
    raise exception 'FAIL: new period reused the old run';
  end if;
  select r.status into v_status from public.cron_runs r where r.id = v_run_id;
  if v_status <> 'degraded' then
    raise exception 'FAIL: unfinished old run was not degraded';
  end if;

  select count(*) into running_count
  from public.cron_runs as r
  where r.job_name = 'g17-e-test' and r.status = 'running';
  if running_count <> 1 then
    raise exception 'FAIL: more than one running row for the job';
  end if;

  acquired := public.acquire_cron_lease(
    'g17-e-test', 'g17-e-test:2026-10-01', token_b, 600, '{}'::jsonb, true, false
  );
  if acquired ->> 'reason' <> 'lease-held' then
    raise exception 'FAIL: live lease did not block a second worker';
  end if;
  select count(*) into running_count
  from public.cron_runs as r
  where r.job_name = 'g17-e-test' and r.run_key = 'g17-e-test:2026-10-01' and r.status = 'running';
  if running_count <> 1 then
    raise exception 'FAIL: lease-held inserted a second running row';
  end if;

  reset role;
end $$;

rollback;
