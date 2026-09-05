-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '15s';
insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002');
insert into public.user_profiles (id, is_admin) values
  ('10000000-0000-4000-8000-000000000001', false),
  ('10000000-0000-4000-8000-000000000002', true);

do $$ begin
  begin
    update public.user_profiles set subscription_status = 'invalid-test-status'
      where id = '10000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: subscription status check did not reject invalid input';
  exception when check_violation then null; end;
end $$;

set local role service_role;
insert into public.user_badges (user_id, badge_id) values
  ('10000000-0000-4000-8000-000000000001', 'first_bite'),
  ('10000000-0000-4000-8000-000000000002', 'hat_trick');
insert into public.cron_runs (job_name, status) values ('local-validation-only', 'success');
do $$ begin
  begin
    insert into public.user_badges (user_id, badge_id)
      values ('10000000-0000-4000-8000-000000000001', 'first_bite');
    raise exception 'FAIL: duplicate badge award was accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.user_badges (user_id, badge_id)
      values ('10000000-0000-4000-8000-000000000001', 'nonexistent-test-badge');
    raise exception 'FAIL: missing badge catalog reference was accepted';
  exception when foreign_key_violation then null; end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$ declare changed integer; begin
  if (select count(*) from public.badges) <> 4 then
    raise exception 'FAIL: member cannot read badge catalog'; end if;
  if (select count(*) from public.user_badges) <> 1 then
    raise exception 'FAIL: member awards are not isolated'; end if;
  if exists (select 1 from public.user_badges where user_id <> auth.uid()) then
    raise exception 'FAIL: another member award is visible'; end if;
  if public.current_user_is_admin() is distinct from false then
    raise exception 'FAIL: helper returns wrong caller flag'; end if;
  if exists (select 1 from public.cron_runs) then
    raise exception 'FAIL: member can read operational runs'; end if;
  begin
    insert into public.user_badges (user_id, badge_id)
      values (auth.uid(), 'high_five');
    raise exception 'FAIL: member can self-award a badge';
  exception when insufficient_privilege then null; end;
  update public.user_badges set awarded_at = now();
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: member can edit awards'; end if;
  delete from public.user_badges;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: member can delete awards'; end if;
  begin
    insert into public.cron_runs (job_name, status) values ('forged-local-test', 'success');
    raise exception 'FAIL: member can insert operational runs';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.user_badges) <> 1 or
    exists (select 1 from public.user_badges where user_id <> auth.uid()) then
    raise exception 'FAIL: second member award isolation'; end if;
  if public.current_user_is_admin() is distinct from true then
    raise exception 'FAIL: second caller flag'; end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$ begin
  if (select count(*) from public.badges) <> 4 then
    raise exception 'FAIL: public badge catalog is not readable'; end if;
  if exists (select 1 from public.user_badges) then
    raise exception 'FAIL: anonymous awards access'; end if;
  if exists (select 1 from public.cron_runs) then
    raise exception 'FAIL: anonymous operational data access'; end if;
  if public.current_user_is_admin() is distinct from false then
    raise exception 'FAIL: anonymous admin helper'; end if;
end $$;
rollback;
select 'PASS: G1 badge/cron RLS, service-role writes, award constraints, status constraint, caller helper; fixtures rolled back';
