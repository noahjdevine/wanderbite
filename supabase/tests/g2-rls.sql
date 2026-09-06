-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '15s';

do $$ begin
  if exists (
    select 1
    from aclexplode((
      select relacl from pg_class where oid = 'public.user_profiles'::regclass
    )) acl
    where acl.grantee in ('anon'::regrole, 'authenticated'::regrole)
      and acl.privilege_type in ('INSERT', 'UPDATE')
  ) then
    raise exception 'FAIL: table-level insert/update still granted to client roles';
  end if;
  if has_column_privilege('authenticated', 'public.user_profiles', 'role', 'INSERT')
    or has_column_privilege('authenticated', 'public.user_profiles', 'role', 'UPDATE')
    or has_column_privilege('authenticated', 'public.user_profiles', 'is_admin', 'INSERT')
    or has_column_privilege('authenticated', 'public.user_profiles', 'is_admin', 'UPDATE')
    or has_column_privilege('authenticated', 'public.user_profiles', 'subscription_status', 'INSERT')
    or has_column_privilege('authenticated', 'public.user_profiles', 'subscription_status', 'UPDATE')
    or has_column_privilege('authenticated', 'public.user_profiles', 'stripe_customer_id', 'UPDATE')
    or has_column_privilege('authenticated', 'public.user_profiles', 'current_period_end', 'UPDATE')
    or has_column_privilege('authenticated', 'public.user_profiles', 'id', 'UPDATE')
    or has_column_privilege('anon', 'public.user_profiles', 'dietary_flags', 'INSERT')
    or has_column_privilege('anon', 'public.user_profiles', 'dietary_flags', 'UPDATE')
  then
    raise exception 'FAIL: privileged or anonymous column grants remain';
  end if;
  if not has_column_privilege('authenticated', 'public.user_profiles', 'id', 'INSERT')
    or not has_column_privilege('authenticated', 'public.user_profiles', 'dietary_flags', 'UPDATE')
    or not has_column_privilege('authenticated', 'public.user_profiles', 'email', 'INSERT')
  then
    raise exception 'FAIL: allowlisted preference grants missing';
  end if;
end $$;

insert into auth.users (id) values
  ('40000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002'),
  ('40000000-0000-4000-8000-000000000003'),
  ('40000000-0000-4000-8000-000000000004');

insert into public.user_profiles (id, role, is_admin, subscription_status)
  values ('40000000-0000-4000-8000-000000000002', 'admin', true, 'active');

set local role service_role;
update public.user_profiles
  set subscription_status = 'past_due', stripe_customer_id = 'cus_g2_test'
  where id = '40000000-0000-4000-8000-000000000002';
reset role;
do $$ begin
  if not exists (
    select 1 from public.user_profiles
    where id = '40000000-0000-4000-8000-000000000002'
      and role = 'admin' and is_admin and subscription_status = 'past_due'
      and stripe_customer_id = 'cus_g2_test'
  ) then
    raise exception 'FAIL: service-role billing update did not succeed';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
set local role authenticated;
insert into public.user_profiles (id, email, dietary_flags, distance_band)
  values (auth.uid(), 'g2-member@example.com', array['peanut'], '15_mi');
update public.user_profiles
  set wants_cocktail_experience = true, full_name = 'G2 Member'
  where id = auth.uid();
do $$
declare changed integer;
begin
  if (select count(*) from public.user_profiles) <> 1 then
    raise exception 'FAIL: member can see another profile'; end if;
  if (select role from public.user_profiles where id = auth.uid()) is distinct from 'subscriber'
    or (select is_admin from public.user_profiles where id = auth.uid()) is distinct from false
    or (select subscription_status from public.user_profiles where id = auth.uid())
         is distinct from 'inactive' then
    raise exception 'FAIL: member insert did not keep privileged defaults';
  end if;
  if (select full_name from public.user_profiles where id = auth.uid()) is distinct from 'G2 Member'
    or (select wants_cocktail_experience from public.user_profiles where id = auth.uid())
         is distinct from true then
    raise exception 'FAIL: member preference update did not succeed';
  end if;

  begin
    insert into public.user_profiles (id, role)
      values ('40000000-0000-4000-8000-000000000003', 'admin');
    raise exception 'FAIL: member insert of role was accepted';
  exception when insufficient_privilege then null; end;

  begin
    update public.user_profiles set role = 'admin' where id = auth.uid();
    raise exception 'FAIL: member update of role was accepted';
  exception when insufficient_privilege then null; end;

  begin
    update public.user_profiles set subscription_status = 'active' where id = auth.uid();
    raise exception 'FAIL: member update of subscription_status was accepted';
  exception when insufficient_privilege then null; end;

  begin
    update public.user_profiles set is_admin = true where id = auth.uid();
    raise exception 'FAIL: member update of is_admin was accepted';
  exception when insufficient_privilege then null; end;

  begin
    update public.user_profiles set stripe_customer_id = 'cus_forged' where id = auth.uid();
    raise exception 'FAIL: member update of stripe_customer_id was accepted';
  exception when insufficient_privilege then null; end;

  begin
    update public.user_profiles set current_period_end = now() where id = auth.uid();
    raise exception 'FAIL: member update of current_period_end was accepted';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.user_profiles (id) values ('40000000-0000-4000-8000-000000000002');
    raise exception 'FAIL: member insert of another user id was accepted';
  exception when insufficient_privilege then null; end;

  update public.user_profiles set full_name = 'Forged admin' where id = '40000000-0000-4000-8000-000000000002';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: member updated another profile'; end if;
end $$;

reset role;
grant update (role) on table public.user_profiles to authenticated;
grant insert (id, role) on table public.user_profiles to authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$ begin
  begin
    update public.user_profiles set role = 'admin' where id = auth.uid();
    raise exception 'FAIL: trigger allowed privileged update after extra grant';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000003', true);
set local role authenticated;
do $$ begin
  begin
    insert into public.user_profiles (id, role)
      values (auth.uid(), 'admin');
    raise exception 'FAIL: trigger allowed privileged insert after extra grant';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
revoke update (role) on table public.user_profiles from authenticated;
revoke insert (id, role) on table public.user_profiles from authenticated;

select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$ begin
  begin
    insert into public.user_profiles (id)
      values ('40000000-0000-4000-8000-000000000004');
    raise exception 'FAIL: anonymous insert was accepted';
  exception when insufficient_privilege then null; end;
  begin
    update public.user_profiles set full_name = 'anon';
    raise exception 'FAIL: anonymous update was accepted';
  exception when insufficient_privilege then null; end;
end $$;

rollback;
select 'PASS: G2 user_profiles grants, RLS, privileged-column trigger, service-role billing writes; fixtures rolled back';
